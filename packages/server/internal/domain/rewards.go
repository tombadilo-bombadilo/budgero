package domain

import "time"

// RewardTier identifies one of the three trial reward levels.
type RewardTier int

// The three trial reward levels.
const (
	RewardTier1 RewardTier = 1
	RewardTier2 RewardTier = 2
	RewardTier3 RewardTier = 3
)

// PercentOff returns the discount percentage for a tier.
func (t RewardTier) PercentOff() int {
	switch t {
	case RewardTier1:
		return 10
	case RewardTier2:
		return 20
	case RewardTier3:
		return 35
	default:
		return 0
	}
}

// IsValid reports whether the tier is one of the three known levels.
func (t RewardTier) IsValid() bool {
	return t == RewardTier1 || t == RewardTier2 || t == RewardTier3
}

// SignalKind enumerates the allowed behavior-signal kinds. Strict allowlist;
// values outside this set are rejected at the HTTP boundary.
type SignalKind string

// The strict allowlist of behavior-signal kinds.
//
// SignalAssignmentInMonth and SignalTransactionInMonth are special: their
// `day` column on trial_signals is set to the first-of-month being tracked
// (YYYY-MM-01), not the date the signal fired. This lets us count distinct
// months per kind via the existing PK (user_id, kind, day) without a new
// schema. They power the T3 "use the budget across two months" criterion.
const (
	SignalDailyLogging        SignalKind = "daily_logging"
	SignalReconciliation      SignalKind = "reconciliation"
	SignalGoalFunding         SignalKind = "goal_funding"
	SignalAssignmentInMonth   SignalKind = "assignment_in_month"
	SignalTransactionInMonth  SignalKind = "transaction_in_month"
	// Deprecated kinds — kept for backwards-compat during rollout. The
	// evaluator no longer reads these. Existing rows in trial_signals are
	// left in place; they're inert.
	SignalBudgetCycleAssign SignalKind = "budget_cycle_assign"
	SignalOverspendCover    SignalKind = "overspend_cover"
	SignalRuleApplied       SignalKind = "rule_applied"
	SignalMonthlyReview     SignalKind = "monthly_review"
)

// IsValid reports whether the signal kind is in the allowlist.
func (k SignalKind) IsValid() bool {
	switch k {
	case SignalDailyLogging, SignalReconciliation, SignalGoalFunding,
		SignalAssignmentInMonth, SignalTransactionInMonth,
		SignalBudgetCycleAssign, SignalOverspendCover,
		SignalRuleApplied, SignalMonthlyReview:
		return true
	}
	return false
}

// TrialProgress holds the authoritative tier-evaluation state for a user.
type TrialProgress struct {
	UserID                   string     `json:"user_id"`
	TrialStartedAt           time.Time  `json:"trial_started_at"`
	DailyLoggingDistinctDays int        `json:"daily_logging_distinct_days"`
	ReconciliationCount      int        `json:"reconciliation_count"`
	FirstReconciliationAt    *time.Time `json:"first_reconciliation_at,omitempty"`
	SecondReconciliationAt   *time.Time `json:"second_reconciliation_at,omitempty"`
	BudgetCycleAssignedAt    *time.Time `json:"budget_cycle_assigned_at,omitempty"`
	OverspendCoveredAt       *time.Time `json:"overspend_covered_at,omitempty"`
	GoalFundedAt             *time.Time `json:"goal_funded_at,omitempty"`
	RuleAppliedHistoricalAt  *time.Time `json:"rule_applied_historical_at,omitempty"`
	MonthlyReviewAt          *time.Time `json:"monthly_review_at,omitempty"`
	Tier1UnlockedAt          *time.Time `json:"tier1_unlocked_at,omitempty"`
	Tier2UnlockedAt          *time.Time `json:"tier2_unlocked_at,omitempty"`
	Tier3UnlockedAt          *time.Time `json:"tier3_unlocked_at,omitempty"`
	UpdatedAt                time.Time  `json:"updated_at"`
}

// HighestUnlockedTier returns the highest tier the user has unlocked, or 0.
func (p *TrialProgress) HighestUnlockedTier() RewardTier {
	if p == nil {
		return 0
	}
	if p.Tier3UnlockedAt != nil {
		return RewardTier3
	}
	if p.Tier2UnlockedAt != nil {
		return RewardTier2
	}
	if p.Tier1UnlockedAt != nil {
		return RewardTier1
	}
	return 0
}

// TrialSignal is the per-(user, kind, day) aggregate row.
type TrialSignal struct {
	UserID  string     `json:"user_id"`
	Kind    SignalKind `json:"kind"`
	Day     string     `json:"day"`
	Count   int        `json:"count"`
	FirstAt time.Time  `json:"first_at"`
	LastAt  time.Time  `json:"last_at"`
}

// DiscountCode is a per-user, single-redemption code earned by reaching a tier.
// Codes apply to the first annual purchase only and are validated server-side.
type DiscountCode struct {
	Code          string     `json:"code"`
	UserID        string     `json:"user_id"`
	Tier          RewardTier `json:"tier"`
	PercentOff    int        `json:"percent_off"`
	LSDiscountID  string     `json:"ls_discount_id,omitempty"`
	GeneratedAt   time.Time  `json:"generated_at"`
	ValidFrom     time.Time  `json:"valid_from"`
	ValidUntil    time.Time  `json:"valid_until"`
	RedeemedAt    *time.Time `json:"redeemed_at,omitempty"`
	RedeemedSubID *string    `json:"redeemed_sub_id,omitempty"`
}

// IsActive reports whether the code is in its validity window and unredeemed.
func (c *DiscountCode) IsActive(now time.Time) bool {
	if c == nil || c.RedeemedAt != nil {
		return false
	}
	return !now.Before(c.ValidFrom) && now.Before(c.ValidUntil)
}
