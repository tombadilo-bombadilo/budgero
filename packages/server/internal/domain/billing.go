package domain

import (
	"strings"
	"time"
)

// SubscriptionStatus constants.
const (
	SubscriptionActive    = "active"
	SubscriptionTrialing  = "trialing"
	SubscriptionOnTrial   = "on_trial"
	SubscriptionCancelled = "cancelled"
	SubscriptionPastDue   = "past_due"
	SubscriptionLifetime  = "lifetime"
	SubscriptionExpired   = "expired"
	SubscriptionInactive  = "inactive"
	SubscriptionPaused    = "paused"
)

// NormalizeSubscriptionStatus returns a canonical lowercase status string.
func NormalizeSubscriptionStatus(status string) string {
	normalized := strings.ToLower(strings.TrimSpace(status))
	if normalized == "" {
		return SubscriptionInactive
	}
	return normalized
}

// EffectiveSubscriptionStatus derives the status users should see in the app.
// It keeps time-sensitive trial/cancelled/past_due states from lingering after
// their access window has already ended.
func EffectiveSubscriptionStatus(
	status string,
	trialEndsAt *time.Time,
	subscriptionEndsAt *time.Time,
	currentPeriodEnd *time.Time,
) string {
	normalized := NormalizeSubscriptionStatus(status)
	now := time.Now()

	switch normalized {
	case SubscriptionOnTrial, SubscriptionTrialing:
		if trialEndsAt != nil && trialEndsAt.After(now) {
			return SubscriptionTrialing
		}
		return SubscriptionExpired
	case SubscriptionCancelled:
		if subscriptionEndsAt != nil && subscriptionEndsAt.After(now) {
			return SubscriptionCancelled
		}
		return SubscriptionExpired
	case SubscriptionPastDue:
		if currentPeriodEnd != nil && currentPeriodEnd.After(now) {
			return SubscriptionPastDue
		}
		return SubscriptionExpired
	case SubscriptionActive,
		SubscriptionLifetime,
		SubscriptionExpired,
		SubscriptionInactive,
		SubscriptionPaused:
		return normalized
	default:
		return SubscriptionInactive
	}
}

// SubscriptionUpdate contains fields for updating a subscription.
type SubscriptionUpdate struct {
	Status           string
	SubscriptionID   *string
	CustomerID       *string
	VariantID        *string
	SubscriptionEnds *time.Time
	CurrentPeriodEnd *time.Time
	TrialEnds        *time.Time
}

// SubscriptionInfo contains subscription data from external provider (e.g., LemonSqueezy).
type SubscriptionInfo struct {
	Status           string
	SubscriptionID   string
	VariantID        string
	EndsAt           *time.Time
	TrialEndsAt      *time.Time
	CurrentPeriodEnd *time.Time
}

// Entitlement represents what features/access a user has.
type Entitlement struct {
	HasWorkspaceAccess     bool       `json:"has_workspace_access"`
	HasCollaborationAccess bool       `json:"has_collaboration_access"`
	IsFoundingMember       bool       `json:"is_founding_member"`
	HasBetaAccess          bool       `json:"has_beta_access"`
	BetaExpiresAt          *time.Time `json:"beta_expires_at,omitempty"`
	SubscriptionStatus     string     `json:"subscription_status,omitempty"`
	TrialEndsAt            *time.Time `json:"trial_ends_at,omitempty"`
	CurrentPeriodEnd       *time.Time `json:"current_period_end,omitempty"`
}
