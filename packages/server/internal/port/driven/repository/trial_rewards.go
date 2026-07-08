package repository

import (
	"context"
	"time"

	"budgero-server/internal/domain"
)

// TrialRewardsRepository persists trial behavior signals, evaluated tier
// progress, and earned discount codes.
type TrialRewardsRepository interface {
	// RecordSignal upserts a (user, kind, day) row, incrementing the count on
	// repeat hits within the same UTC day.
	RecordSignal(ctx context.Context, userID string, kind domain.SignalKind, day string, at time.Time) error

	// CountDistinctLoggingDaysInRange returns the number of distinct UTC days
	// in [fromDay, toDay] inclusive on which the user fired a daily_logging
	// signal. Day strings are 'YYYY-MM-DD'.
	CountDistinctLoggingDaysInRange(ctx context.Context, userID, fromDay, toDay string) (int, error)

	// CountSignalsOfKind returns the total occurrence count (summed across
	// days) for the given signal kind for a user.
	CountSignalsOfKind(ctx context.Context, userID string, kind domain.SignalKind) (int, error)

	// CountDistinctMonthsForKind counts the distinct rows for a kind. For
	// the *_in_month signal kinds (whose `day` column stores YYYY-MM-01 of
	// the month tracked, not the day of action), this returns the number of
	// distinct calendar months the user has had activity in for that kind.
	CountDistinctMonthsForKind(ctx context.Context, userID string, kind domain.SignalKind) (int, error)

	// GetEarliestSignalAt returns the earliest timestamp at which the user
	// fired a signal of the given kind, or nil if none exist.
	GetEarliestSignalAt(ctx context.Context, userID string, kind domain.SignalKind) (*time.Time, error)

	// GetNthSignalAt returns the timestamp of the nth occurrence of a signal
	// kind for a user (0-indexed by day-row order). Returns nil if fewer than
	// n+1 rows exist.
	GetNthSignalAt(ctx context.Context, userID string, kind domain.SignalKind, n int) (*time.Time, error)

	// CountUserMutationsForForgeryCheck returns the count of mutation_log rows
	// for the user. Used as a coarse forgery-detection layer when evaluating
	// tier unlocks: a user claiming many signals with zero mutations is bogus.
	CountUserMutationsForForgeryCheck(ctx context.Context, userID string) (int, error)

	// UpsertProgress writes the denormalized tier-evaluation state for a user.
	// Tier-unlock timestamps and "first occurrence" timestamps use COALESCE
	// semantics on update so they're never overwritten once set.
	UpsertProgress(ctx context.Context, progress *domain.TrialProgress) error

	// GetProgress returns the user's denormalized progress, or nil if none
	// exists yet.
	GetProgress(ctx context.Context, userID string) (*domain.TrialProgress, error)

	// CreateDiscountCode persists a newly generated discount code. Returns an
	// error if the (user, tier) pair already has a code.
	CreateDiscountCode(ctx context.Context, code *domain.DiscountCode) error

	// GetDiscountCodeByCode looks up a code by its string value.
	GetDiscountCodeByCode(ctx context.Context, code string) (*domain.DiscountCode, error)

	// GetDiscountCodeByUserTier returns the user's code for a tier, or nil.
	GetDiscountCodeByUserTier(ctx context.Context, userID string, tier domain.RewardTier) (*domain.DiscountCode, error)

	// ListDiscountCodesByUser returns all codes earned by a user, ordered by
	// tier ascending.
	ListDiscountCodesByUser(ctx context.Context, userID string) ([]domain.DiscountCode, error)

	// MarkDiscountCodeRedeemed sets the redeemed_at timestamp and the linked
	// subscription ID. No-op if already redeemed.
	MarkDiscountCodeRedeemed(ctx context.Context, code string, redeemedAt time.Time, subID string) error

	// ExtendDiscountCodeValidity updates a code's expiry. Used when a user
	// returns within the re-engagement window and we re-issue (extend) their
	// code.
	ExtendDiscountCodeValidity(ctx context.Context, code string, validUntil time.Time) error

	// DevReset wipes all trial-rewards state for a user (signals, progress,
	// and discount codes). Backstop for QA tooling — the dev-only endpoint
	// uses this to put a tester back at a clean slate. Production callers
	// must NOT use this; the rewards system is otherwise authoritative.
	DevReset(ctx context.Context, userID string) error
}
