package application

import (
	"context"
	"time"

	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
)

// tierEvaluator computes tier unlocks from a TrialProgress snapshot. It is
// the decision layer — it never writes — but it depends on the repo to
// query windowed counts (distinct logging days within a date range and
// distinct months for the *_in_month signal kinds).
type tierEvaluator struct {
	repo repository.TrialRewardsRepository
}

func newTierEvaluator(repo repository.TrialRewardsRepository) *tierEvaluator {
	return &tierEvaluator{repo: repo}
}

// t3MinTrialDaysFloor is the minimum number of days that must have elapsed
// since the user's signup before T3 can unlock, regardless of how quickly
// they cross a calendar boundary. Without this, a user signing up on the
// 28th of a month would unlock T3 a few days later when the calendar rolls
// over — undermining the "longevity / persistence" framing.
const t3MinTrialDaysFloor = 21 * 24 * time.Hour

// tier1MinTransactions is how many transactions a user must log (any time
// during the trial) to unlock Tier 1. transaction_in_month fires once per
// transaction add, so its summed count is the running transaction total.
const tier1MinTransactions = 5

// evaluate mutates p in place, setting tier-unlock timestamps for any tier
// whose criteria are met as of `now`, and returns the list of newly
// unlocked tiers (in ascending tier order).
//
// Criteria (current product spec):
//
//	T1 — Foundation: ≥5 transactions logged (any time during the trial).
//
//	T2 — Discipline: T1 + at least one reconciliation completed + at least
//	one goal_funded signal (a category's goal was satisfied).
//
//	T3 — Persistence: T2 +
//	    - ≥21 days since signup (floor — prevents late-month signups from
//	      unlocking T3 in the first week)
//	    - now is in a calendar month strictly later than signup_month
//	      (the user has actually used the app across a calendar boundary)
//	    - assignments to ≥2 distinct calendar months
//	    - transactions whose dates fall in ≥2 distinct calendar months
//
// T1 has no early cutoff — it can be earned any time during the trial once
// 5 transactions are logged. T3 also has no hard cutoff — once criteria are
// met after T2 it fires.
func (e *tierEvaluator) evaluate(ctx context.Context, p *domain.TrialProgress, now time.Time) ([]domain.RewardTier, error) {
	var unlocked []domain.RewardTier

	if p.Tier1UnlockedAt == nil {
		ok, err := e.qualifiesForTier1(ctx, p)
		if err != nil {
			return nil, err
		}
		if ok {
			unlock := now
			p.Tier1UnlockedAt = &unlock
			unlocked = append(unlocked, domain.RewardTier1)
		}
	}

	if p.Tier1UnlockedAt != nil && p.Tier2UnlockedAt == nil {
		if e.qualifiesForTier2(p) {
			unlock := now
			p.Tier2UnlockedAt = &unlock
			unlocked = append(unlocked, domain.RewardTier2)
		}
	}

	if p.Tier2UnlockedAt != nil && p.Tier3UnlockedAt == nil {
		ok, err := e.qualifiesForTier3(ctx, p, now)
		if err != nil {
			return nil, err
		}
		if ok {
			unlock := now
			p.Tier3UnlockedAt = &unlock
			unlocked = append(unlocked, domain.RewardTier3)
		}
	}

	return unlocked, nil
}

func (e *tierEvaluator) qualifiesForTier1(ctx context.Context, p *domain.TrialProgress) (bool, error) {
	count, err := e.repo.CountSignalsOfKind(ctx, p.UserID, domain.SignalTransactionInMonth)
	if err != nil {
		return false, err
	}
	return count >= tier1MinTransactions, nil
}

func (e *tierEvaluator) qualifiesForTier2(p *domain.TrialProgress) bool {
	return p.FirstReconciliationAt != nil && p.GoalFundedAt != nil
}

func (e *tierEvaluator) qualifiesForTier3(ctx context.Context, p *domain.TrialProgress, now time.Time) (bool, error) {
	// Floor: at least 21 days since signup.
	if now.Sub(p.TrialStartedAt) < t3MinTrialDaysFloor {
		return false, nil
	}
	// Calendar boundary: now must be in a month strictly later than the
	// month the user signed up in.
	if utcMonthString(now) <= utcMonthString(p.TrialStartedAt) {
		return false, nil
	}
	// Assignments: at least 2 distinct calendar months tracked.
	assignmentMonths, err := e.repo.CountDistinctMonthsForKind(ctx, p.UserID, domain.SignalAssignmentInMonth)
	if err != nil {
		return false, err
	}
	if assignmentMonths < 2 {
		return false, nil
	}
	// Transactions: at least 2 distinct calendar months by transaction date.
	transactionMonths, err := e.repo.CountDistinctMonthsForKind(ctx, p.UserID, domain.SignalTransactionInMonth)
	if err != nil {
		return false, err
	}
	return transactionMonths >= 2, nil
}

// utcDayString formats a time as 'YYYY-MM-DD' in UTC, matching the format
// used in trial_signals.day for daily-action kinds.
func utcDayString(t time.Time) string {
	return t.UTC().Format("2006-01-02")
}

// utcMonthString formats a time as 'YYYY-MM' in UTC, used to compare
// calendar months.
func utcMonthString(t time.Time) string {
	return t.UTC().Format("2006-01")
}
