// Package sqlite provides SQLite implementations of repository interfaces.
package sqlite

import (
	"database/sql"
	"time"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/domain"
)

// ToUser converts a sqlc.User to a domain.User.
func ToUser(u *sqlc.User) *domain.User {
	user := &domain.User{
		ID:                          u.ID,
		Name:                        u.Name,
		Email:                       u.Email,
		IsMasterPasswordSet:         u.IsMasterPasswordSet,
		CurrentDBHash:               u.CurrentDbHash,
		SyncVersion:                 u.SyncVersion,
		IsBlocked:                   u.IsBlocked,
		BackupReminderFrequencyDays: int(u.BackupReminderFrequencyDays),
		HasBetaAccess:               u.HasBetaAccess,
		IsFoundingMember:            u.IsFoundingMember,
		HasCollaborationAccess:      u.HasCollaborationAccess,
		IsAnalyticsDisabled:         u.IsAnalyticsDisabled,
		IsTrialSignalsDisabled:      u.IsTrialSignalsDisabled,
		OnboardingStatus:            u.OnboardingStatus,
		WhereHeardAbout:             u.WhereHeardAbout,
	}

	if u.CreatedAt.Valid {
		user.CreatedAt = u.CreatedAt.Time
	}
	if u.PrimarySpaceID.Valid {
		user.PrimarySpaceID = u.PrimarySpaceID.String
	}
	if u.LastUserDbBackup.Valid {
		user.LastUserDBBackup = &u.LastUserDbBackup.Time
	}
	if u.SubscriptionStatus.Valid {
		user.SubscriptionStatus = u.SubscriptionStatus.String
	}
	if u.SubscriptionID.Valid {
		user.SubscriptionID = &u.SubscriptionID.String
	}
	if u.CustomerID.Valid {
		user.CustomerID = &u.CustomerID.String
	}
	if u.VariantID.Valid {
		user.VariantID = &u.VariantID.String
	}
	if u.SubscriptionEndsAt.Valid {
		user.SubscriptionEndsAt = &u.SubscriptionEndsAt.Time
	}
	if u.TrialEndsAt.Valid {
		user.TrialEndsAt = &u.TrialEndsAt.Time
	}
	if u.CurrentPeriodEnd.Valid {
		user.CurrentPeriodEnd = &u.CurrentPeriodEnd.Time
	}
	if u.BetaExpiresAt.Valid {
		user.BetaExpiresAt = &u.BetaExpiresAt.Time
	}
	if u.OnboardingCompletedAt.Valid {
		user.OnboardingCompletedAt = &u.OnboardingCompletedAt.Time
	}
	if u.OnboardingSnoozedUntil.Valid {
		user.OnboardingSnoozedUntil = &u.OnboardingSnoozedUntil.Time
	}

	return user
}

// ToUserPreferences converts sqlc.UserPreference to domain.UserPreferences.
func ToUserPreferences(p *sqlc.UserPreference) *domain.UserPreferences {
	return &domain.UserPreferences{
		UserID:                    p.UserID,
		ThemeMode:                 p.ThemeMode,
		ThemePreset:               p.ThemePreset,
		ClassicFont:               p.ClassicFont,
		HomePage:                  p.HomePage,
		DesktopBudgetLayout:       p.DesktopBudgetLayout,
		CompactMobileLayout:       p.CompactMobileLayout,
		MobileBudgetLayout:        p.MobileBudgetLayout,
		MasterPasswordStorageMode: p.MasterPasswordStorageMode,
		MasterPasswordStorageDays: int(p.MasterPasswordStorageDays),
	}
}

// ToSpaceBlob converts a sqlc.BudgetSpaceBlob to a domain.SpaceBlob.
func ToSpaceBlob(b *sqlc.BudgetSpaceBlob) *domain.SpaceBlob {
	return &domain.SpaceBlob{
		SpaceID:              b.SpaceID,
		BlobPath:             b.BlobPath,
		CurrentHash:          b.CurrentHash,
		SyncVersion:          b.SyncVersion,
		SizeBytes:            b.SizeBytes,
		EncryptionKeyVersion: b.EncryptionKeyVersion,
		MutationVersion:      b.MutationVersion,
		DataFormatVersion:    b.DataFormatVersion,
		UpdatedAt:            b.UpdatedAt,
	}
}

// ToSpaceInvite converts a sqlc.BudgetSpaceInvite to a domain.SpaceInvite.
func ToSpaceInvite(i *sqlc.BudgetSpaceInvite) *domain.SpaceInvite {
	invite := &domain.SpaceInvite{
		ID:            i.ID,
		SpaceID:       i.SpaceID,
		InviterUserID: i.InviterUserID,
		InviteSecret:  i.InviteSecret,
		Status:        i.Status,
		CreatedAt:     i.CreatedAt,
	}

	if i.InviteeEmail.Valid {
		invite.InviteeEmail = i.InviteeEmail.String
	}
	if i.EncryptedBundle.Valid {
		invite.EncryptedBundle = i.EncryptedBundle.String
	}
	if i.ExpiresAt.Valid {
		invite.ExpiresAt = &i.ExpiresAt.Time
	}
	if i.RedeemedAt.Valid {
		invite.RedeemedAt = &i.RedeemedAt.Time
	}
	if i.RedeemedBy.Valid {
		invite.RedeemedBy = &i.RedeemedBy.String
	}

	return invite
}

// ToCredential converts a sqlc.LocalCredential to a domain.Credential.
func ToCredential(c *sqlc.LocalCredential) *domain.Credential {
	cred := &domain.Credential{
		UserID:       c.UserID,
		PasswordHash: c.PasswordHash,
		IsAdmin:      c.IsAdmin,
		CreatedAt:    c.CreatedAt,
	}
	if c.LastLoginAt.Valid {
		cred.LastLoginAt = &c.LastLoginAt.Time
	}
	return cred
}

// ToPushToken converts a sqlc.PushApiToken to a domain.PushToken.
func ToPushToken(t *sqlc.PushApiToken) *domain.PushToken {
	token := &domain.PushToken{
		UserID:    t.UserID,
		TokenHash: t.TokenHash,
		SpaceID:   t.SpaceID,
		IsEnabled: t.IsEnabled,
		CreatedAt: t.CreatedAt,
	}
	if t.LastUsed.Valid {
		token.LastUsed = &t.LastUsed.Time
	}
	return token
}

// ToPushQueueItem converts a sqlc.PushQueue to a domain.PushQueueItem.
func ToPushQueueItem(p *sqlc.PushQueue) domain.PushQueueItem {
	item := domain.PushQueueItem{
		ID:               p.ID,
		UserID:           p.UserID,
		SpaceID:          p.SpaceID,
		EncryptedPayload: p.EncryptedPayload,
		Status:           p.Status,
		CreatedAt:        p.CreatedAt,
	}
	if p.MessageID.Valid {
		item.MessageID = p.MessageID.String
	}
	if p.ProcessedAt.Valid {
		item.ProcessedAt = &p.ProcessedAt.Time
	}
	return item
}

// Helper functions for sql.Null types

// ToNullString converts a *string to sql.NullString.
func ToNullString(s *string) sql.NullString {
	if s == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *s, Valid: true}
}

// ToNullTime converts a *time.Time to sql.NullTime.
func ToNullTime(t *time.Time) sql.NullTime {
	if t == nil {
		return sql.NullTime{}
	}
	return sql.NullTime{Time: *t, Valid: true}
}

// ToInt64 converts an interface{} to int64 (for COALESCE results).
func ToInt64(v interface{}) int64 {
	switch val := v.(type) {
	case int64:
		return val
	case int:
		return int64(val)
	case float64:
		return int64(val)
	default:
		return 0
	}
}
