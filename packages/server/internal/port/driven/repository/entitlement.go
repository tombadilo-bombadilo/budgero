package repository

import (
	"context"
	"time"

	"budgero-server/internal/domain"
)

// EntitlementRepository defines methods for subscription and entitlement persistence.
type EntitlementRepository interface {
	// UpdateSubscription updates subscription details for a user.
	UpdateSubscription(ctx context.Context, userID string, update domain.SubscriptionUpdate) error

	// MarkUserSubscribedIfFirstTime sets users.subscribed_at = at when the
	// column is currently NULL. Idempotent: subsequent calls are no-ops, so
	// renewals don't bump the timestamp.
	MarkUserSubscribedIfFirstTime(ctx context.Context, userID string, at time.Time) error

	// UpdateSubscriptionStatus updates just the subscription status and dates.
	UpdateSubscriptionStatus(ctx context.Context, userID, status string, endsAt, currentPeriodEnd *time.Time) error

	// UpdateSubscriptionFromProvider updates subscription from external provider data.
	UpdateSubscriptionFromProvider(ctx context.Context, userID string, info domain.SubscriptionInfo) error

	// UpdateSubscriptionAfterResume updates subscription after resuming.
	UpdateSubscriptionAfterResume(ctx context.Context, userID, status string, currentPeriodEnd *time.Time, variantID *string, trialEnds *time.Time) error

	// GrantFoundingMember grants founding member status.
	GrantFoundingMember(ctx context.Context, userID string) error

	// GrantBetaAccess grants beta access until a specific date.
	GrantBetaAccess(ctx context.Context, userID string, expiresAt time.Time) error

	// RevokeBetaAccess revokes beta access.
	RevokeBetaAccess(ctx context.Context, userID string) error

	// SetCollaborationAccess sets collaboration access.
	SetCollaborationAccess(ctx context.Context, userID string, hasAccess bool) error

	// RevokeAllAccess revokes all access for a user.
	RevokeAllAccess(ctx context.Context, userID string) error
}
