package application

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"errors"
	"fmt"
	"strings"
	"time"

	"budgero-server/internal/application/email"
	"budgero-server/internal/config"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/external"
	"budgero-server/internal/port/driven/repository"
	"budgero-server/internal/port/driving"

	"github.com/rs/zerolog/log"
)

// TrialRewardsService implements driving.TrialRewardsService.
type TrialRewardsService struct {
	repo           repository.TrialRewardsRepository
	userRepo       repository.UserRepository
	evaluator      *tierEvaluator
	discountIssuer external.DiscountIssuer
	emailSvc       *email.Service
	cfg            *config.Config
}

// NewTrialRewardsService creates a new TrialRewardsService. discountIssuer
// is optional; if nil, codes are only stored locally and not registered
// with the payment provider — appropriate for tests and self-host builds.
// The email service is injected later via SetEmailService since it isn't
// constructed yet at services-wiring time.
func NewTrialRewardsService(
	repo repository.TrialRewardsRepository,
	userRepo repository.UserRepository,
	discountIssuer external.DiscountIssuer,
	cfg *config.Config,
) *TrialRewardsService {
	return &TrialRewardsService{
		repo:           repo,
		userRepo:       userRepo,
		evaluator:      newTierEvaluator(repo),
		discountIssuer: discountIssuer,
		cfg:            cfg,
	}
}

// SetEmailService wires the email service after construction. When unset,
// unlock emails are skipped silently (still logged). Mirrors the existing
// pattern used for ClerkSync's email injection.
func (s *TrialRewardsService) SetEmailService(svc *email.Service) {
	s.emailSvc = svc
}

var _ driving.TrialRewardsService = (*TrialRewardsService)(nil)

// codeValidityWindow is how long an unlock code stays valid: from unlock
// through 7 days after trial end. We compute valid_until as
// trial_ends_at + postTrialGrace.
const postTrialGrace = 7 * 24 * time.Hour

// reengagementWindow is how long after trial-end a returning user can have
// their codes reissued.
const reengagementWindow = 30 * 24 * time.Hour

// RecordSignal validates and records a behavior signal, then re-evaluates
// tier unlocks. Trial signals are deliberately NOT gated by the analytics
// consent (which is opt-in and off by default) — they are functional, carry
// no PII, and stop only when the user explicitly opts out of trial-reward
// tracking in Settings. Silently drops signals from opted-out users or
// users without an active trial. `month` is required for *_in_month kinds
// and ignored for everything else.
func (s *TrialRewardsService) RecordSignal(ctx context.Context, userID string, kind domain.SignalKind, occurredAt time.Time, month string) error {
	if !kind.IsValid() {
		return fmt.Errorf("invalid signal kind: %q", kind)
	}

	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("get user: %w", err)
	}
	if user == nil {
		return fmt.Errorf("user not found: %s", userID)
	}

	if user.IsTrialSignalsDisabled {
		return nil
	}
	if !user.HasActiveTrial() {
		return nil
	}

	day, err := signalDayFor(kind, occurredAt, month)
	if err != nil {
		return err
	}
	if recordErr := s.repo.RecordSignal(ctx, userID, kind, day, occurredAt); recordErr != nil {
		return fmt.Errorf("record signal: %w", recordErr)
	}

	progress, err := s.loadOrInitProgress(ctx, user)
	if err != nil {
		return err
	}

	if applyErr := s.applySignalToProgress(ctx, progress, kind, occurredAt); applyErr != nil {
		return applyErr
	}

	newlyUnlocked, evalErr := s.evaluator.evaluate(ctx, progress, occurredAt)
	if evalErr != nil {
		return fmt.Errorf("evaluate tiers: %w", evalErr)
	}

	progress.UpdatedAt = occurredAt
	if upsertErr := s.repo.UpsertProgress(ctx, progress); upsertErr != nil {
		return fmt.Errorf("persist progress: %w", upsertErr)
	}

	for _, tier := range newlyUnlocked {
		if codeErr := s.generateCodeForUnlock(ctx, user, tier, occurredAt); codeErr != nil {
			log.Warn().Err(codeErr).
				Str("user_id", userID).
				Int("tier", int(tier)).
				Msg("failed to generate discount code for unlock")
		}
	}

	return nil
}

// GetProgress returns the user's progress and earned codes.
func (s *TrialRewardsService) GetProgress(ctx context.Context, userID string) (*domain.TrialProgress, []domain.DiscountCode, error) {
	progress, err := s.repo.GetProgress(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	codes, err := s.repo.ListDiscountCodesByUser(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	return progress, codes, nil
}

// GetProgressCounts returns derived month counts (not stored on trial_progress;
// computed from trial_signals on demand). Used by the rewards UI to show
// per-criterion progress on the T3 cross-month criteria.
func (s *TrialRewardsService) GetProgressCounts(ctx context.Context, userID string) (assignmentMonths, transactionMonths, transactionCount int, err error) {
	assignmentMonths, err = s.repo.CountDistinctMonthsForKind(ctx, userID, domain.SignalAssignmentInMonth)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("count assignment months: %w", err)
	}
	transactionMonths, err = s.repo.CountDistinctMonthsForKind(ctx, userID, domain.SignalTransactionInMonth)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("count transaction months: %w", err)
	}
	// Total transactions logged — drives the Tier 1 progress display ("X/5").
	transactionCount, err = s.repo.CountSignalsOfKind(ctx, userID, domain.SignalTransactionInMonth)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("count transactions: %w", err)
	}
	return assignmentMonths, transactionMonths, transactionCount, nil
}

// ValidateCodeForUser returns the code if it belongs to the user, is in its
// validity window, and unredeemed. Returns an error otherwise.
func (s *TrialRewardsService) ValidateCodeForUser(ctx context.Context, userID, code string) (*domain.DiscountCode, error) {
	c, err := s.repo.GetDiscountCodeByCode(ctx, code)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, errors.New("code not found")
	}
	if c.UserID != userID {
		return nil, errors.New("code does not belong to this user")
	}
	if !c.IsActive(time.Now()) {
		return nil, errors.New("code is not active")
	}
	return c, nil
}

// MarkRedeemed records that a code was used to create a subscription.
func (s *TrialRewardsService) MarkRedeemed(ctx context.Context, code, subscriptionID string, redeemedAt time.Time) error {
	if code == "" {
		return errors.New("empty code")
	}
	return s.repo.MarkDiscountCodeRedeemed(ctx, code, redeemedAt, subscriptionID)
}

// DevForceUnlock force-unlocks the given tier for the user without running
// the evaluator's criteria. Mints a code for the tier (re-using the same
// code-mint + LS-issuance path the real unlock uses) and sets prereq
// timestamps so lower tiers also read as completed. Idempotent if the tier
// is already unlocked. Dev-only — gated by DEV_TOOLS_ENABLED at the route
// layer.
func (s *TrialRewardsService) DevForceUnlock(ctx context.Context, userID string, tier domain.RewardTier) error {
	if !tier.IsValid() {
		return fmt.Errorf("invalid tier: %d", int(tier))
	}
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("get user: %w", err)
	}
	if user == nil {
		return fmt.Errorf("user not found: %s", userID)
	}

	progress, err := s.loadOrInitProgress(ctx, user)
	if err != nil {
		return err
	}

	now := time.Now()
	// Set the requested tier's unlock timestamp + all lower-tier prereqs so
	// the state reads as if the user had organically progressed.
	if tier >= domain.RewardTier1 && progress.Tier1UnlockedAt == nil {
		t := now
		progress.Tier1UnlockedAt = &t
		if progress.DailyLoggingDistinctDays < 7 {
			progress.DailyLoggingDistinctDays = 7
		}
	}
	if tier >= domain.RewardTier2 {
		if progress.Tier2UnlockedAt == nil {
			t := now
			progress.Tier2UnlockedAt = &t
		}
		if progress.FirstReconciliationAt == nil {
			t := now
			progress.FirstReconciliationAt = &t
		}
		if progress.GoalFundedAt == nil {
			t := now
			progress.GoalFundedAt = &t
		}
		if progress.ReconciliationCount < 1 {
			progress.ReconciliationCount = 1
		}
	}
	if tier >= domain.RewardTier3 {
		if progress.Tier3UnlockedAt == nil {
			t := now
			progress.Tier3UnlockedAt = &t
		}
		// T3's organic criteria (≥21 days + cross-month + multi-month
		// activity) are bypassed in dev-force-unlock — we just stamp the
		// unlock and mint the code. Seed the cross-month signal table so
		// the rewards page reads the user as having multi-month activity
		// if anyone inspects it.
		signupMonth := utcMonthString(progress.TrialStartedAt)
		nextMonth := utcMonthString(progress.TrialStartedAt.AddDate(0, 1, 0))
		_ = s.repo.RecordSignal(ctx, user.ID, domain.SignalAssignmentInMonth, signupMonth+"-01", now)
		_ = s.repo.RecordSignal(ctx, user.ID, domain.SignalAssignmentInMonth, nextMonth+"-01", now)
		_ = s.repo.RecordSignal(ctx, user.ID, domain.SignalTransactionInMonth, signupMonth+"-01", now)
		_ = s.repo.RecordSignal(ctx, user.ID, domain.SignalTransactionInMonth, nextMonth+"-01", now)
	}
	progress.UpdatedAt = now
	if err := s.repo.UpsertProgress(ctx, progress); err != nil {
		return fmt.Errorf("persist progress: %w", err)
	}

	// Mint codes for every tier from 1..tier that doesn't already have one.
	// Skip the email side-effect — dev tooling shouldn't blast test inboxes.
	prevEmail := s.emailSvc
	s.emailSvc = nil
	defer func() { s.emailSvc = prevEmail }()
	for t := domain.RewardTier1; t <= tier; t++ {
		if err := s.generateCodeForUnlock(ctx, user, t, now); err != nil {
			log.Warn().Err(err).Str("user_id", userID).Int("tier", int(t)).
				Msg("dev: failed to mint code")
		}
	}
	return nil
}

// DevReset wipes the user's trial-rewards state.
func (s *TrialRewardsService) DevReset(ctx context.Context, userID string) error {
	return s.repo.DevReset(ctx, userID)
}

// ReissueCodesOnReturn extends expired codes by 7 days for users returning
// within the re-engagement window. Idempotent.
func (s *TrialRewardsService) ReissueCodesOnReturn(ctx context.Context, userID string) error {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return err
	}
	if user == nil || user.TrialEndsAt == nil {
		return nil
	}

	now := time.Now()
	trialEnd := *user.TrialEndsAt
	if now.Before(trialEnd) {
		return nil
	}
	if now.After(trialEnd.Add(reengagementWindow)) {
		return nil
	}

	codes, err := s.repo.ListDiscountCodesByUser(ctx, userID)
	if err != nil {
		return err
	}
	// Only the user's highest-earned tier is eligible for reissue. Lower
	// tiers were superseded when the higher tier unlocked, and reviving
	// them would resurrect multiple active codes — breaking the one-
	// active-code invariant supersession enforces. If the highest-tier
	// code has already been redeemed, the user has collected their reward
	// and there's nothing to reissue.
	var highest *domain.DiscountCode
	for i := range codes {
		c := &codes[i]
		if highest == nil || c.Tier > highest.Tier {
			highest = c
		}
	}
	if highest == nil || highest.RedeemedAt != nil {
		return nil
	}
	if highest.ValidUntil.After(now) {
		return nil
	}
	newValidUntil := now.Add(postTrialGrace)
	if err := s.repo.ExtendDiscountCodeValidity(ctx, highest.Code, newValidUntil); err != nil {
		log.Warn().Err(err).Str("code", highest.Code).Msg("failed to extend code validity")
	}
	return nil
}

// loadOrInitProgress fetches the user's progress row, creating it if absent.
func (s *TrialRewardsService) loadOrInitProgress(ctx context.Context, user *domain.User) (*domain.TrialProgress, error) {
	progress, err := s.repo.GetProgress(ctx, user.ID)
	if err != nil {
		return nil, fmt.Errorf("get progress: %w", err)
	}
	if progress != nil {
		return progress, nil
	}
	return &domain.TrialProgress{
		UserID:         user.ID,
		TrialStartedAt: user.CreatedAt,
		UpdatedAt:      time.Now(),
	}, nil
}

// signalDayFor decides what to use as the trial_signals.day value. For
// daily-action kinds (daily_logging, reconciliation, etc.) this is the UTC
// date when the signal fired. For the *_in_month kinds it's the first day
// of the tracked month so the (user, kind, day) PK auto-collapses to one
// row per distinct month.
func signalDayFor(kind domain.SignalKind, occurredAt time.Time, month string) (string, error) {
	switch kind {
	case domain.SignalAssignmentInMonth, domain.SignalTransactionInMonth:
		if !isValidMonthString(month) {
			return "", fmt.Errorf("month must be 'YYYY-MM' for kind %q, got %q", kind, month)
		}
		return month + "-01", nil
	default:
		return utcDayString(occurredAt), nil
	}
}

// isValidMonthString reports whether s is a parseable YYYY-MM date string.
func isValidMonthString(s string) bool {
	if len(s) != 7 || s[4] != '-' {
		return false
	}
	if _, err := time.Parse("2006-01", s); err != nil {
		return false
	}
	return true
}

// applySignalToProgress mutates progress in place to reflect a new signal.
// "First occurrence" timestamps are only set if currently nil; the COALESCE
// in UpsertTrialProgress provides the same guarantee at the storage layer.
//
// SignalAssignmentInMonth and SignalTransactionInMonth are pure signal-table
// records (no progress-row fields). They're intentional no-ops here — the
// T3 evaluator counts distinct months directly from trial_signals.
func (s *TrialRewardsService) applySignalToProgress(ctx context.Context, p *domain.TrialProgress, kind domain.SignalKind, at time.Time) error {
	switch kind {
	case domain.SignalDailyLogging:
		// DailyLoggingDistinctDays is displayed in the rewards UI as T1 progress. Count only days within the first 10 so the display doesn't inflate past the original criterion window.
		startDay := utcDayString(p.TrialStartedAt)
		endDay := utcDayString(p.TrialStartedAt.Add(9 * 24 * time.Hour))
		count, err := s.repo.CountDistinctLoggingDaysInRange(ctx, p.UserID, startDay, endDay)
		if err != nil {
			return fmt.Errorf("count logging days: %w", err)
		}
		p.DailyLoggingDistinctDays = count

	case domain.SignalReconciliation:
		total, err := s.repo.CountSignalsOfKind(ctx, p.UserID, domain.SignalReconciliation)
		if err != nil {
			return fmt.Errorf("count reconciliations: %w", err)
		}
		p.ReconciliationCount = total
		if total >= 1 && p.FirstReconciliationAt == nil {
			t := at
			p.FirstReconciliationAt = &t
		}
		if total >= 2 && p.SecondReconciliationAt == nil {
			t := at
			p.SecondReconciliationAt = &t
		}

	case domain.SignalGoalFunding:
		if p.GoalFundedAt == nil {
			t := at
			p.GoalFundedAt = &t
		}

	case domain.SignalAssignmentInMonth, domain.SignalTransactionInMonth:
		// Tracked exclusively via trial_signals rows (PK collapses to one
		// row per distinct month); no progress field to update.

	// Deprecated kinds — kept for backwards compatibility during rollout.
	// The evaluator no longer reads these fields. Harmless side-effect.
	case domain.SignalBudgetCycleAssign:
		if p.BudgetCycleAssignedAt == nil {
			t := at
			p.BudgetCycleAssignedAt = &t
		}
	case domain.SignalOverspendCover:
		if p.OverspendCoveredAt == nil {
			t := at
			p.OverspendCoveredAt = &t
		}
	case domain.SignalRuleApplied:
		if p.RuleAppliedHistoricalAt == nil {
			t := at
			p.RuleAppliedHistoricalAt = &t
		}
	case domain.SignalMonthlyReview:
		if p.MonthlyReviewAt == nil {
			t := at
			p.MonthlyReviewAt = &t
		}
	}
	return nil
}

// generateCodeForUnlock mints a per-user code, registers it with the payment provider (when wired), persists it, and fires the unlock email.
func (s *TrialRewardsService) generateCodeForUnlock(ctx context.Context, user *domain.User, tier domain.RewardTier, unlockAt time.Time) error {
	if existing, err := s.repo.GetDiscountCodeByUserTier(ctx, user.ID, tier); err == nil && existing != nil {
		return nil
	}

	codeStr, err := mintCode(tier)
	if err != nil {
		return fmt.Errorf("mint code: %w", err)
	}

	validUntil := unlockAt.Add(postTrialGrace)
	if user.TrialEndsAt != nil {
		validUntil = user.TrialEndsAt.Add(postTrialGrace)
	}

	code := &domain.DiscountCode{
		Code:        codeStr,
		UserID:      user.ID,
		Tier:        tier,
		PercentOff:  tier.PercentOff(),
		GeneratedAt: unlockAt,
		ValidFrom:   unlockAt,
		ValidUntil:  validUntil,
	}

	if s.discountIssuer != nil {
		externalID, err := s.discountIssuer.IssueDiscount(ctx, codeStr, tier.PercentOff(), "", validUntil)
		if err != nil {
			// Log and continue — the local code is still authoritative for our
			// records; we'll retry/sync in a follow-up reconciliation pass.
			log.Error().Err(err).
				Str("user_id", user.ID).
				Int("tier", int(tier)).
				Str("code", codeStr).
				Msg("failed to register discount with payment provider; code stored locally")
		} else {
			code.LSDiscountID = externalID
		}
	}

	if err := s.repo.CreateDiscountCode(ctx, code); err != nil {
		return fmt.Errorf("persist code: %w", err)
	}

	log.Info().
		Str("user_id", user.ID).
		Int("tier", int(tier)).
		Str("code", codeStr).
		Bool("registered_with_ls", code.LSDiscountID != "").
		Msg("trial reward tier unlocked, code minted")

	// Supersede any unredeemed lower-tier codes — the user should only ever
	// have one active code at a time. Failures here log but don't block the
	// new code; worst case the user has multiple codes for a window.
	s.supersedeLowerTierCodes(ctx, user.ID, tier, unlockAt)

	s.sendUnlockEmail(ctx, user, tier, codeStr, validUntil)

	return nil
}

// supersedeLowerTierCodes invalidates all unredeemed codes for the user
// whose tier is strictly below newTier. Each is deleted from the payment
// provider (LS) and has its valid_until clamped so IsActive returns false,
// while preserving the row for audit / "you earned this tier" history.
func (s *TrialRewardsService) supersedeLowerTierCodes(ctx context.Context, userID string, newTier domain.RewardTier, asOf time.Time) {
	codes, err := s.repo.ListDiscountCodesByUser(ctx, userID)
	if err != nil {
		log.Warn().Err(err).Str("user_id", userID).Msg("supersede: list codes failed")
		return
	}
	for i := range codes {
		c := &codes[i]
		if c.Tier >= newTier || c.RedeemedAt != nil {
			continue
		}
		if !c.ValidUntil.After(asOf) {
			continue // already expired/superseded
		}
		if c.LSDiscountID != "" && s.discountIssuer != nil {
			if revokeErr := s.discountIssuer.RevokeDiscount(ctx, c.LSDiscountID); revokeErr != nil {
				log.Warn().Err(revokeErr).
					Str("user_id", userID).
					Str("code", c.Code).
					Str("ls_discount_id", c.LSDiscountID).
					Msg("supersede: LS revoke failed; clamping locally anyway")
			}
		}
		if extendErr := s.repo.ExtendDiscountCodeValidity(ctx, c.Code, asOf); extendErr != nil {
			log.Warn().Err(extendErr).
				Str("user_id", userID).Str("code", c.Code).
				Msg("supersede: failed to clamp valid_until")
			continue
		}
		log.Info().
			Str("user_id", userID).
			Int("tier", int(c.Tier)).
			Str("code", c.Code).
			Msg("trial reward code superseded by higher tier")
	}
}

// sendUnlockEmail fires the per-tier unlock email. Skipped silently when the
// email service isn't configured (self-host, missing RESEND_API_KEY) or when
// the user is on the synthesized clerk_id@clerk.user placeholder address.
// All errors are logged and swallowed — unlocks must not be blocked by email.
func (s *TrialRewardsService) sendUnlockEmail(ctx context.Context, user *domain.User, tier domain.RewardTier, code string, validUntil time.Time) {
	if s.emailSvc == nil {
		return
	}
	if user.Email == "" || strings.HasSuffix(user.Email, "@clerk.user") {
		return
	}
	template := tierUnlockTemplate(tier)
	if template == "" {
		return
	}
	p := email.PersonalizationData{
		UnlockCode: code,
		Tier:       int(tier),
		PercentOff: tier.PercentOff(),
		ValidUntil: validUntil,
	}
	if err := s.emailSvc.SendOnceWithPersonalization(ctx, user.ID, user.Email, user.Name, template, p); err != nil {
		log.Warn().Err(err).
			Str("user_id", user.ID).
			Int("tier", int(tier)).
			Str("template", template).
			Msg("failed to send tier-unlock email")
	}
}

func tierUnlockTemplate(t domain.RewardTier) string {
	switch t {
	case domain.RewardTier1:
		return email.TemplateTier1Unlocked
	case domain.RewardTier2:
		return email.TemplateTier2Unlocked
	case domain.RewardTier3:
		return email.TemplateTier3Unlocked
	}
	return ""
}

// mintCode returns a code shaped like "TIER2A7K9P3MN". LS discount codes
// are restricted to uppercase letters + digits (no hyphens or other
// punctuation per their docs), so we concatenate without a separator. The
// 8-char base32 suffix gives ~40 bits of entropy — plenty for codes that
// are ultimately validated server-side against (user_id, tier).
func mintCode(tier domain.RewardTier) (string, error) {
	const suffixBytes = 5
	buf := make([]byte, suffixBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	suffix := strings.TrimRight(base32.StdEncoding.EncodeToString(buf), "=")
	return fmt.Sprintf("TIER%d%s", int(tier), suffix), nil
}
