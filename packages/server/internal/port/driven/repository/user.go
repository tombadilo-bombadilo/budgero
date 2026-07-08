// Package repository defines interfaces for data persistence.
// These are "driven" or "secondary" ports that the application uses
// to interact with external data stores.
package repository

import (
	"context"
	"time"

	"budgero-server/internal/domain"
)

// UserRepository defines methods for user data persistence.
type UserRepository interface {
	// GetByID retrieves a user by ID.
	GetByID(ctx context.Context, id string) (*domain.User, error)

	// GetByEmail retrieves a user by email.
	GetByEmail(ctx context.Context, email string) (*domain.User, error)

	// GetByCustomerID retrieves a user by LemonSqueezy customer ID.
	GetByCustomerID(ctx context.Context, customerID string) (*domain.User, error)

	// Create creates a new user.
	Create(ctx context.Context, user *domain.User) (*domain.User, error)

	// Update updates user name and email.
	Update(ctx context.Context, id, name, email string) error

	// Delete removes a user.
	Delete(ctx context.Context, id string) error

	// SetBlocked sets the blocked status for a user.
	SetBlocked(ctx context.Context, id string, blocked bool) error

	// IsBlocked checks if a user is blocked.
	IsBlocked(ctx context.Context, id string) (bool, error)

	// SetMasterPasswordStatus updates the master password status.
	SetMasterPasswordStatus(ctx context.Context, id string, isSet bool) error

	// SetOnboardingState updates onboarding state.
	SetOnboardingState(ctx context.Context, id, status string, completedAt, snoozedUntil *time.Time) error

	// SetReferralSource records how the user discovered Budgero.
	SetReferralSource(ctx context.Context, id, source string) error

	// UpdateBackupSettings updates backup reminder settings.
	UpdateBackupSettings(ctx context.Context, id string, frequencyDays int, lastBackup *time.Time) error

	// ResetUserData resets user data fields (for account reset).
	ResetUserData(ctx context.Context, id string) error

	// SetAnalyticsDisabled sets the analytics opt-out flag for a user.
	SetAnalyticsDisabled(ctx context.Context, id string, disabled bool) error

	// SetTrialSignalsDisabled sets the trial-signals opt-out flag for a user.
	SetTrialSignalsDisabled(ctx context.Context, id string, disabled bool) error

	// SetPrimarySpace sets the primary space for a user.
	SetPrimarySpace(ctx context.Context, id, spaceID string) error

	// GetPreferences returns persisted user preferences if they exist.
	GetPreferences(ctx context.Context, id string) (*domain.UserPreferences, error)

	// UpsertPreferences creates or updates user preferences.
	UpsertPreferences(ctx context.Context, prefs *domain.UserPreferences) error

	// ClearDanglingPrimarySpaceIDs nullifies primary_space_id references to deleted spaces.
	ClearDanglingPrimarySpaceIDs(ctx context.Context) error
}
