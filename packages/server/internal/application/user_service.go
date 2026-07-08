// Package application contains application services that implement driving port interfaces.
// These services orchestrate business logic using driven ports (repositories, external services).
package application

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"budgero-server/internal/config"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
	"budgero-server/internal/port/driving"

	"github.com/rs/zerolog/log"
)

// UserService implements driving.UserService.
type UserService struct {
	userRepo  repository.UserRepository
	spaceRepo repository.SpaceRepository
	cfg       *config.Config
}

// NewUserService creates a new UserService.
func NewUserService(
	userRepo repository.UserRepository,
	spaceRepo repository.SpaceRepository,
	cfg *config.Config,
) *UserService {
	return &UserService{
		userRepo:  userRepo,
		spaceRepo: spaceRepo,
		cfg:       cfg,
	}
}

var _ driving.UserService = (*UserService)(nil)

// GetByID retrieves a user by their ID.
func (s *UserService) GetByID(ctx context.Context, id string) (*domain.User, error) {
	return s.userRepo.GetByID(ctx, id)
}

// GetByEmail retrieves a user by their email address.
func (s *UserService) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	return s.userRepo.GetByEmail(ctx, email)
}

// GetByCustomerID retrieves a user by their payment provider customer ID.
func (s *UserService) GetByCustomerID(ctx context.Context, customerID string) (*domain.User, error) {
	return s.userRepo.GetByCustomerID(ctx, customerID)
}

// Create creates a new user with the given details and starts their trial.
func (s *UserService) Create(ctx context.Context, id, name, email string) (*domain.User, error) {
	trialDays := s.getTrialDurationDays()
	trialEndsAt := time.Now().Add(time.Duration(trialDays) * 24 * time.Hour)

	user := &domain.User{
		ID:                 id,
		Name:               name,
		Email:              email,
		SubscriptionStatus: "trialing",
		TrialEndsAt:        &trialEndsAt,
		CreatedAt:          time.Now(),
	}

	return s.userRepo.Create(ctx, user)
}

// Update updates a user's name and email.
func (s *UserService) Update(ctx context.Context, id, name, email string) error {
	return s.userRepo.Update(ctx, id, name, email)
}

// Delete deletes a user by their ID.
func (s *UserService) Delete(ctx context.Context, id string) error {
	return s.userRepo.Delete(ctx, id)
}

// Block sets or clears the blocked status for a user.
func (s *UserService) Block(ctx context.Context, id string, blocked bool) error {
	return s.userRepo.SetBlocked(ctx, id, blocked)
}

// IsBlocked checks if a user is blocked.
func (s *UserService) IsBlocked(ctx context.Context, id string) (bool, error) {
	return s.userRepo.IsBlocked(ctx, id)
}

// SetMasterPasswordStatus sets whether the user has configured a master password.
func (s *UserService) SetMasterPasswordStatus(ctx context.Context, id string, isSet bool) error {
	return s.userRepo.SetMasterPasswordStatus(ctx, id, isSet)
}

// SetOnboardingState updates the user's onboarding progress.
func (s *UserService) SetOnboardingState(ctx context.Context, id, status string, completedAt, snoozedUntil *time.Time) error {
	return s.userRepo.SetOnboardingState(ctx, id, status, completedAt, snoozedUntil)
}

// SetReferralSource records how the user discovered Budgero (onboarding step).
func (s *UserService) SetReferralSource(ctx context.Context, id, source string) error {
	return s.userRepo.SetReferralSource(ctx, id, source)
}

// UpdateBackupSettings updates the user's backup frequency and last backup timestamp.
func (s *UserService) UpdateBackupSettings(ctx context.Context, id string, frequencyDays *int, lastBackup *time.Time) (*domain.User, error) {
	existing, err := s.userRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if frequencyDays == nil && lastBackup == nil {
		return existing, nil
	}

	freq := existing.BackupReminderFrequencyDays
	if frequencyDays != nil {
		f := *frequencyDays
		if f < 0 {
			f = 0
		}
		if f > 365 {
			f = 365
		}
		freq = f
	}

	backup := existing.LastUserDBBackup
	if lastBackup != nil {
		backup = lastBackup
	}

	if err := s.userRepo.UpdateBackupSettings(ctx, id, freq, backup); err != nil {
		return nil, err
	}

	return s.userRepo.GetByID(ctx, id)
}

// ResetData resets all user data and returns the IDs of deleted spaces.
func (s *UserService) ResetData(ctx context.Context, id string) ([]string, error) {
	blobs, err := s.spaceRepo.ListBlobsByOwner(ctx, id)
	if err != nil {
		return nil, err
	}

	spaceIDs := make([]string, 0, len(blobs))
	for _, blob := range blobs {
		spaceIDs = append(spaceIDs, blob.SpaceID)
	}

	if err := s.spaceRepo.DeleteAllMembershipsForUser(ctx, id); err != nil {
		return nil, err
	}

	if err := s.userRepo.ResetUserData(ctx, id); err != nil {
		return nil, err
	}

	// Clean up owned spaces
	for _, blob := range blobs {
		if err := s.spaceRepo.DeleteBlob(ctx, blob.SpaceID); err != nil {
			log.Warn().Err(err).Str("space_id", blob.SpaceID).Msg("failed to delete space blob during reset")
		}
		if err := s.spaceRepo.DeleteAllMembershipsForSpace(ctx, blob.SpaceID); err != nil {
			log.Warn().Err(err).Str("space_id", blob.SpaceID).Msg("failed to delete space memberships during reset")
		}
		if err := s.spaceRepo.Delete(ctx, blob.SpaceID); err != nil {
			log.Warn().Err(err).Str("space_id", blob.SpaceID).Msg("failed to delete space during reset")
		}
		if blob.BlobPath != "" {
			if err := os.Remove(blob.BlobPath); err != nil {
				log.Warn().Err(err).Str("path", blob.BlobPath).Msg("failed to remove blob file during reset")
			}
		}
	}

	return spaceIDs, nil
}

// DeleteWithSpaces deletes a user and their owned spaces, returning deleted space IDs.
func (s *UserService) DeleteWithSpaces(ctx context.Context, id string) ([]string, error) {
	// First verify user exists
	if _, err := s.userRepo.GetByID(ctx, id); err != nil {
		return nil, err
	}

	blobs, err := s.spaceRepo.ListBlobsByOwner(ctx, id)
	if err != nil {
		return nil, err
	}

	spaceIDs := make([]string, 0, len(blobs))
	for _, blob := range blobs {
		spaceIDs = append(spaceIDs, blob.SpaceID)
	}

	if err := s.userRepo.Delete(ctx, id); err != nil {
		return nil, err
	}

	// Remove blob files
	for _, blob := range blobs {
		if blob.BlobPath != "" {
			if err := os.Remove(blob.BlobPath); err != nil {
				log.Warn().Err(err).Str("path", blob.BlobPath).Msg("failed to remove blob file during delete")
			}
		}
	}

	return spaceIDs, nil
}

// SetAnalyticsDisabled sets the analytics opt-out flag for a user.
func (s *UserService) SetAnalyticsDisabled(ctx context.Context, id string, disabled bool) error {
	return s.userRepo.SetAnalyticsDisabled(ctx, id, disabled)
}

// SetTrialSignalsDisabled sets the trial-signals opt-out flag for a user.
func (s *UserService) SetTrialSignalsDisabled(ctx context.Context, id string, disabled bool) error {
	return s.userRepo.SetTrialSignalsDisabled(ctx, id, disabled)
}

// SetPrimarySpace sets the primary space for a user.
func (s *UserService) SetPrimarySpace(ctx context.Context, id, spaceID string) error {
	return s.userRepo.SetPrimarySpace(ctx, id, spaceID)
}

// GetPreferences returns effective user preferences, falling back to defaults.
func (s *UserService) GetPreferences(ctx context.Context, id string) (*domain.UserPreferences, error) {
	if _, err := s.userRepo.GetByID(ctx, id); err != nil {
		return nil, err
	}

	prefs, err := s.userRepo.GetPreferences(ctx, id)
	if err != nil {
		return nil, err
	}
	if prefs == nil {
		return domain.DefaultUserPreferences(id), nil
	}
	if err := validateUserPreferences(prefs); err != nil {
		log.Warn().
			Err(err).
			Str("user_id", id).
			Msg("invalid persisted user preferences; falling back to defaults")
		return domain.DefaultUserPreferences(id), nil
	}
	return prefs, nil
}

// UpdatePreferences applies a partial update to a user's preferences.
func (s *UserService) UpdatePreferences(ctx context.Context, id string, patch domain.UserPreferencesPatch) (*domain.UserPreferences, error) {
	current, err := s.GetPreferences(ctx, id)
	if err != nil {
		return nil, err
	}
	if patch.IsEmpty() {
		return current, nil
	}

	next := *current

	if patch.ThemeMode != nil {
		next.ThemeMode = normalizePreferenceValue(*patch.ThemeMode)
	}
	if patch.ThemePreset != nil {
		next.ThemePreset = normalizePreferenceValue(*patch.ThemePreset)
	}
	if patch.ClassicFont != nil {
		next.ClassicFont = normalizePreferenceValue(*patch.ClassicFont)
	}
	if patch.HomePage != nil {
		next.HomePage = normalizePreferenceValue(*patch.HomePage)
	}
	if patch.DesktopBudgetLayout != nil {
		next.DesktopBudgetLayout = normalizePreferenceValue(*patch.DesktopBudgetLayout)
	}
	if patch.CompactMobileLayout != nil {
		next.CompactMobileLayout = *patch.CompactMobileLayout
	}
	if patch.MobileBudgetLayout != nil {
		next.MobileBudgetLayout = normalizePreferenceValue(*patch.MobileBudgetLayout)
	}
	if patch.MasterPasswordStorageMode != nil {
		next.MasterPasswordStorageMode = normalizePreferenceValue(*patch.MasterPasswordStorageMode)
	}
	if patch.MasterPasswordStorageDays != nil {
		next.MasterPasswordStorageDays = *patch.MasterPasswordStorageDays
	}

	if err := validateUserPreferences(&next); err != nil {
		return nil, err
	}

	next.UserID = id
	if err := s.userRepo.UpsertPreferences(ctx, &next); err != nil {
		return nil, err
	}

	return &next, nil
}

// ClearDanglingPrimarySpaceIDs nullifies primary_space_id references to deleted spaces.
func (s *UserService) ClearDanglingPrimarySpaceIDs(ctx context.Context) error {
	return s.userRepo.ClearDanglingPrimarySpaceIDs(ctx)
}

func normalizePreferenceValue(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func validateUserPreferences(prefs *domain.UserPreferences) error {
	if prefs == nil {
		return fmt.Errorf("%w: missing payload", domain.ErrInvalidUserPreferences)
	}

	if !isOneOf(prefs.ThemeMode, "system", "light", "dark") {
		return fmt.Errorf("%w: theme_mode", domain.ErrInvalidUserPreferences)
	}
	if !isOneOf(prefs.ThemePreset, "default", "phosphor", "mesa", "obsidian", "paper", "stocktaper") {
		return fmt.Errorf("%w: theme_preset", domain.ErrInvalidUserPreferences)
	}
	if !isOneOf(
		prefs.ClassicFont,
		"fira-code",
		"montserrat",
		"exo-2",
		"azeret",
		"inter",
		"roboto",
		"poppins",
		"ibm-plex-mono",
	) {
		return fmt.Errorf("%w: classic_font", domain.ErrInvalidUserPreferences)
	}
	if !isOneOf(prefs.HomePage, "dashboard", "planning", "accounts", "analytics") {
		return fmt.Errorf("%w: home_page", domain.ErrInvalidUserPreferences)
	}
	if !isOneOf(prefs.DesktopBudgetLayout, "cards", "compact", "table") {
		return fmt.Errorf("%w: desktop_budget_layout", domain.ErrInvalidUserPreferences)
	}
	if !isOneOf(prefs.MobileBudgetLayout, "cards", "compact", "table") {
		return fmt.Errorf("%w: mobile_budget_layout", domain.ErrInvalidUserPreferences)
	}
	if !isOneOf(prefs.MasterPasswordStorageMode, "memory", "session") {
		return fmt.Errorf("%w: master_password_storage_mode", domain.ErrInvalidUserPreferences)
	}
	if prefs.MasterPasswordStorageDays < 1 || prefs.MasterPasswordStorageDays > 30 {
		return fmt.Errorf("%w: master_password_storage_days", domain.ErrInvalidUserPreferences)
	}

	return nil
}

func isOneOf(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func (s *UserService) getTrialDurationDays() int {
	if s.cfg != nil && s.cfg.Features.TrialDurationDays > 0 {
		return s.cfg.Features.TrialDurationDays
	}
	return 35
}
