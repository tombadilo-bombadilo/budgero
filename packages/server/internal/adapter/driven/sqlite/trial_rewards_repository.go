package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
)

// TrialRewardsRepository persists trial behavior signals, evaluated tier
// progress, and earned discount codes against SQLite.
type TrialRewardsRepository struct {
	queries *sqlc.Queries
}

// NewTrialRewardsRepository creates a new TrialRewardsRepository.
func NewTrialRewardsRepository(queries *sqlc.Queries) *TrialRewardsRepository {
	return &TrialRewardsRepository{queries: queries}
}

var _ repository.TrialRewardsRepository = (*TrialRewardsRepository)(nil)

// RecordSignal upserts a (user, kind, day) row, incrementing the count on
// repeat hits within the same UTC day.
func (r *TrialRewardsRepository) RecordSignal(ctx context.Context, userID string, kind domain.SignalKind, day string, at time.Time) error {
	return r.queries.UpsertTrialSignal(ctx, sqlc.UpsertTrialSignalParams{
		UserID:  userID,
		Kind:    string(kind),
		Day:     day,
		FirstAt: at,
		LastAt:  at,
	})
}

// CountDistinctLoggingDaysInRange returns the number of distinct UTC days in
// [fromDay, toDay] inclusive on which the user fired a daily_logging signal.
func (r *TrialRewardsRepository) CountDistinctLoggingDaysInRange(ctx context.Context, userID, fromDay, toDay string) (int, error) {
	count, err := r.queries.CountDistinctLoggingDaysInRange(ctx, sqlc.CountDistinctLoggingDaysInRangeParams{
		UserID: userID,
		Day:    fromDay,
		Day_2:  toDay,
	})
	if err != nil {
		return 0, err
	}
	return int(count), nil
}

// CountSignalsOfKind returns the total occurrence count for the given kind.
func (r *TrialRewardsRepository) CountSignalsOfKind(ctx context.Context, userID string, kind domain.SignalKind) (int, error) {
	total, err := r.queries.CountSignalsOfKind(ctx, sqlc.CountSignalsOfKindParams{
		UserID: userID,
		Kind:   string(kind),
	})
	if err != nil {
		return 0, err
	}
	return int(total), nil
}

// CountDistinctMonthsForKind returns the number of distinct rows for the
// given (user, kind) pair. Meaningful only for the *_in_month signal kinds.
func (r *TrialRewardsRepository) CountDistinctMonthsForKind(ctx context.Context, userID string, kind domain.SignalKind) (int, error) {
	total, err := r.queries.CountDistinctMonthsForKind(ctx, sqlc.CountDistinctMonthsForKindParams{
		UserID: userID,
		Kind:   string(kind),
	})
	if err != nil {
		return 0, err
	}
	return int(total), nil
}

// GetEarliestSignalAt returns the earliest timestamp at which the user fired
// a signal of the given kind, or nil if none exist.
func (r *TrialRewardsRepository) GetEarliestSignalAt(ctx context.Context, userID string, kind domain.SignalKind) (*time.Time, error) {
	t, err := r.queries.GetEarliestSignalAt(ctx, sqlc.GetEarliestSignalAtParams{
		UserID: userID,
		Kind:   string(kind),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &t, nil
}

// GetNthSignalAt returns the timestamp of the nth (0-indexed by ascending
// first_at) signal of a kind for a user, or nil if fewer than n+1 exist.
func (r *TrialRewardsRepository) GetNthSignalAt(ctx context.Context, userID string, kind domain.SignalKind, n int) (*time.Time, error) {
	t, err := r.queries.GetNthSignalAt(ctx, sqlc.GetNthSignalAtParams{
		UserID: userID,
		Kind:   string(kind),
		Offset: int64(n),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &t, nil
}

// CountUserMutationsForForgeryCheck returns the count of mutation_log rows
// for the user — used as a coarse sanity check before honoring tier unlocks.
func (r *TrialRewardsRepository) CountUserMutationsForForgeryCheck(ctx context.Context, userID string) (int, error) {
	count, err := r.queries.CountUserMutationsForForgeryCheck(ctx, userID)
	if err != nil {
		return 0, err
	}
	return int(count), nil
}

// UpsertProgress writes the denormalized tier-evaluation state. Tier-unlock
// and "first occurrence" timestamps use COALESCE on update so they're never
// overwritten once set.
func (r *TrialRewardsRepository) UpsertProgress(ctx context.Context, p *domain.TrialProgress) error {
	return r.queries.UpsertTrialProgress(ctx, sqlc.UpsertTrialProgressParams{
		UserID:                   p.UserID,
		TrialStartedAt:           p.TrialStartedAt,
		DailyLoggingDistinctDays: int64(p.DailyLoggingDistinctDays),
		ReconciliationCount:      int64(p.ReconciliationCount),
		FirstReconciliationAt:    ToNullTime(p.FirstReconciliationAt),
		SecondReconciliationAt:   ToNullTime(p.SecondReconciliationAt),
		BudgetCycleAssignedAt:    ToNullTime(p.BudgetCycleAssignedAt),
		OverspendCoveredAt:       ToNullTime(p.OverspendCoveredAt),
		GoalFundedAt:             ToNullTime(p.GoalFundedAt),
		RuleAppliedHistoricalAt:  ToNullTime(p.RuleAppliedHistoricalAt),
		MonthlyReviewAt:          ToNullTime(p.MonthlyReviewAt),
		Tier1UnlockedAt:          ToNullTime(p.Tier1UnlockedAt),
		Tier2UnlockedAt:          ToNullTime(p.Tier2UnlockedAt),
		Tier3UnlockedAt:          ToNullTime(p.Tier3UnlockedAt),
		UpdatedAt:                p.UpdatedAt,
	})
}

// GetProgress returns the user's denormalized progress, or nil if none yet.
func (r *TrialRewardsRepository) GetProgress(ctx context.Context, userID string) (*domain.TrialProgress, error) {
	row, err := r.queries.GetTrialProgress(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return toTrialProgress(&row), nil
}

// CreateDiscountCode persists a newly generated code. Errors if (user, tier)
// already has a code (UNIQUE constraint).
func (r *TrialRewardsRepository) CreateDiscountCode(ctx context.Context, c *domain.DiscountCode) error {
	return r.queries.CreateDiscountCode(ctx, sqlc.CreateDiscountCodeParams{
		Code:         c.Code,
		UserID:       c.UserID,
		Tier:         int64(c.Tier),
		PercentOff:   int64(c.PercentOff),
		LsDiscountID: c.LSDiscountID,
		GeneratedAt:  c.GeneratedAt,
		ValidFrom:    c.ValidFrom,
		ValidUntil:   c.ValidUntil,
	})
}

// GetDiscountCodeByCode looks up a code by its string value.
func (r *TrialRewardsRepository) GetDiscountCodeByCode(ctx context.Context, code string) (*domain.DiscountCode, error) {
	row, err := r.queries.GetDiscountCodeByCode(ctx, code)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return toDiscountCode(&row), nil
}

// GetDiscountCodeByUserTier returns the user's code for a tier, or nil.
func (r *TrialRewardsRepository) GetDiscountCodeByUserTier(ctx context.Context, userID string, tier domain.RewardTier) (*domain.DiscountCode, error) {
	row, err := r.queries.GetDiscountCodeByUserTier(ctx, sqlc.GetDiscountCodeByUserTierParams{
		UserID: userID,
		Tier:   int64(tier),
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return toDiscountCode(&row), nil
}

// ListDiscountCodesByUser returns all codes earned by a user, tier ascending.
func (r *TrialRewardsRepository) ListDiscountCodesByUser(ctx context.Context, userID string) ([]domain.DiscountCode, error) {
	rows, err := r.queries.ListDiscountCodesByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]domain.DiscountCode, 0, len(rows))
	for i := range rows {
		out = append(out, *toDiscountCode(&rows[i]))
	}
	return out, nil
}

// MarkDiscountCodeRedeemed sets the redemption fields. No-op if already set.
func (r *TrialRewardsRepository) MarkDiscountCodeRedeemed(ctx context.Context, code string, redeemedAt time.Time, subID string) error {
	return r.queries.MarkDiscountCodeRedeemed(ctx, sqlc.MarkDiscountCodeRedeemedParams{
		RedeemedAt:    sql.NullTime{Time: redeemedAt, Valid: true},
		RedeemedSubID: sql.NullString{String: subID, Valid: subID != ""},
		Code:          code,
	})
}

// ExtendDiscountCodeValidity updates a code's expiry.
func (r *TrialRewardsRepository) ExtendDiscountCodeValidity(ctx context.Context, code string, validUntil time.Time) error {
	return r.queries.ExtendDiscountCodeValidity(ctx, sqlc.ExtendDiscountCodeValidityParams{
		ValidUntil: validUntil,
		Code:       code,
	})
}

// DevReset deletes all trial-rewards rows for a user. Sequence runs without
// a transaction; partial failures leave behind some rows but the operation
// is idempotent — the caller can retry.
func (r *TrialRewardsRepository) DevReset(ctx context.Context, userID string) error {
	if err := r.queries.DevDeleteTrialDiscountCodesForUser(ctx, userID); err != nil {
		return err
	}
	if err := r.queries.DevDeleteTrialProgressForUser(ctx, userID); err != nil {
		return err
	}
	return r.queries.DevDeleteTrialSignalsForUser(ctx, userID)
}

func toTrialProgress(p *sqlc.TrialProgress) *domain.TrialProgress {
	out := &domain.TrialProgress{
		UserID:                   p.UserID,
		TrialStartedAt:           p.TrialStartedAt,
		DailyLoggingDistinctDays: int(p.DailyLoggingDistinctDays),
		ReconciliationCount:      int(p.ReconciliationCount),
		UpdatedAt:                p.UpdatedAt,
	}
	if p.FirstReconciliationAt.Valid {
		out.FirstReconciliationAt = &p.FirstReconciliationAt.Time
	}
	if p.SecondReconciliationAt.Valid {
		out.SecondReconciliationAt = &p.SecondReconciliationAt.Time
	}
	if p.BudgetCycleAssignedAt.Valid {
		out.BudgetCycleAssignedAt = &p.BudgetCycleAssignedAt.Time
	}
	if p.OverspendCoveredAt.Valid {
		out.OverspendCoveredAt = &p.OverspendCoveredAt.Time
	}
	if p.GoalFundedAt.Valid {
		out.GoalFundedAt = &p.GoalFundedAt.Time
	}
	if p.RuleAppliedHistoricalAt.Valid {
		out.RuleAppliedHistoricalAt = &p.RuleAppliedHistoricalAt.Time
	}
	if p.MonthlyReviewAt.Valid {
		out.MonthlyReviewAt = &p.MonthlyReviewAt.Time
	}
	if p.Tier1UnlockedAt.Valid {
		out.Tier1UnlockedAt = &p.Tier1UnlockedAt.Time
	}
	if p.Tier2UnlockedAt.Valid {
		out.Tier2UnlockedAt = &p.Tier2UnlockedAt.Time
	}
	if p.Tier3UnlockedAt.Valid {
		out.Tier3UnlockedAt = &p.Tier3UnlockedAt.Time
	}
	return out
}

func toDiscountCode(c *sqlc.TrialDiscountCode) *domain.DiscountCode {
	out := &domain.DiscountCode{
		Code:         c.Code,
		UserID:       c.UserID,
		Tier:         domain.RewardTier(c.Tier),
		PercentOff:   int(c.PercentOff),
		LSDiscountID: c.LsDiscountID,
		GeneratedAt:  c.GeneratedAt,
		ValidFrom:    c.ValidFrom,
		ValidUntil:   c.ValidUntil,
	}
	if c.RedeemedAt.Valid {
		out.RedeemedAt = &c.RedeemedAt.Time
	}
	if c.RedeemedSubID.Valid {
		out.RedeemedSubID = &c.RedeemedSubID.String
	}
	return out
}
