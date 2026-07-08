// Package domain contains core business entities and errors.
// Domain types have no external dependencies (no sql.*, no db.* types).
package domain

import (
	"strings"
	"time"
)

// User represents a user in the system.
type User struct {
	ID                          string     `json:"id"`
	Name                        string     `json:"name"`
	Email                       string     `json:"email"`
	PrimarySpaceID              string     `json:"primary_space_id,omitempty"`
	IsMasterPasswordSet         bool       `json:"is_master_password_set"`
	CurrentDBHash               string     `json:"current_db_hash,omitempty"`
	SyncVersion                 int64      `json:"sync_version"`
	CreatedAt                   time.Time  `json:"created_at"`
	IsBlocked                   bool       `json:"is_blocked"`
	LastUserDBBackup            *time.Time `json:"last_user_db_backup,omitempty"`
	BackupReminderFrequencyDays int        `json:"backup_reminder_frequency_days"`
	SubscriptionStatus          string     `json:"subscription_status,omitempty"`
	SubscriptionID              *string    `json:"subscription_id,omitempty"`
	CustomerID                  *string    `json:"customer_id,omitempty"`
	VariantID                   *string    `json:"variant_id,omitempty"`
	SubscriptionEndsAt          *time.Time `json:"subscription_ends_at,omitempty"`
	TrialEndsAt                 *time.Time `json:"trial_ends_at,omitempty"`
	CurrentPeriodEnd            *time.Time `json:"current_period_end,omitempty"`
	HasBetaAccess               bool       `json:"has_beta_access"`
	BetaExpiresAt               *time.Time `json:"beta_expires_at,omitempty"`
	IsFoundingMember            bool       `json:"is_founding_member"`
	OnboardingStatus            string     `json:"onboarding_status"`
	OnboardingCompletedAt       *time.Time `json:"onboarding_completed_at,omitempty"`
	OnboardingSnoozedUntil      *time.Time `json:"onboarding_snoozed_until,omitempty"`
	WhereHeardAbout             string     `json:"where_heard_about,omitempty"`
	HasCollaborationAccess      bool       `json:"has_collaboration_access"`
	IsAnalyticsDisabled         bool       `json:"is_analytics_disabled"`
	IsTrialSignalsDisabled      bool       `json:"is_trial_signals_disabled"`
}

// UserPreferences stores UI and appearance preferences synced per-user.
type UserPreferences struct {
	UserID                    string `json:"user_id"`
	ThemeMode                 string `json:"theme_mode"`
	ThemePreset               string `json:"theme_preset"`
	ClassicFont               string `json:"classic_font"`
	HomePage                  string `json:"home_page"`
	DesktopBudgetLayout       string `json:"desktop_budget_layout"`
	CompactMobileLayout       bool   `json:"compact_mobile_layout"`
	MobileBudgetLayout        string `json:"mobile_budget_layout"`
	MasterPasswordStorageMode string `json:"master_password_storage_mode"`
	MasterPasswordStorageDays int    `json:"master_password_storage_days"`
}

// UserPreferencesPatch contains partial updates for user preferences.
type UserPreferencesPatch struct {
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

// DefaultUserPreferences returns default UI preferences for a user.
func DefaultUserPreferences(userID string) *UserPreferences {
	return &UserPreferences{
		UserID:                    userID,
		ThemeMode:                 "system",
		ThemePreset:               "paper",
		ClassicFont:               "poppins",
		HomePage:                  "planning",
		DesktopBudgetLayout:       "table",
		CompactMobileLayout:       false,
		MobileBudgetLayout:        "cards",
		MasterPasswordStorageMode: "memory",
		MasterPasswordStorageDays: 7,
	}
}

// IsEmpty returns true when no preference fields were provided.
func (p UserPreferencesPatch) IsEmpty() bool {
	return p.ThemeMode == nil &&
		p.ThemePreset == nil &&
		p.ClassicFont == nil &&
		p.HomePage == nil &&
		p.DesktopBudgetLayout == nil &&
		p.CompactMobileLayout == nil &&
		p.MobileBudgetLayout == nil &&
		p.MasterPasswordStorageMode == nil &&
		p.MasterPasswordStorageDays == nil
}

// HasActiveBeta returns true if the user has beta access that hasn't expired.
func (u *User) HasActiveBeta() bool {
	if u == nil || !u.HasBetaAccess {
		return false
	}
	// No expiration set means permanent beta
	if u.BetaExpiresAt == nil {
		return true
	}
	return u.BetaExpiresAt.After(time.Now())
}

// IsBetaExpired returns true if the user had beta access that has now expired.
func (u *User) IsBetaExpired() bool {
	if u == nil || !u.HasBetaAccess {
		return false
	}
	if u.BetaExpiresAt == nil {
		return false
	}
	return u.BetaExpiresAt.Before(time.Now())
}

// HasActiveTrial returns true if the user has an active trial period.
func (u *User) HasActiveTrial() bool {
	if u == nil || u.TrialEndsAt == nil {
		return false
	}
	return u.TrialEndsAt.After(time.Now())
}

// HasActiveSubscription returns true if the user has a paid subscription.
func (u *User) HasActiveSubscription() bool {
	if u == nil {
		return false
	}
	status := u.SubscriptionStatus
	if status == SubscriptionActive || status == SubscriptionOnTrial || status == SubscriptionPaused {
		return true
	}
	if status == SubscriptionPastDue && u.CurrentPeriodEnd != nil && u.CurrentPeriodEnd.After(time.Now()) {
		return true
	}
	// Cancelled but still in paid period
	if status == SubscriptionCancelled && u.SubscriptionEndsAt != nil && u.SubscriptionEndsAt.After(time.Now()) {
		return true
	}
	return false
}

// HasFullWorkspaceAccess checks if user has active subscription, trial, or special access.
// Note: This doesn't check self-host mode - use EntitlementService.HasWorkspaceAccess for full check.
func (u *User) HasFullWorkspaceAccess() bool {
	if u == nil {
		return false
	}

	// Collaboration-only access (invited to shared space)
	if u.HasCollaborationAccess {
		return true
	}

	// Founding member - lifetime access
	if u.IsFoundingMember {
		return true
	}

	// Beta access
	if u.HasActiveBeta() {
		return true
	}

	// Active subscription
	if u.HasActiveSubscription() {
		return true
	}

	// Active trial
	if u.HasActiveTrial() {
		return true
	}

	return false
}

// HasOwnerWorkspaceSubscription returns true if the user can access workspaces they own.
// Policy: owner workspace access requires an active subscription or active trial.
func (u *User) HasOwnerWorkspaceSubscription() bool {
	if u == nil {
		return false
	}

	// Founding members keep full workspace access.
	if u.IsFoundingMember {
		return true
	}

	// Active beta grants full workspace access.
	if u.HasActiveBeta() {
		return true
	}

	status := strings.ToLower(strings.TrimSpace(u.SubscriptionStatus))
	switch status {
	case SubscriptionActive, SubscriptionLifetime:
		return true
	case SubscriptionTrialing, SubscriptionOnTrial:
		return u.HasActiveTrial()
	case SubscriptionPastDue:
		return u.CurrentPeriodEnd != nil && u.CurrentPeriodEnd.After(time.Now())
	case SubscriptionCancelled:
		return u.SubscriptionEndsAt != nil && u.SubscriptionEndsAt.After(time.Now())
	default:
		return false
	}
}

// EffectiveSubscriptionStatus returns the canonical status the app should use
// for display and billing UX.
func (u *User) EffectiveSubscriptionStatus() string {
	if u == nil {
		return SubscriptionInactive
	}

	return EffectiveSubscriptionStatus(
		u.SubscriptionStatus,
		u.TrialEndsAt,
		u.SubscriptionEndsAt,
		u.CurrentPeriodEnd,
	)
}
