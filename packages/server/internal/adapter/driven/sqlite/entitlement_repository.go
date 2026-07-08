package sqlite

import (
	"context"
	"database/sql"
	"time"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
)

// EntitlementRepository implements repository.EntitlementRepository using SQLite.
type EntitlementRepository struct {
	queries *sqlc.Queries
}

// NewEntitlementRepository creates a new EntitlementRepository.
func NewEntitlementRepository(queries *sqlc.Queries) *EntitlementRepository {
	return &EntitlementRepository{queries: queries}
}

var _ repository.EntitlementRepository = (*EntitlementRepository)(nil)

// MarkUserSubscribedIfFirstTime sets users.subscribed_at = at only when the
// column is currently NULL.
func (r *EntitlementRepository) MarkUserSubscribedIfFirstTime(ctx context.Context, userID string, at time.Time) error {
	return r.queries.MarkUserSubscribedIfFirstTime(ctx, sqlc.MarkUserSubscribedIfFirstTimeParams{
		SubscribedAt: sql.NullTime{Time: at, Valid: true},
		ID:           userID,
	})
}

// UpdateSubscription updates subscription details for a user.
func (r *EntitlementRepository) UpdateSubscription(ctx context.Context, userID string, update domain.SubscriptionUpdate) error {
	return r.queries.UpdateSubscription(ctx, sqlc.UpdateSubscriptionParams{
		SubscriptionStatus: sql.NullString{String: update.Status, Valid: update.Status != ""},
		SubscriptionID:     ToNullString(update.SubscriptionID),
		CustomerID:         ToNullString(update.CustomerID),
		VariantID:          ToNullString(update.VariantID),
		SubscriptionEndsAt: ToNullTime(update.SubscriptionEnds),
		CurrentPeriodEnd:   ToNullTime(update.CurrentPeriodEnd),
		TrialEndsAt:        ToNullTime(update.TrialEnds),
		ID:                 userID,
	})
}

// UpdateSubscriptionStatus updates the subscription status and dates for a user.
func (r *EntitlementRepository) UpdateSubscriptionStatus(ctx context.Context, userID, status string, endsAt, currentPeriodEnd *time.Time) error {
	return r.queries.UpdateSubscriptionStatus(ctx, sqlc.UpdateSubscriptionStatusParams{
		SubscriptionStatus: sql.NullString{String: status, Valid: status != ""},
		SubscriptionEndsAt: ToNullTime(endsAt),
		CurrentPeriodEnd:   ToNullTime(currentPeriodEnd),
		ID:                 userID,
	})
}

// UpdateSubscriptionFromProvider updates subscription info from the payment provider.
func (r *EntitlementRepository) UpdateSubscriptionFromProvider(ctx context.Context, userID string, info domain.SubscriptionInfo) error {
	return r.queries.UpdateUserSubscriptionFull(ctx, sqlc.UpdateUserSubscriptionFullParams{
		SubscriptionStatus: sql.NullString{String: info.Status, Valid: info.Status != ""},
		SubscriptionID:     sql.NullString{String: info.SubscriptionID, Valid: info.SubscriptionID != ""},
		VariantID:          sql.NullString{String: info.VariantID, Valid: info.VariantID != ""},
		SubscriptionEndsAt: ToNullTime(info.EndsAt),
		TrialEndsAt:        ToNullTime(info.TrialEndsAt),
		CurrentPeriodEnd:   ToNullTime(info.CurrentPeriodEnd),
		ID:                 userID,
	})
}

// UpdateSubscriptionAfterResume updates subscription details after resuming a subscription.
func (r *EntitlementRepository) UpdateSubscriptionAfterResume(ctx context.Context, userID, status string, currentPeriodEnd *time.Time, variantID *string, trialEnds *time.Time) error {
	return r.queries.UpdateSubscriptionAfterResume(ctx, sqlc.UpdateSubscriptionAfterResumeParams{
		SubscriptionStatus: sql.NullString{String: status, Valid: status != ""},
		CurrentPeriodEnd:   ToNullTime(currentPeriodEnd),
		VariantID:          ToNullString(variantID),
		TrialEndsAt:        ToNullTime(trialEnds),
		ID:                 userID,
	})
}

// GrantFoundingMember grants founding member status to a user.
func (r *EntitlementRepository) GrantFoundingMember(ctx context.Context, userID string) error {
	return r.queries.GrantFoundingMemberAccess(ctx, userID)
}

// GrantBetaAccess grants beta access to a user until the specified expiration time.
func (r *EntitlementRepository) GrantBetaAccess(ctx context.Context, userID string, expiresAt time.Time) error {
	return r.queries.GrantBetaAccess(ctx, sqlc.GrantBetaAccessParams{
		BetaExpiresAt: sql.NullTime{Time: expiresAt, Valid: true},
		ID:            userID,
	})
}

// RevokeBetaAccess removes beta access from a user.
func (r *EntitlementRepository) RevokeBetaAccess(ctx context.Context, userID string) error {
	return r.queries.RevokeBetaAccess(ctx, userID)
}

// SetCollaborationAccess enables or disables collaboration access for a user.
func (r *EntitlementRepository) SetCollaborationAccess(ctx context.Context, userID string, hasAccess bool) error {
	return r.queries.SetCollaborationAccess(ctx, sqlc.SetCollaborationAccessParams{
		HasCollaborationAccess: hasAccess,
		ID:                     userID,
	})
}

// RevokeAllAccess removes all entitlement access from a user.
func (r *EntitlementRepository) RevokeAllAccess(ctx context.Context, userID string) error {
	return r.queries.RevokeAllUserAccess(ctx, userID)
}
