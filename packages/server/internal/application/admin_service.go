package application

import (
	"context"
	"strings"

	"budgero-server/internal/adapter/driven/lemonsqueezy"
	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/config"
	"budgero-server/internal/port/driven/repository"
	"budgero-server/internal/port/driving"
)

// AdminService implements driving.AdminService.
type AdminService struct {
	adminRepo    repository.AdminRepository
	activityRepo repository.ActivityRepository
	spaceRepo    repository.SpaceRepository
	queries      *sqlc.Queries
	cfg          *config.Config
	lsClient     *lemonsqueezy.Client
}

// NewAdminService creates a new AdminService.
func NewAdminService(adminRepo repository.AdminRepository, extras ...interface{}) *AdminService {
	svc := &AdminService{adminRepo: adminRepo}
	for _, extra := range extras {
		switch value := extra.(type) {
		case repository.ActivityRepository:
			svc.activityRepo = value
		case repository.SpaceRepository:
			svc.spaceRepo = value
		case *sqlc.Queries:
			svc.queries = value
		case *config.Config:
			svc.cfg = value
		}
	}
	if svc.cfg != nil && svc.cfg.LemonSqueezy.APIKey != "" {
		svc.lsClient = lemonsqueezy.NewClientWithConfig(svc.cfg)
	}
	return svc
}

var _ driving.AdminService = (*AdminService)(nil)

// GetStats returns administrative statistics for the platform.
func (s *AdminService) GetStats(ctx context.Context) (*repository.AdminStats, error) {
	return s.adminRepo.GetStats(ctx)
}

// GetSelfHostStats returns statistics for self-hosted deployments.
func (s *AdminService) GetSelfHostStats(ctx context.Context) (*repository.SelfHostStats, error) {
	return s.adminRepo.GetSelfHostStats(ctx)
}

// ListUsers returns all users with administrative details.
func (s *AdminService) ListUsers(ctx context.Context) ([]repository.AdminUser, error) {
	users, err := s.adminRepo.ListUsers(ctx)
	if err != nil {
		return nil, err
	}
	for i := range users {
		users[i].IsAdmin = users[i].IsAdmin || s.isConfiguredAdmin(users[i].Email)
	}
	return users, nil
}

// ListSelfHostUsers returns all users for self-hosted deployments.
func (s *AdminService) ListSelfHostUsers(ctx context.Context) ([]repository.SelfHostUser, error) {
	return s.adminRepo.ListSelfHostUsers(ctx)
}

// ListRecentUsers returns recently registered users.
func (s *AdminService) ListRecentUsers(ctx context.Context) ([]repository.RecentUser, error) {
	return s.adminRepo.ListRecentUsers(ctx)
}

// RevokeAllAccess revokes all access and entitlements for a user.
func (s *AdminService) RevokeAllAccess(ctx context.Context, userID string) error {
	return s.adminRepo.RevokeAllAccess(ctx, userID)
}

// IsLocalAdmin checks if a user is a local administrator.
func (s *AdminService) IsLocalAdmin(ctx context.Context, userID string) (bool, error) {
	return s.adminRepo.IsLocalAdmin(ctx, userID)
}

// ListUsersWithSubscription returns all users with their subscription details.
func (s *AdminService) ListUsersWithSubscription(ctx context.Context) ([]repository.UserWithSubscription, error) {
	return s.adminRepo.ListUsersWithSubscription(ctx)
}

// MigrateUserID migrates a user from one ID to another.
func (s *AdminService) MigrateUserID(ctx context.Context, oldID, newID, name, email string) error {
	return s.adminRepo.MigrateUserID(ctx, oldID, newID, name, email)
}

// BackfillTrialForInactiveUsers grants trial access to inactive users.
func (s *AdminService) BackfillTrialForInactiveUsers(ctx context.Context, trialDays int) (int64, error) {
	return s.adminRepo.BackfillTrialForInactiveUsers(ctx, trialDays)
}

func (s *AdminService) isConfiguredAdmin(email string) bool {
	if s.cfg == nil {
		return false
	}
	for _, adminEmail := range s.cfg.Auth.AdminEmails {
		if strings.EqualFold(adminEmail, email) {
			return true
		}
	}
	return false
}
