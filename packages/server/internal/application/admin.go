package application

import (
	"context"

	"budgero-server/internal/config"
	"budgero-server/internal/port/driving"
)

// CheckAdminUsecase orchestrates admin status checks for both cloud and self-host.
type CheckAdminUsecase struct {
	users driving.UserService
	admin driving.AdminService
	cfg   *config.Config
}

// NewCheckAdminUsecase creates a new CheckAdminUsecase.
func NewCheckAdminUsecase(users driving.UserService, admin driving.AdminService, cfg *config.Config) *CheckAdminUsecase {
	return &CheckAdminUsecase{
		users: users,
		admin: admin,
		cfg:   cfg,
	}
}

// Execute checks if a user is an admin (handles both cloud and self-host modes).
func (uc *CheckAdminUsecase) Execute(ctx context.Context, userID string) (bool, error) {
	if uc.cfg != nil && uc.cfg.Auth.SelfHostable {
		return uc.admin.IsLocalAdmin(ctx, userID)
	}

	// Cloud mode - check email
	user, err := uc.users.GetByID(ctx, userID)
	if err != nil {
		return false, err
	}
	return uc.cfg.IsAdmin(user.Email), nil
}
