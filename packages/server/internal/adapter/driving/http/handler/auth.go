package handler

import (
	"context"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/domain"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"
)

// RegisterRequest contains fields for user registration.
type RegisterRequest struct {
	Name     string `json:"name" validate:"required"`
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required,min=8"`
}

// LoginRequest contains fields for user login.
type LoginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required"`
}

// SelfHostAuthRequest contains fields for self-host authentication.
type SelfHostAuthRequest struct {
	Username string `json:"username" validate:"required"`
	Password string `json:"password" validate:"required"`
}

// SelfHostRegisterRequest contains fields for self-host registration.
type SelfHostRegisterRequest struct {
	Name     string `json:"name" validate:"required"`
	Username string `json:"username" validate:"required"`
	Password string `json:"password" validate:"required"`
}

// SelfHostPasswordChangeRequest contains fields for password change.
type SelfHostPasswordChangeRequest struct {
	CurrentPassword string `json:"current_password" validate:"required"`
	NewPassword     string `json:"new_password" validate:"required"`
}

// UpdateProfileRequest contains fields for profile updates.
type UpdateProfileRequest struct {
	Name  string `json:"name" validate:"required"`
	Email string `json:"email" validate:"required,email"`
}

// UpdateOnboardingRequest contains fields for onboarding status update.
type UpdateOnboardingRequest struct {
	Status          string     `json:"status"`
	SnoozedUntil    *time.Time `json:"snoozed_until"`
	WhereHeardAbout string     `json:"where_heard_about"`
}

// UpdateBackupSettingsRequest contains fields for backup settings update.
type UpdateBackupSettingsRequest struct {
	FrequencyDays *int `json:"frequency_days"`
}

// RecordBackupRequest contains fields for recording a backup.
type RecordBackupRequest struct {
	FrequencyDays *int `json:"frequency_days,omitempty"`
}

// SetMasterPasswordRequest contains fields for setting master password status.
type SetMasterPasswordRequest struct {
	IsSet bool `json:"is_set"`
}

// SetAnalyticsDisabledRequest contains fields for toggling analytics opt-out.
type SetAnalyticsDisabledRequest struct {
	Disabled bool `json:"disabled"`
}

// SetTrialSignalsDisabledRequest contains fields for toggling trial-signal opt-out.
type SetTrialSignalsDisabledRequest struct {
	Disabled bool `json:"disabled"`
}

// UpdateUserPreferencesRequest contains fields for updating persisted user preferences.
type UpdateUserPreferencesRequest struct {
	ThemeMode                 *string `json:"theme_mode,omitempty"`
	ThemePreset               *string `json:"theme_preset,omitempty"`
	ClassicFont               *string `json:"classic_font,omitempty"`
	HomePage                  *string `json:"home_page,omitempty"`
	DesktopBudgetLayout       *string `json:"desktop_budget_layout,omitempty"`
	CompactMobileLayout       *bool   `json:"compact_mobile_layout,omitempty"`
	MobileBudgetLayout        *string `json:"mobile_budget_layout,omitempty"`
	MasterPasswordStorageMode *string `json:"master_password_storage_mode,omitempty"`
	MasterPasswordStorageDays *int    `json:"master_password_storage_days,omitempty"`
}

// GetProfile handles getting current user profile
func (h *Handlers) GetProfile(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()

	var localUser *domain.User
	var err error

	// Self-hosted: user already exists (created during registration/login), just fetch
	// SaaS/Clerk: sync or create user from Clerk provider
	if h.selfHostMode {
		localUser, err = h.services.User.GetByID(ctx, userID)
		if err != nil {
			log.Error().Err(err).Str("user_id", userID).Msg("failed to get user")
			return echo.NewHTTPError(http.StatusNotFound, "user not found")
		}
	} else {
		// Fast path: existing SaaS users are already in local DB.
		// Avoid provider round-trips on every profile fetch.
		localUser, err = h.services.User.GetByID(ctx, userID)
		if err != nil {
			if errors.Is(err, domain.ErrUserNotFound) {
				// Bootstrap local user quickly; background sync will reconcile Clerk profile later.
				localUser, err = h.services.User.Create(ctx, userID, "User", userID+"@clerk.user")
				if err != nil {
					if existing, getErr := h.services.User.GetByID(ctx, userID); getErr == nil {
						localUser = existing
					} else {
						log.Error().Err(err).Str("user_id", userID).Msg("failed to bootstrap local user")
						return echo.NewHTTPError(http.StatusInternalServerError, "failed to create user")
					}
				}
			} else {
				log.Error().Err(err).Str("user_id", userID).Msg("failed to get local user")
				return echo.NewHTTPError(http.StatusInternalServerError, "failed to load user")
			}
		}
	}

	isAdmin := h.checkIsAdmin(ctx, localUser)
	if strings.TrimSpace(localUser.OnboardingStatus) == "" {
		localUser.OnboardingStatus = "pending"
	}

	return c.JSON(http.StatusOK, h.buildServiceUserResponse(ctx, localUser, isAdmin))
}

// RecordActivityHeartbeat marks the current SaaS user active for the current UTC day.
func (h *Handlers) RecordActivityHeartbeat(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	if err := h.services.Activity.RecordHeartbeat(c.Request().Context(), userID); err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("failed to record activity heartbeat")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to record activity heartbeat")
	}

	return c.NoContent(http.StatusNoContent)
}

// UpdateProfile handles updating user profile
func (h *Handlers) UpdateProfile(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	var req UpdateProfileRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	if req.Name == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "name is required")
	}
	if req.Email == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "email is required")
	}
	if _, err := mail.ParseAddress(req.Email); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid email format")
	}

	current, err := h.services.User.GetByID(ctx, userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to load user")
	}

	// Update name in Clerk (non-critical: profile sync can fail silently)
	_ = h.usecases.ClerkSync.UpdateClerkProfile(ctx, userID, req.Name)

	if strings.TrimSpace(req.Email) != current.Email {
		return echo.NewHTTPError(http.StatusBadRequest, "Email changes must be done via the Clerk profile")
	}

	if err := h.services.User.Update(ctx, userID, req.Name, current.Email); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update user")
	}

	updated, _ := h.services.User.GetByID(ctx, userID)
	return c.JSON(http.StatusOK, updated)
}

// UpdateOnboardingState allows a user to update onboarding preferences/state.
func (h *Handlers) UpdateOnboardingState(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	var req UpdateOnboardingRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	status := strings.TrimSpace(strings.ToLower(req.Status))
	if status == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "status is required")
	}

	switch status {
	case "pending", "snoozed", "dismissed", "completed":
	default:
		return echo.NewHTTPError(http.StatusBadRequest, "invalid onboarding status")
	}

	var completedAt *time.Time
	var snoozedUntil *time.Time
	now := time.Now().UTC()

	if status == "completed" {
		completedAt = &now
		// Persist the optional "How did you hear about us?" answer when the
		// user finishes onboarding. Empty means they skipped the step, so we
		// leave the column at its default rather than overwriting with blanks.
		if source := strings.TrimSpace(req.WhereHeardAbout); source != "" {
			if err := h.services.User.SetReferralSource(ctx, userID, source); err != nil {
				// Non-fatal — analytics-only field shouldn't block completion.
				log.Error().Err(err).Str("user_id", userID).Msg("failed to record referral source")
			}
		}
	}
	if status == "snoozed" {
		if req.SnoozedUntil == nil {
			return echo.NewHTTPError(http.StatusBadRequest, "snoozed_until is required when status is snoozed")
		}
		t := req.SnoozedUntil.UTC()
		if t.Before(now) {
			return echo.NewHTTPError(http.StatusBadRequest, "snoozed_until must be in the future")
		}
		snoozedUntil = &t
	}

	if err := h.services.User.SetOnboardingState(ctx, userID, status, completedAt, snoozedUntil); err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("failed to update onboarding state")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update onboarding state")
	}

	return c.NoContent(http.StatusNoContent)
}

// UpdateBackupSettings updates the reminder frequency for backup prompts.
func (h *Handlers) UpdateBackupSettings(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	var req UpdateBackupSettingsRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	if req.FrequencyDays == nil {
		return echo.NewHTTPError(http.StatusBadRequest, "frequency_days is required")
	}

	updated, err := h.services.User.UpdateBackupSettings(ctx, userID, req.FrequencyDays, nil)
	if err != nil {
		if strings.Contains(err.Error(), "frequency") {
			return echo.NewHTTPError(http.StatusBadRequest, err.Error())
		}
		if errors.Is(err, domain.ErrUserNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "user not found")
		}
		log.Error().Err(err).Str("user_id", userID).Msg("failed to update backup settings")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update backup settings")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"last_user_db_backup":            updated.LastUserDBBackup,
		"backup_reminder_frequency_days": updated.BackupReminderFrequencyDays,
	})
}

// RecordDatabaseBackup marks that the user has taken a database backup now.
func (h *Handlers) RecordDatabaseBackup(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	var req RecordBackupRequest
	// Bind error ignored: zero values are valid defaults for optional fields
	_ = c.Bind(&req)

	now := time.Now().UTC()
	updated, err := h.services.User.UpdateBackupSettings(ctx, userID, req.FrequencyDays, &now)
	if err != nil {
		if strings.Contains(err.Error(), "frequency") {
			return echo.NewHTTPError(http.StatusBadRequest, err.Error())
		}
		if errors.Is(err, domain.ErrUserNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "user not found")
		}
		log.Error().Err(err).Str("user_id", userID).Msg("failed to record backup")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to record backup")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"last_user_db_backup":            updated.LastUserDBBackup,
		"backup_reminder_frequency_days": updated.BackupReminderFrequencyDays,
	})
}

// SetMasterPasswordStatus handles updating the master password status
func (h *Handlers) SetMasterPasswordStatus(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	var req SetMasterPasswordRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	if err := h.services.User.SetMasterPasswordStatus(ctx, userID, req.IsSet); err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "user not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update master password status")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success":                true,
		"is_master_password_set": req.IsSet,
	})
}

// ResetMasterPassword clears master password state and associated data for the user.
func (h *Handlers) ResetMasterPassword(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	spaceIDs, err := h.services.User.ResetData(ctx, userID)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "user not found")
		}
		log.Error().Err(err).Str("user_id", userID).Msg("failed to reset user data")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to reset user data")
	}

	if h.syncHub != nil {
		for _, spaceID := range spaceIDs {
			if err := h.syncHub.ResetSpace(spaceID); err != nil {
				log.Error().Err(err).Str("user_id", userID).Str("space_id", spaceID).Msg("failed to reset sync state")
				return echo.NewHTTPError(http.StatusInternalServerError, "failed to reset sync state")
			}
		}
	}

	// Best-effort cleanup of push data
	_ = h.services.Push.DeleteUserPushData(ctx, userID)

	return c.JSON(http.StatusOK, map[string]interface{}{"success": true})
}

// SetAnalyticsDisabled handles toggling the analytics opt-out flag.
func (h *Handlers) SetAnalyticsDisabled(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	var req SetAnalyticsDisabledRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	if err := h.services.User.SetAnalyticsDisabled(ctx, userID, req.Disabled); err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "user not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update analytics preference")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success":               true,
		"is_analytics_disabled": req.Disabled,
	})
}

// SetTrialSignalsDisabled handles toggling the trial-signals opt-out flag.
// Trial signals are decoupled from analytics: they stay on by default and
// only this explicit opt-out stops RecordSignal from accruing progress.
func (h *Handlers) SetTrialSignalsDisabled(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	var req SetTrialSignalsDisabledRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	if err := h.services.User.SetTrialSignalsDisabled(ctx, userID, req.Disabled); err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "user not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update trial-signals preference")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success":                   true,
		"is_trial_signals_disabled": req.Disabled,
	})
}

// GetUserPreferences returns persisted per-user appearance/navigation preferences.
func (h *Handlers) GetUserPreferences(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	prefs, err := h.services.User.GetPreferences(c.Request().Context(), userID)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "user not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to load user preferences")
	}

	return c.JSON(http.StatusOK, prefs)
}

// UpdateUserPreferences updates persisted per-user appearance/navigation preferences.
func (h *Handlers) UpdateUserPreferences(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	var req UpdateUserPreferencesRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	prefs, err := h.services.User.UpdatePreferences(c.Request().Context(), userID, domain.UserPreferencesPatch{
		ThemeMode:                 req.ThemeMode,
		ThemePreset:               req.ThemePreset,
		ClassicFont:               req.ClassicFont,
		HomePage:                  req.HomePage,
		DesktopBudgetLayout:       req.DesktopBudgetLayout,
		CompactMobileLayout:       req.CompactMobileLayout,
		MobileBudgetLayout:        req.MobileBudgetLayout,
		MasterPasswordStorageMode: req.MasterPasswordStorageMode,
		MasterPasswordStorageDays: req.MasterPasswordStorageDays,
	})
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "user not found")
		}
		if errors.Is(err, domain.ErrInvalidUserPreferences) {
			return echo.NewHTTPError(http.StatusBadRequest, err.Error())
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update user preferences")
	}

	return c.JSON(http.StatusOK, prefs)
}

// SelfHostRegister handles user registration in self-host mode.
func (h *Handlers) SelfHostRegister(c echo.Context) error {
	if err := h.ensureSelfHostMode(); err != nil {
		return err
	}
	if h.cfg != nil && h.cfg.Features.DisableRegistration {
		return echo.NewHTTPError(http.StatusForbidden, "registration is disabled on this instance")
	}
	ctx := c.Request().Context()
	var req SelfHostRegisterRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	req.Username = strings.TrimSpace(strings.ToLower(req.Username))
	if req.Username == "" || len(req.Password) < 8 {
		return echo.NewHTTPError(http.StatusBadRequest, "username and password are required")
	}
	if _, err := h.usecases.CreateLocalUser.Execute(ctx, req.Name, req.Username, req.Password, false); err != nil {
		// Generic message so a duplicate username isn't enumerable; log the detail.
		log.Warn().Err(err).Msg("self-host registration failed")
		return echo.NewHTTPError(http.StatusBadRequest, "registration failed")
	}

	user, isAdmin, err := h.usecases.AuthenticateLocal.Execute(ctx, req.Username, req.Password)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to finalize registration")
	}

	token, err := middleware.GenerateSelfHostToken(user.ID, isAdmin)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to issue token")
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"token": token,
		"user":  h.buildServiceUserResponse(ctx, user, isAdmin),
	})
}

// SelfHostLogin handles user login in self-host mode.
func (h *Handlers) SelfHostLogin(c echo.Context) error {
	if err := h.ensureSelfHostMode(); err != nil {
		return err
	}
	ctx := c.Request().Context()
	var req SelfHostAuthRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	user, isAdmin, err := h.usecases.AuthenticateLocal.Execute(ctx, req.Username, req.Password)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "invalid credentials")
	}
	token, err := middleware.GenerateSelfHostToken(user.ID, isAdmin)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to issue token")
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"token": token,
		"user":  h.buildServiceUserResponse(ctx, user, isAdmin),
	})
}

// SelfHostUpdatePassword handles password updates in self-host mode.
func (h *Handlers) SelfHostUpdatePassword(c echo.Context) error {
	if err := h.ensureSelfHostMode(); err != nil {
		return err
	}
	ctx := c.Request().Context()
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	var req SelfHostPasswordChangeRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if len(req.NewPassword) < 8 {
		return echo.NewHTTPError(http.StatusBadRequest, "new password must be at least 8 characters")
	}
	user, err := h.services.User.GetByID(ctx, userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "user not found")
	}
	if _, _, err := h.usecases.AuthenticateLocal.Execute(ctx, user.Email, req.CurrentPassword); err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "current password is incorrect")
	}
	isAdmin := h.services.Credential.IsAdmin(ctx, userID)
	if err := h.services.Credential.SetPassword(ctx, userID, req.NewPassword, isAdmin); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update password")
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "password updated"})
}

// GetAppConfig returns app configuration including early access mode
func (h *Handlers) GetAppConfig(c echo.Context) error {
	earlyAccessMode := h.cfg.Features.EarlyAccessMode
	earlyAccessMessage := h.cfg.Features.EarlyAccessMessage
	if earlyAccessMessage == "" {
		earlyAccessMessage = "We're currently in invite-only early access. Subscribe to our mailing list to get 15% off when we launch!"
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"early_access_mode":    earlyAccessMode,
		"early_access_message": earlyAccessMessage,
	})
}

func (h *Handlers) checkIsAdmin(ctx context.Context, user *domain.User) bool {
	if h.selfHostMode {
		return h.services.Credential.IsAdmin(ctx, user.ID)
	}

	isAdmin, err := h.usecases.CheckAdmin.Execute(ctx, user.ID)
	if err != nil {
		return false
	}
	return isAdmin
}

func (h *Handlers) buildServiceUserResponse(ctx context.Context, user *domain.User, isAdmin bool) map[string]interface{} {
	if user == nil {
		return map[string]interface{}{}
	}

	spaces, err := h.services.Space.ListForUser(ctx, user.ID)
	if err != nil {
		spaces = nil
	}

	canAccessOwnedWorkspaces := h.selfHostMode || user.HasOwnerWorkspaceSubscription()
	effectiveSubscriptionStatus := user.EffectiveSubscriptionStatus()
	hasAccessibleWorkspace := false
	hasAccessibleSharedWorkspace := false
	hasLockedSharedWorkspace := false
	for i := range spaces {
		space := spaces[i]
		if !strings.EqualFold(space.InvitationStatus, domain.InvitationAccepted) {
			continue
		}
		if space.IsAccessible {
			hasAccessibleWorkspace = true
			if strings.EqualFold(space.Role, domain.RoleMember) {
				hasAccessibleSharedWorkspace = true
			}
			continue
		}
		if strings.EqualFold(space.Role, domain.RoleMember) &&
			space.AccessReason == domain.SpaceAccessReasonSharedOwnerInactive {
			hasLockedSharedWorkspace = true
		}
	}

	accessLevel := domain.AccessLevelNone
	switch {
	case h.selfHostMode:
		accessLevel = domain.AccessLevelSubscriber
	case user.IsFoundingMember:
		accessLevel = domain.AccessLevelFoundingMember
	case user.HasActiveBeta():
		accessLevel = domain.AccessLevelBeta
	case user.HasActiveTrial():
		accessLevel = domain.AccessLevelTrial
	case user.HasOwnerWorkspaceSubscription():
		accessLevel = domain.AccessLevelSubscriber
	case hasAccessibleSharedWorkspace:
		accessLevel = domain.AccessLevelCollaborator
	}

	payload := map[string]interface{}{
		"id":                             user.ID,
		"email":                          user.Email,
		"name":                           user.Name,
		"created_at":                     user.CreatedAt,
		"is_blocked":                     user.IsBlocked,
		"has_beta_access":                user.HasBetaAccess,
		"has_collaboration_access":       user.HasCollaborationAccess,
		"beta_expires_at":                user.BetaExpiresAt,
		"is_founding_member":             user.IsFoundingMember,
		"is_admin":                       isAdmin,
		"is_master_password_set":         user.IsMasterPasswordSet,
		"subscription_status":            effectiveSubscriptionStatus,
		"trial_ends_at":                  user.TrialEndsAt,
		"subscription_ends_at":           user.SubscriptionEndsAt,
		"current_period_end":             user.CurrentPeriodEnd,
		"onboarding_status":              user.OnboardingStatus,
		"onboarding_completed_at":        user.OnboardingCompletedAt,
		"onboarding_snoozed_until":       user.OnboardingSnoozedUntil,
		"where_heard_about":              user.WhereHeardAbout,
		"primary_space_id":               user.PrimarySpaceID,
		"access_level":                   accessLevel,
		"can_access_owned_workspaces":    canAccessOwnedWorkspaces,
		"can_access_shared_workspaces":   canAccessOwnedWorkspaces || hasAccessibleSharedWorkspace,
		"can_create_workspace":           canAccessOwnedWorkspaces,
		"has_accessible_workspace":       hasAccessibleWorkspace,
		"has_locked_shared_workspace":    hasLockedSharedWorkspace,
		"last_user_db_backup":            user.LastUserDBBackup,
		"backup_reminder_frequency_days": user.BackupReminderFrequencyDays,
		"is_analytics_disabled":          user.IsAnalyticsDisabled,
		"is_trial_signals_disabled":      user.IsTrialSignalsDisabled,
	}
	if user.SubscriptionID != nil {
		payload["subscription_id"] = *user.SubscriptionID
	}
	if user.CustomerID != nil {
		payload["customer_id"] = *user.CustomerID
	}
	if user.VariantID != nil {
		payload["variant_id"] = *user.VariantID
	}
	if prefs, err := h.services.User.GetPreferences(ctx, user.ID); err == nil {
		payload["preferences"] = prefs
	} else {
		log.Warn().
			Err(err).
			Str("user_id", user.ID).
			Msg("failed to load user preferences for profile response")
	}
	return payload
}
