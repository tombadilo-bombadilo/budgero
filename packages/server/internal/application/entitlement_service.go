package application

import (
	"context"
	"time"

	"budgero-server/internal/config"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
	"budgero-server/internal/port/driving"

	"github.com/rs/zerolog/log"
)

// EntitlementService implements driving.EntitlementService.
type EntitlementService struct {
	entitlementRepo repository.EntitlementRepository
	userRepo        repository.UserRepository
	cfg             *config.Config
}

// NewEntitlementService creates a new EntitlementService.
func NewEntitlementService(
	entitlementRepo repository.EntitlementRepository,
	userRepo repository.UserRepository,
	cfg *config.Config,
) *EntitlementService {
	return &EntitlementService{
		entitlementRepo: entitlementRepo,
		userRepo:        userRepo,
		cfg:             cfg,
	}
}

var _ driving.EntitlementService = (*EntitlementService)(nil)

// HasWorkspaceAccess checks if a user has access to workspace features.
func (s *EntitlementService) HasWorkspaceAccess(user *domain.User) bool {
	if user == nil {
		return false
	}

	// Self-host mode: always grant access
	if s.cfg != nil && s.cfg.Auth.SelfHostable {
		return true
	}

	return user.HasOwnerWorkspaceSubscription()
}

// HasWorkspaceAccessByID checks if a user has workspace access by user ID.
func (s *EntitlementService) HasWorkspaceAccessByID(ctx context.Context, userID string) bool {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return false
	}
	return s.HasWorkspaceAccess(user)
}

// CheckAndRevokeExpiredBeta revokes beta access if it has expired.
func (s *EntitlementService) CheckAndRevokeExpiredBeta(ctx context.Context, user *domain.User) {
	if user == nil {
		return
	}

	if user.IsBetaExpired() {
		if err := s.entitlementRepo.RevokeBetaAccess(ctx, user.ID); err != nil {
			log.Warn().Err(err).Str("user_id", user.ID).Msg("failed to revoke expired beta access")
		}
	}
}

// UpdateSubscription updates subscription details for a user.
func (s *EntitlementService) UpdateSubscription(ctx context.Context, userID string, update domain.SubscriptionUpdate) error {
	return s.entitlementRepo.UpdateSubscription(ctx, userID, update)
}

// MarkSubscribedIfFirstTime stamps users.subscribed_at = at when currently
// NULL. Renewals are no-ops at the repo layer.
func (s *EntitlementService) MarkSubscribedIfFirstTime(ctx context.Context, userID string, at time.Time) error {
	return s.entitlementRepo.MarkUserSubscribedIfFirstTime(ctx, userID, at)
}

// UpdateStatus updates the subscription status and related timestamps.
func (s *EntitlementService) UpdateStatus(ctx context.Context, userID, status string, endsAt, currentPeriodEnd *time.Time) error {
	return s.entitlementRepo.UpdateSubscriptionStatus(ctx, userID, status, endsAt, currentPeriodEnd)
}

// UpdateFromProvider updates subscription data from the payment provider.
func (s *EntitlementService) UpdateFromProvider(ctx context.Context, userID string, info domain.SubscriptionInfo) error {
	return s.entitlementRepo.UpdateSubscriptionFromProvider(ctx, userID, info)
}

// ResumeSubscription resumes a previously cancelled subscription.
func (s *EntitlementService) ResumeSubscription(ctx context.Context, userID, status string, currentPeriodEnd *time.Time, variantID *string, trialEnds *time.Time) error {
	return s.entitlementRepo.UpdateSubscriptionAfterResume(ctx, userID, status, currentPeriodEnd, variantID, trialEnds)
}

// GrantFoundingMember grants founding member status to a user.
func (s *EntitlementService) GrantFoundingMember(ctx context.Context, userID string) error {
	return s.entitlementRepo.GrantFoundingMember(ctx, userID)
}

// GrantBetaAccess grants beta access to a user until the specified expiration.
func (s *EntitlementService) GrantBetaAccess(ctx context.Context, userID string, expiresAt time.Time) error {
	return s.entitlementRepo.GrantBetaAccess(ctx, userID, expiresAt)
}

// RevokeBetaAccess revokes beta access from a user.
func (s *EntitlementService) RevokeBetaAccess(ctx context.Context, userID string) error {
	return s.entitlementRepo.RevokeBetaAccess(ctx, userID)
}

// SetCollaborationAccess sets whether a user has access to collaboration features.
func (s *EntitlementService) SetCollaborationAccess(ctx context.Context, userID string, hasAccess bool) error {
	return s.entitlementRepo.SetCollaborationAccess(ctx, userID, hasAccess)
}
