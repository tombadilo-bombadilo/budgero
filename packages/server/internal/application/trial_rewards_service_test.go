package application_test

import (
	"context"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/fake"
	"budgero-server/internal/application"
	"budgero-server/internal/config"
	"budgero-server/internal/domain"
)

func newTestUser(_ string, _ int) *domain.User {
	const id = "u1"
	created := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
	// Keep TrialEndsAt always in the future relative to wall-clock so
	// HasActiveTrial() never short-circuits RecordSignal during the test
	// run. CreatedAt stays a fixed calendar date because a lot of these
	// tests assert against hardcoded month strings ("2026-04", "2026-05")
	// and dayOffset() math derived from it.
	trialEnd := time.Now().UTC().Add(365 * 24 * time.Hour)
	return &domain.User{
		ID:                 id,
		Name:               "Test User",
		Email:              id + "@test.example",
		CreatedAt:          created,
		TrialEndsAt:        &trialEnd,
		SubscriptionStatus: domain.SubscriptionTrialing,
	}
}

func newTrialRewardsServiceWithUser(t *testing.T, user *domain.User) (*application.TrialRewardsService, *fake.TrialRewardsRepository, *fake.UserRepository) {
	t.Helper()
	userRepo := fake.NewUserRepository()
	if user != nil {
		ctx := context.Background()
		_, err := userRepo.Create(ctx, user)
		if err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	trialRepo := fake.NewTrialRewardsRepository()
	cfg := &config.Config{Features: config.FeatureConfig{TrialDurationDays: 35}}
	svc := application.NewTrialRewardsService(trialRepo, userRepo, nil, cfg)
	return svc, trialRepo, userRepo
}

// dayOffset returns the user's trial-start date plus n days (UTC noon to keep
// day boundaries unambiguous).
func dayOffset(user *domain.User, n int) time.Time {
	return user.CreatedAt.Add(time.Duration(n) * 24 * time.Hour)
}

// unlockTier1 logs the 5 transactions required to unlock Tier 1, used by the
// higher-tier tests that need T1 as a prerequisite.
func unlockTier1(ctx context.Context, svc *application.TrialRewardsService, user *domain.User) {
	month := user.CreatedAt.UTC().Format("2006-01")
	for i := 0; i < 5; i++ {
		_ = svc.RecordSignal(ctx, user.ID, domain.SignalTransactionInMonth, dayOffset(user, 0), month)
	}
}

func TestRecordSignal_RejectsInvalidKind(t *testing.T) {
	user := newTestUser("u1", 35)
	svc, _, _ := newTrialRewardsServiceWithUser(t, user)
	err := svc.RecordSignal(context.Background(), user.ID, "not_a_kind", time.Now(), "")
	if err == nil {
		t.Fatalf("expected error for invalid kind")
	}
}

func TestRecordSignal_DropsWhenTrialSignalsDisabled(t *testing.T) {
	user := newTestUser("u1", 35)
	user.IsTrialSignalsDisabled = true
	svc, repo, _ := newTrialRewardsServiceWithUser(t, user)

	err := svc.RecordSignal(context.Background(), user.ID, domain.SignalDailyLogging, time.Now(), "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	count, _ := repo.CountSignalsOfKind(context.Background(), user.ID, domain.SignalDailyLogging)
	if count != 0 {
		t.Errorf("expected signal to be dropped, got count=%d", count)
	}
}

func TestRecordSignal_DropsWhenTrialExpired(t *testing.T) {
	user := newTestUser("u1", 35)
	expired := user.CreatedAt.Add(-1 * time.Hour)
	user.TrialEndsAt = &expired
	svc, repo, _ := newTrialRewardsServiceWithUser(t, user)

	err := svc.RecordSignal(context.Background(), user.ID, domain.SignalDailyLogging, time.Now(), "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	count, _ := repo.CountSignalsOfKind(context.Background(), user.ID, domain.SignalDailyLogging)
	if count != 0 {
		t.Errorf("expected signal to be dropped, got count=%d", count)
	}
}

func TestTier1_UnlocksAt5Transactions(t *testing.T) {
	user := newTestUser("u1", 35)
	svc, repo, _ := newTrialRewardsServiceWithUser(t, user)
	ctx := context.Background()
	month := user.CreatedAt.UTC().Format("2006-01")

	// 4 transactions: not enough yet.
	for i := 0; i < 4; i++ {
		if err := svc.RecordSignal(ctx, user.ID, domain.SignalTransactionInMonth, dayOffset(user, 0), month); err != nil {
			t.Fatalf("txn %d: %v", i, err)
		}
	}
	progress, _, _ := svc.GetProgress(ctx, user.ID)
	if progress == nil || progress.Tier1UnlockedAt != nil {
		t.Errorf("tier 1 unlocked too early at 4 transactions")
	}

	// 5th transaction: should unlock.
	if err := svc.RecordSignal(ctx, user.ID, domain.SignalTransactionInMonth, dayOffset(user, 0), month); err != nil {
		t.Fatalf("5th txn: %v", err)
	}
	progress, codes, _ := svc.GetProgress(ctx, user.ID)
	if progress.Tier1UnlockedAt == nil {
		t.Errorf("tier 1 should be unlocked at 5 transactions")
	}
	if len(codes) != 1 {
		t.Errorf("expected 1 discount code, got %d", len(codes))
	} else if codes[0].Tier != domain.RewardTier1 || codes[0].PercentOff != 10 {
		t.Errorf("unexpected code: tier=%d pct=%d", codes[0].Tier, codes[0].PercentOff)
	}
	_ = repo
}

func TestTier1_EarnableLaterInTrial(t *testing.T) {
	// There is no early-day cutoff anymore: 5 transactions logged well past
	// the old day-10 window must still unlock Tier 1.
	user := newTestUser("u1", 35)
	svc, _, _ := newTrialRewardsServiceWithUser(t, user)
	ctx := context.Background()
	month := user.CreatedAt.UTC().Format("2006-01")

	for i := 0; i < 5; i++ {
		_ = svc.RecordSignal(ctx, user.ID, domain.SignalTransactionInMonth, dayOffset(user, 20), month)
	}
	progress, _, _ := svc.GetProgress(ctx, user.ID)
	if progress.Tier1UnlockedAt == nil {
		t.Errorf("tier 1 should unlock from 5 transactions even past day 10")
	}
}

// Tier 2 — Discipline: T1 + reconciliation + a goal_funded signal.
func TestTier2_RequiresL1AndReconciliationAndGoalFunding(t *testing.T) {
	user := newTestUser("u1", 35)
	svc, _, _ := newTrialRewardsServiceWithUser(t, user)
	ctx := context.Background()

	// Unlock L1 with 7 logging days.
	unlockTier1(ctx, svc, user)
	progress, _, _ := svc.GetProgress(ctx, user.ID)
	if progress.Tier1UnlockedAt == nil {
		t.Fatalf("L1 should be unlocked")
	}

	// Reconciliation alone — not enough.
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalReconciliation, dayOffset(user, 11), "")
	progress, _, _ = svc.GetProgress(ctx, user.ID)
	if progress.Tier2UnlockedAt != nil {
		t.Errorf("L2 unlocked without goal funding")
	}

	// Goal-funding completes T2.
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalGoalFunding, dayOffset(user, 12), "")
	progress, codes, _ := svc.GetProgress(ctx, user.ID)
	if progress.Tier2UnlockedAt == nil {
		t.Errorf("L2 should be unlocked after reconciliation + goal funding")
	}
	if len(codes) != 2 {
		t.Errorf("expected 2 codes (T1+T2), got %d", len(codes))
	}
}

// Tier 3 — Persistence: T2 + ≥21 days + crossed signup_month + assignments
// in ≥2 distinct months + transactions in ≥2 distinct months.
func TestTier3_RequiresPersistenceAcrossTwoMonths(t *testing.T) {
	user := newTestUser("u1", 35) // signup = 2026-04-01 12:00 UTC
	svc, _, _ := newTrialRewardsServiceWithUser(t, user)
	ctx := context.Background()

	// Get to T2.
	unlockTier1(ctx, svc, user)
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalReconciliation, dayOffset(user, 11), "")
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalGoalFunding, dayOffset(user, 12), "")
	progress, _, _ := svc.GetProgress(ctx, user.ID)
	if progress.Tier2UnlockedAt == nil {
		t.Fatalf("T2 should be unlocked: %+v", progress)
	}

	// Activity in only one month so far — should not unlock.
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalAssignmentInMonth, dayOffset(user, 5), "2026-04")
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalTransactionInMonth, dayOffset(user, 5), "2026-04")
	progress, _, _ = svc.GetProgress(ctx, user.ID)
	if progress.Tier3UnlockedAt != nil {
		t.Errorf("T3 unlocked with only one month of activity")
	}

	// Add second-month activity AND advance to past calendar boundary.
	// dayOffset(30) = 2026-05-01 (boundary just crossed). 30 days >= 21d floor.
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalAssignmentInMonth, dayOffset(user, 30), "2026-05")
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalTransactionInMonth, dayOffset(user, 30), "2026-05")

	progress, codes, _ := svc.GetProgress(ctx, user.ID)
	if progress.Tier3UnlockedAt == nil {
		t.Errorf("T3 should be unlocked once both months have activity past the boundary + 21d floor")
	}
	if len(codes) != 3 {
		t.Errorf("expected 3 codes (T1+T2+T3), got %d", len(codes))
	}
}

// T3 must NOT unlock before the 21-day floor, even if the calendar boundary
// has been crossed (e.g., user signs up late in a month and crosses fast).
func TestTier3_RespectsTwentyOneDayFloor(t *testing.T) {
	// Sign up April 28, signup-month 2026-04. Boundary at 2026-05 reached
	// quickly (~3 days) but 21-day floor not yet hit.
	user := &domain.User{
		ID:        "u1",
		Name:      "Late",
		Email:     "late@test.example",
		CreatedAt: time.Date(2026, 4, 28, 12, 0, 0, 0, time.UTC),
		// Always-future trial end — see newTestUser for rationale.
		TrialEndsAt:        ptrTime(time.Now().UTC().Add(365 * 24 * time.Hour)),
		SubscriptionStatus: domain.SubscriptionTrialing,
	}
	svc, _, _ := newTrialRewardsServiceWithUser(t, user)
	ctx := context.Background()

	// Unlock T2.
	unlockTier1(ctx, svc, user)
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalReconciliation, dayOffset(user, 8), "")
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalGoalFunding, dayOffset(user, 8), "")

	// Day 5 (May 3): boundary crossed but only 5 days into trial. Floor blocks.
	day5 := dayOffset(user, 5)
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalAssignmentInMonth, day5, "2026-04")
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalAssignmentInMonth, day5, "2026-05")
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalTransactionInMonth, day5, "2026-04")
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalTransactionInMonth, day5, "2026-05")
	progress, _, _ := svc.GetProgress(ctx, user.ID)
	if progress.Tier3UnlockedAt != nil {
		t.Errorf("T3 unlocked before 21-day floor (only 5 days into trial)")
	}

	// Day 22 (May 20): floor satisfied + boundary crossed. Should unlock.
	day22 := dayOffset(user, 22)
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalAssignmentInMonth, day22, "2026-05")
	progress, _, _ = svc.GetProgress(ctx, user.ID)
	if progress.Tier3UnlockedAt == nil {
		t.Errorf("T3 should unlock at day 22 (floor + boundary both satisfied)")
	}
}

func ptrTime(t time.Time) *time.Time { return &t }

func TestTier_HigherUnlockSupersedesLowerCodes(t *testing.T) {
	user := newTestUser("u1", 35)
	svc, _, _ := newTrialRewardsServiceWithUser(t, user)
	ctx := context.Background()

	// Drive all the way to Tier 3 in one shot using the new criteria.
	unlockTier1(ctx, svc, user)
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalReconciliation, dayOffset(user, 11), "")
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalGoalFunding, dayOffset(user, 12), "")
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalAssignmentInMonth, dayOffset(user, 5), "2026-04")
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalTransactionInMonth, dayOffset(user, 5), "2026-04")
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalAssignmentInMonth, dayOffset(user, 30), "2026-05")
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalTransactionInMonth, dayOffset(user, 30), "2026-05")

	_, codes, _ := svc.GetProgress(ctx, user.ID)
	if len(codes) != 3 {
		t.Fatalf("expected 3 codes total (one per tier), got %d", len(codes))
	}

	// Query at a time strictly after every signal-time so superseded T1/T2
	// codes are clearly past their clamped valid_until. T3 unlocks at
	// dayOffset(30) when the May signals fire and the boundary is crossed.
	checkAt := dayOffset(user, 31)
	var active []domain.DiscountCode
	for _, c := range codes {
		if c.IsActive(checkAt) {
			active = append(active, c)
		}
	}
	if len(active) != 1 {
		t.Fatalf("expected exactly 1 active code after T3 unlock, got %d", len(active))
	}
	if active[0].Tier != domain.RewardTier3 {
		t.Errorf("expected the active code to be Tier 3, got Tier %d", active[0].Tier)
	}
}

func TestRecordSignal_DedupSameDayLoggingDoesntInflateDistinctCount(t *testing.T) {
	user := newTestUser("u1", 35)
	svc, _, _ := newTrialRewardsServiceWithUser(t, user)
	ctx := context.Background()

	// Three logging signals on the same day.
	for i := 0; i < 3; i++ {
		_ = svc.RecordSignal(ctx, user.ID, domain.SignalDailyLogging, user.CreatedAt.Add(time.Duration(i)*time.Hour), "")
	}
	progress, _, _ := svc.GetProgress(ctx, user.ID)
	if progress.DailyLoggingDistinctDays != 1 {
		t.Errorf("expected 1 distinct day, got %d", progress.DailyLoggingDistinctDays)
	}
}

func TestValidateCodeForUser_RejectsForeignAndInactiveCodes(t *testing.T) {
	user := newTestUser("u1", 35)
	svc, _, _ := newTrialRewardsServiceWithUser(t, user)
	ctx := context.Background()

	// Unlock T1 to mint a code.
	unlockTier1(ctx, svc, user)
	_, codes, _ := svc.GetProgress(ctx, user.ID)
	if len(codes) == 0 {
		t.Fatalf("no codes minted")
	}
	code := codes[0].Code

	// Wrong user.
	if _, err := svc.ValidateCodeForUser(ctx, "other_user", code); err == nil {
		t.Errorf("expected error for foreign user")
	}

	// Right user — should validate.
	if _, err := svc.ValidateCodeForUser(ctx, user.ID, code); err != nil {
		t.Errorf("expected validation to succeed: %v", err)
	}

	// Mark redeemed — should now reject.
	_ = svc.MarkRedeemed(ctx, code, "sub_xyz", time.Now())
	if _, err := svc.ValidateCodeForUser(ctx, user.ID, code); err == nil {
		t.Errorf("expected error for redeemed code")
	}
}

func TestReissueCodesOnReturn_ExtendsExpiredCodesWithinReengagementWindow(t *testing.T) {
	user := newTestUser("u1", 35)
	svc, repo, userRepo := newTrialRewardsServiceWithUser(t, user)
	ctx := context.Background()

	// Unlock T1.
	unlockTier1(ctx, svc, user)
	_, codes, _ := svc.GetProgress(ctx, user.ID)
	if len(codes) == 0 {
		t.Fatalf("no codes minted")
	}

	// Force-expire the code.
	expired := time.Now().Add(-24 * time.Hour)
	_ = repo.ExtendDiscountCodeValidity(ctx, codes[0].Code, expired)

	// Move trial-end into the past, but within the reengagement window.
	pastTrialEnd := time.Now().Add(-10 * 24 * time.Hour)
	stored, _ := userRepo.GetByID(ctx, user.ID)
	stored.TrialEndsAt = &pastTrialEnd
	// Persist update by re-creating (fake's UserRepository doesn't expose a SetTrialEnd).
	// The fake stores by reference, so the in-place mutation is enough.

	if err := svc.ReissueCodesOnReturn(ctx, user.ID); err != nil {
		t.Fatalf("reissue: %v", err)
	}

	got, _ := repo.GetDiscountCodeByCode(ctx, codes[0].Code)
	if !got.ValidUntil.After(time.Now()) {
		t.Errorf("expected validUntil to be extended into the future, got %v", got.ValidUntil)
	}
}

// Bug repro: DailyLoggingDistinctDays is the field the rewards UI renders
// for the "log on 7 of your first 10 days" T1 criterion. If the field
// includes logging days from outside the T1 window, the UI shows the
// criterion as met (or even past target) while Tier1UnlockedAt stays nil
// — a user-visible inconsistency. The evaluator already uses the correct
// 10-day window; this test pins the display field to the same window.
func TestTier1_DailyLoggingDistinctDaysReflectsT1Window(t *testing.T) {
	user := newTestUser("u1", 35)
	svc, _, _ := newTrialRewardsServiceWithUser(t, user)
	ctx := context.Background()

	// 3 logging days within the T1 window (days 1–10) — not enough for T1.
	for i := 0; i < 3; i++ {
		_ = svc.RecordSignal(ctx, user.ID, domain.SignalDailyLogging, dayOffset(user, i), "")
	}
	// 7 logging days *outside* the T1 window (days 11–17). These must not
	// inflate the displayed T1 progress count.
	for i := 10; i < 17; i++ {
		_ = svc.RecordSignal(ctx, user.ID, domain.SignalDailyLogging, dayOffset(user, i), "")
	}

	progress, _, _ := svc.GetProgress(ctx, user.ID)
	if progress.Tier1UnlockedAt != nil {
		t.Errorf("T1 should not unlock — only 3 days within first 10")
	}
	if progress.DailyLoggingDistinctDays != 3 {
		t.Errorf("DailyLoggingDistinctDays should reflect T1 window (days 1–10) only: got %d, want 3", progress.DailyLoggingDistinctDays)
	}
}

// Bug repro: ReissueCodesOnReturn loops over every unredeemed expired code
// and extends its valid_until. That includes codes that were *superseded*
// when a higher tier unlocked (their valid_until was clamped to the
// supersede moment, so they look "expired"). Reviving them violates the
// one-active-code invariant — after a returning T1→T2 user is reissued,
// both codes become active.
func TestReissueCodesOnReturn_DoesNotReviveSupersededLowerTierCodes(t *testing.T) {
	user := newTestUser("u1", 35)
	svc, repo, userRepo := newTrialRewardsServiceWithUser(t, user)
	ctx := context.Background()

	// Unlock T1 then T2 — supersede clamps T1.ValidUntil to T2 unlock time.
	unlockTier1(ctx, svc, user)
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalReconciliation, dayOffset(user, 11), "")
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalGoalFunding, dayOffset(user, 12), "")

	_, codes, _ := svc.GetProgress(ctx, user.ID)
	if len(codes) != 2 {
		t.Fatalf("expected 2 codes (T1+T2), got %d", len(codes))
	}
	var t1Code, t2Code *domain.DiscountCode
	for i := range codes {
		switch codes[i].Tier {
		case domain.RewardTier1:
			t1Code = &codes[i]
		case domain.RewardTier2:
			t2Code = &codes[i]
		case domain.RewardTier3:
		}
	}
	if t1Code == nil || t2Code == nil {
		t.Fatalf("missing T1 or T2 code")
	}
	// Sanity: T1 is already superseded by T2's unlock.
	if t1Code.IsActive(dayOffset(user, 13)) {
		t.Fatalf("setup: T1 should be superseded by T2 unlock")
	}

	// Trial ended (within reengagement window) and T2 is now also expired.
	pastTrialEnd := time.Now().Add(-10 * 24 * time.Hour)
	stored, _ := userRepo.GetByID(ctx, user.ID)
	stored.TrialEndsAt = &pastTrialEnd
	expired := time.Now().Add(-24 * time.Hour)
	_ = repo.ExtendDiscountCodeValidity(ctx, t2Code.Code, expired)

	if err := svc.ReissueCodesOnReturn(ctx, user.ID); err != nil {
		t.Fatalf("reissue: %v", err)
	}

	// After reissue: only T2 (the highest unredeemed tier) should be active.
	// T1 was superseded — reviving it would give the user two active codes.
	_, codes, _ = svc.GetProgress(ctx, user.ID)
	now := time.Now()
	var activeTiers []domain.RewardTier
	for _, c := range codes {
		if c.IsActive(now) {
			activeTiers = append(activeTiers, c.Tier)
		}
	}
	if len(activeTiers) != 1 {
		t.Fatalf("expected exactly 1 active code after reissue, got %d (tiers=%v)", len(activeTiers), activeTiers)
	}
	if activeTiers[0] != domain.RewardTier2 {
		t.Errorf("expected T2 active after reissue, got T%d", activeTiers[0])
	}
}

// Behavior pin: if the user already has reconciliation + goal funding when
// the 7th logging day arrives, T2 should cascade-unlock alongside T1 in
// the same evaluator pass.
func TestTier2_CascadeUnlocksWithT1WhenPrereqsAlreadyMet(t *testing.T) {
	user := newTestUser("u1", 35)
	svc, _, _ := newTrialRewardsServiceWithUser(t, user)
	ctx := context.Background()

	month := user.CreatedAt.UTC().Format("2006-01")
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalReconciliation, dayOffset(user, 1), "")
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalGoalFunding, dayOffset(user, 1), "")

	progress, _, _ := svc.GetProgress(ctx, user.ID)
	if progress.Tier1UnlockedAt != nil || progress.Tier2UnlockedAt != nil {
		t.Fatalf("no tier should be unlocked before 5 transactions")
	}

	// 4 transactions — still locked.
	for i := 0; i < 4; i++ {
		_ = svc.RecordSignal(ctx, user.ID, domain.SignalTransactionInMonth, dayOffset(user, 0), month)
	}
	progress, _, _ = svc.GetProgress(ctx, user.ID)
	if progress.Tier1UnlockedAt != nil {
		t.Fatalf("T1 should not unlock at 4 transactions")
	}

	// 5th transaction — T1 and T2 should both unlock in the same pass.
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalTransactionInMonth, dayOffset(user, 0), month)
	progress, codes, _ := svc.GetProgress(ctx, user.ID)
	if progress.Tier1UnlockedAt == nil {
		t.Errorf("T1 should unlock on 5th transaction")
	}
	if progress.Tier2UnlockedAt == nil {
		t.Errorf("T2 should cascade-unlock when prereqs were already met")
	}
	if len(codes) != 2 {
		t.Errorf("expected 2 codes (T1+T2), got %d", len(codes))
	}
}

// Regression guard for the reissue fix itself: if the user has already
// redeemed a higher-tier code, we must NOT revive a lower-tier code that
// got superseded earlier — that would hand them a second discount on top
// of the one they already used.
func TestReissueCodesOnReturn_DoesNotReviveLowerTierIfHigherTierRedeemed(t *testing.T) {
	user := newTestUser("u1", 35)
	svc, _, userRepo := newTrialRewardsServiceWithUser(t, user)
	ctx := context.Background()

	unlockTier1(ctx, svc, user)
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalReconciliation, dayOffset(user, 11), "")
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalGoalFunding, dayOffset(user, 12), "")

	_, codes, _ := svc.GetProgress(ctx, user.ID)
	var t2Code *domain.DiscountCode
	for i := range codes {
		if codes[i].Tier == domain.RewardTier2 {
			t2Code = &codes[i]
		}
	}
	if t2Code == nil {
		t.Fatalf("missing T2 code")
		return
	}

	// User redeems T2 — they've collected their best reward.
	_ = svc.MarkRedeemed(ctx, t2Code.Code, "sub_xyz", dayOffset(user, 13))

	// Trial ends; user comes back within reengagement window.
	pastTrialEnd := time.Now().Add(-10 * 24 * time.Hour)
	stored, _ := userRepo.GetByID(ctx, user.ID)
	stored.TrialEndsAt = &pastTrialEnd

	if err := svc.ReissueCodesOnReturn(ctx, user.ID); err != nil {
		t.Fatalf("reissue: %v", err)
	}

	// T1 was superseded by T2's unlock; T2 has been redeemed. Nothing should
	// be active — the user already used their reward.
	_, codes, _ = svc.GetProgress(ctx, user.ID)
	now := time.Now()
	for _, c := range codes {
		if c.RedeemedAt != nil {
			continue
		}
		if c.IsActive(now) {
			t.Errorf("no unredeemed code should be active after reissue; got T%d active (valid_until=%v)", c.Tier, c.ValidUntil)
		}
	}
}

// Behavior pin: between T1 unlock and T2 unlock, T1's code is the active
// reward. The moment T2 unlocks, T1 must be superseded (no longer active)
// while T2 becomes the only active code.
func TestTier2_SupersedesTier1CodeAtUnlockMoment(t *testing.T) {
	user := newTestUser("u1", 35)
	svc, _, _ := newTrialRewardsServiceWithUser(t, user)
	ctx := context.Background()

	// Unlock T1 only.
	unlockTier1(ctx, svc, user)
	_, codes, _ := svc.GetProgress(ctx, user.ID)
	if len(codes) != 1 || codes[0].Tier != domain.RewardTier1 {
		t.Fatalf("expected 1 T1 code after T1 unlock, got %+v", codes)
	}
	betweenT1AndT2 := dayOffset(user, 10)
	if !codes[0].IsActive(betweenT1AndT2) {
		t.Fatalf("T1 code should be active between T1 and T2 unlock: %+v", codes[0])
	}

	// Unlock T2.
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalReconciliation, dayOffset(user, 11), "")
	_ = svc.RecordSignal(ctx, user.ID, domain.SignalGoalFunding, dayOffset(user, 12), "")

	_, codes, _ = svc.GetProgress(ctx, user.ID)
	afterT2 := dayOffset(user, 13)
	var active []domain.RewardTier
	for _, c := range codes {
		if c.IsActive(afterT2) {
			active = append(active, c.Tier)
		}
	}
	if len(active) != 1 {
		t.Fatalf("expected exactly 1 active code after T2 unlock, got %d (tiers=%v)", len(active), active)
	}
	if active[0] != domain.RewardTier2 {
		t.Errorf("expected T2 active, got T%d", active[0])
	}
}
