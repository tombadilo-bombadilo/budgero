package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
)

// UserRepository implements repository.UserRepository using SQLite.
type UserRepository struct {
	queries *sqlc.Queries
}

// NewUserRepository creates a new UserRepository.
func NewUserRepository(queries *sqlc.Queries) *UserRepository {
	return &UserRepository{queries: queries}
}

// Compile-time check that UserRepository implements the interface.
var _ repository.UserRepository = (*UserRepository)(nil)

// GetByID retrieves a user by their ID.
func (r *UserRepository) GetByID(ctx context.Context, id string) (*domain.User, error) {
	dbUser, err := r.queries.GetUserByID(ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrUserNotFound
		}
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	return ToUser(&dbUser), nil
}

// GetByEmail retrieves a user by their email address.
func (r *UserRepository) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	dbUser, err := r.queries.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrUserNotFound
		}
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	return ToUser(&dbUser), nil
}

// GetByCustomerID retrieves a user by their payment provider customer ID.
func (r *UserRepository) GetByCustomerID(ctx context.Context, customerID string) (*domain.User, error) {
	dbUser, err := r.queries.GetUserByCustomerID(ctx, sql.NullString{String: customerID, Valid: true})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrUserNotFound
		}
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	return ToUser(&dbUser), nil
}

// Create stores a new user in the database.
func (r *UserRepository) Create(ctx context.Context, user *domain.User) (*domain.User, error) {
	dbUser, err := r.queries.CreateUser(ctx, sqlc.CreateUserParams{
		ID:                 user.ID,
		Name:               user.Name,
		Email:              user.Email,
		SubscriptionStatus: sql.NullString{String: user.SubscriptionStatus, Valid: user.SubscriptionStatus != ""},
		TrialEndsAt:        ToNullTime(user.TrialEndsAt),
		CreatedAt:          sql.NullTime{Time: user.CreatedAt, Valid: !user.CreatedAt.IsZero()},
	})
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return nil, domain.ErrEmailAlreadyExists
		}
		return nil, fmt.Errorf("failed to create user: %w", err)
	}
	return ToUser(&dbUser), nil
}

// Update modifies a user's name and email.
func (r *UserRepository) Update(ctx context.Context, id, name, email string) error {
	err := r.queries.UpdateUser(ctx, sqlc.UpdateUserParams{
		Name:  name,
		Email: email,
		ID:    id,
	})
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return domain.ErrEmailAlreadyExists
		}
		return fmt.Errorf("failed to update user: %w", err)
	}
	return nil
}

// Delete removes a user from the database.
func (r *UserRepository) Delete(ctx context.Context, id string) error {
	return r.queries.DeleteUser(ctx, id)
}

// SetBlocked sets the blocked status for a user.
func (r *UserRepository) SetBlocked(ctx context.Context, id string, blocked bool) error {
	return r.queries.BlockUser(ctx, sqlc.BlockUserParams{
		IsBlocked: blocked,
		ID:        id,
	})
}

// IsBlocked checks if a user is blocked.
func (r *UserRepository) IsBlocked(ctx context.Context, id string) (bool, error) {
	blocked, err := r.queries.IsUserBlocked(ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, domain.ErrUserNotFound
		}
		return false, err
	}
	return blocked, nil
}

// SetMasterPasswordStatus updates whether a user has set their master password.
func (r *UserRepository) SetMasterPasswordStatus(ctx context.Context, id string, isSet bool) error {
	return r.queries.SetMasterPasswordStatus(ctx, sqlc.SetMasterPasswordStatusParams{
		IsMasterPasswordSet: isSet,
		ID:                  id,
	})
}

// SetOnboardingState updates the onboarding state for a user.
func (r *UserRepository) SetOnboardingState(ctx context.Context, id, status string, completedAt, snoozedUntil *time.Time) error {
	params := sqlc.SetOnboardingStateParams{
		OnboardingStatus: status,
		ID:               id,
	}
	if completedAt != nil {
		params.OnboardingCompletedAt = sql.NullTime{Time: *completedAt, Valid: true}
	}
	if snoozedUntil != nil {
		params.OnboardingSnoozedUntil = sql.NullTime{Time: *snoozedUntil, Valid: true}
	}
	return r.queries.SetOnboardingState(ctx, params)
}

// SetReferralSource records how the user discovered Budgero.
func (r *UserRepository) SetReferralSource(ctx context.Context, id, source string) error {
	return r.queries.SetReferralSource(ctx, sqlc.SetReferralSourceParams{
		WhereHeardAbout: source,
		ID:              id,
	})
}

// UpdateBackupSettings updates backup reminder settings for a user.
func (r *UserRepository) UpdateBackupSettings(ctx context.Context, id string, frequencyDays int, lastBackup *time.Time) error {
	var backup sql.NullTime
	if lastBackup != nil {
		backup = sql.NullTime{Time: lastBackup.UTC(), Valid: true}
	}

	return r.queries.UpdateBackupSettings(ctx, sqlc.UpdateBackupSettingsParams{
		BackupReminderFrequencyDays: int64(frequencyDays),
		LastUserDbBackup:            backup,
		ID:                          id,
	})
}

// ResetUserData resets all user data to default values.
func (r *UserRepository) ResetUserData(ctx context.Context, id string) error {
	return r.queries.ResetUserData(ctx, id)
}

// SetAnalyticsDisabled sets the analytics opt-out flag for a user.
func (r *UserRepository) SetAnalyticsDisabled(ctx context.Context, id string, disabled bool) error {
	return r.queries.SetAnalyticsDisabled(ctx, sqlc.SetAnalyticsDisabledParams{
		IsAnalyticsDisabled: disabled,
		ID:                  id,
	})
}

// SetTrialSignalsDisabled sets the trial-signals opt-out flag for a user.
func (r *UserRepository) SetTrialSignalsDisabled(ctx context.Context, id string, disabled bool) error {
	return r.queries.SetTrialSignalsDisabled(ctx, sqlc.SetTrialSignalsDisabledParams{
		IsTrialSignalsDisabled: disabled,
		ID:                     id,
	})
}

// SetPrimarySpace sets the primary space for a user.
func (r *UserRepository) SetPrimarySpace(ctx context.Context, id, spaceID string) error {
	return r.queries.UpdateUserPrimarySpace(ctx, sqlc.UpdateUserPrimarySpaceParams{
		PrimarySpaceID: sql.NullString{String: spaceID, Valid: spaceID != ""},
		ID:             id,
	})
}

// GetPreferences returns persisted user preferences when available.
func (r *UserRepository) GetPreferences(ctx context.Context, id string) (*domain.UserPreferences, error) {
	prefs, err := r.queries.GetUserPreferences(ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get user preferences: %w", err)
	}
	return ToUserPreferences(&prefs), nil
}

// ClearDanglingPrimarySpaceIDs nullifies primary_space_id references to deleted spaces.
func (r *UserRepository) ClearDanglingPrimarySpaceIDs(ctx context.Context) error {
	return r.queries.ClearDanglingPrimarySpaceIDs(ctx)
}

// UpsertPreferences creates or updates user preferences.
func (r *UserRepository) UpsertPreferences(ctx context.Context, prefs *domain.UserPreferences) error {
	if prefs == nil {
		return nil
	}

	return r.queries.UpsertUserPreferences(ctx, sqlc.UpsertUserPreferencesParams{
		UserID:                    prefs.UserID,
		ThemeMode:                 prefs.ThemeMode,
		ThemePreset:               prefs.ThemePreset,
		ClassicFont:               prefs.ClassicFont,
		HomePage:                  prefs.HomePage,
		DesktopBudgetLayout:       prefs.DesktopBudgetLayout,
		CompactMobileLayout:       prefs.CompactMobileLayout,
		MobileBudgetLayout:        prefs.MobileBudgetLayout,
		MasterPasswordStorageMode: prefs.MasterPasswordStorageMode,
		MasterPasswordStorageDays: int64(prefs.MasterPasswordStorageDays),
	})
}
