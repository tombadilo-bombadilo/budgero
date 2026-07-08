// Package fake provides in-memory implementations of repository interfaces for testing.
package fake

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"time"

	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
)

// Compile-time interface checks
var (
	_ repository.UserRepository         = (*UserRepository)(nil)
	_ repository.EntitlementRepository  = (*EntitlementRepository)(nil)
	_ repository.SpaceRepository        = (*SpaceRepository)(nil)
	_ repository.CredentialRepository   = (*CredentialRepository)(nil)
	_ repository.SyncRepository         = (*SyncRepository)(nil)
	_ repository.PushRepository         = (*PushRepository)(nil)
	_ repository.AdminRepository        = (*AdminRepository)(nil)
	_ repository.ExchangeRateRepository = (*ExchangeRateRepository)(nil)
	_ repository.TrialRewardsRepository = (*TrialRewardsRepository)(nil)
)

// --- UserRepository ---

// UserRepository is a fake in-memory implementation of the user repository for testing.
type UserRepository struct {
	mu          sync.RWMutex
	users       map[string]*domain.User
	preferences map[string]*domain.UserPreferences
}

// NewUserRepository creates a new fake user repository.
func NewUserRepository() *UserRepository {
	return &UserRepository{
		users:       make(map[string]*domain.User),
		preferences: make(map[string]*domain.UserPreferences),
	}
}

// GetByID retrieves a user by their ID.
func (r *UserRepository) GetByID(ctx context.Context, id string) (*domain.User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if u, ok := r.users[id]; ok {
		return u, nil
	}
	return nil, domain.ErrUserNotFound
}

// GetByEmail retrieves a user by their email address.
func (r *UserRepository) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, u := range r.users {
		if u.Email == email {
			return u, nil
		}
	}
	return nil, domain.ErrUserNotFound
}

// GetByCustomerID retrieves a user by their customer ID.
func (r *UserRepository) GetByCustomerID(ctx context.Context, customerID string) (*domain.User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, u := range r.users {
		if u.CustomerID != nil && *u.CustomerID == customerID {
			return u, nil
		}
	}
	return nil, domain.ErrUserNotFound
}

// Create stores a new user in the repository.
func (r *UserRepository) Create(ctx context.Context, user *domain.User) (*domain.User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	// Check for duplicate email (like a real database with unique constraint)
	for _, u := range r.users {
		if u.Email == user.Email {
			return nil, domain.ErrEmailAlreadyExists
		}
	}
	r.users[user.ID] = user
	return user, nil
}

// Update modifies an existing user's name and email.
func (r *UserRepository) Update(ctx context.Context, id, name, email string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if u, ok := r.users[id]; ok {
		u.Name = name
		u.Email = email
		return nil
	}
	return domain.ErrUserNotFound
}

// Delete removes a user from the repository.
func (r *UserRepository) Delete(ctx context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.users, id)
	return nil
}

// SetBlocked sets the blocked status for a user.
func (r *UserRepository) SetBlocked(ctx context.Context, id string, blocked bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if u, ok := r.users[id]; ok {
		u.IsBlocked = blocked
		return nil
	}
	return domain.ErrUserNotFound
}

// IsBlocked checks if a user is blocked.
func (r *UserRepository) IsBlocked(ctx context.Context, id string) (bool, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if u, ok := r.users[id]; ok {
		return u.IsBlocked, nil
	}
	return false, domain.ErrUserNotFound
}

// SetMasterPasswordStatus sets the master password status for a user.
func (r *UserRepository) SetMasterPasswordStatus(ctx context.Context, id string, isSet bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if u, ok := r.users[id]; ok {
		u.IsMasterPasswordSet = isSet
		return nil
	}
	return domain.ErrUserNotFound
}

// SetOnboardingState updates the onboarding state for a user.
func (r *UserRepository) SetOnboardingState(ctx context.Context, id, status string, completedAt, snoozedUntil *time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if u, ok := r.users[id]; ok {
		u.OnboardingStatus = status
		u.OnboardingCompletedAt = completedAt
		u.OnboardingSnoozedUntil = snoozedUntil
		return nil
	}
	return domain.ErrUserNotFound
}

// SetReferralSource records how the user discovered Budgero.
func (r *UserRepository) SetReferralSource(ctx context.Context, id, source string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if u, ok := r.users[id]; ok {
		u.WhereHeardAbout = source
		return nil
	}
	return domain.ErrUserNotFound
}

// UpdateBackupSettings updates the backup reminder settings for a user.
func (r *UserRepository) UpdateBackupSettings(ctx context.Context, id string, frequencyDays int, lastBackup *time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if u, ok := r.users[id]; ok {
		u.BackupReminderFrequencyDays = frequencyDays
		u.LastUserDBBackup = lastBackup
		return nil
	}
	return domain.ErrUserNotFound
}

// ResetUserData resets the sync-related data for a user.
func (r *UserRepository) ResetUserData(ctx context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if u, ok := r.users[id]; ok {
		u.CurrentDBHash = ""
		u.SyncVersion = 0
		u.IsMasterPasswordSet = false
		return nil
	}
	return domain.ErrUserNotFound
}

// SetAnalyticsDisabled sets the analytics opt-out flag for a user.
func (r *UserRepository) SetAnalyticsDisabled(ctx context.Context, id string, disabled bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if u, ok := r.users[id]; ok {
		u.IsAnalyticsDisabled = disabled
		return nil
	}
	return domain.ErrUserNotFound
}

// SetTrialSignalsDisabled sets the trial-signals opt-out flag for a user.
func (r *UserRepository) SetTrialSignalsDisabled(ctx context.Context, id string, disabled bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if u, ok := r.users[id]; ok {
		u.IsTrialSignalsDisabled = disabled
		return nil
	}
	return domain.ErrUserNotFound
}

// SetPrimarySpace sets the primary space for a user.
func (r *UserRepository) SetPrimarySpace(ctx context.Context, id, spaceID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if u, ok := r.users[id]; ok {
		u.PrimarySpaceID = spaceID
		return nil
	}
	return domain.ErrUserNotFound
}

// GetPreferences retrieves persisted preferences for a user.
func (r *UserRepository) GetPreferences(ctx context.Context, id string) (*domain.UserPreferences, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.users[id]; !ok {
		return nil, domain.ErrUserNotFound
	}
	if prefs, ok := r.preferences[id]; ok {
		clone := *prefs
		return &clone, nil
	}
	return nil, nil
}

// UpsertPreferences stores preferences for a user.
func (r *UserRepository) UpsertPreferences(ctx context.Context, prefs *domain.UserPreferences) error {
	if prefs == nil {
		return nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.users[prefs.UserID]; !ok {
		return domain.ErrUserNotFound
	}
	clone := *prefs
	r.preferences[prefs.UserID] = &clone
	return nil
}

// ClearDanglingPrimarySpaceIDs is a no-op for the fake repository.
func (r *UserRepository) ClearDanglingPrimarySpaceIDs(ctx context.Context) error {
	return nil
}

// --- EntitlementRepository ---

// EntitlementRepository is a fake in-memory implementation of the entitlement repository for testing.
type EntitlementRepository struct {
	mu       sync.RWMutex
	userRepo *UserRepository
}

// NewEntitlementRepository creates a new fake entitlement repository.
func NewEntitlementRepository(userRepo *UserRepository) *EntitlementRepository {
	return &EntitlementRepository{
		userRepo: userRepo,
	}
}

// MarkUserSubscribedIfFirstTime is a no-op fake — the fake users don't track subscribed_at.
func (r *EntitlementRepository) MarkUserSubscribedIfFirstTime(ctx context.Context, userID string, at time.Time) error {
	_ = ctx
	_ = userID
	_ = at
	return nil
}

// UpdateSubscription updates the subscription details for a user.
func (r *EntitlementRepository) UpdateSubscription(ctx context.Context, userID string, update domain.SubscriptionUpdate) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.userRepo.mu.Lock()
	defer r.userRepo.mu.Unlock()

	u, ok := r.userRepo.users[userID]
	if !ok {
		return domain.ErrUserNotFound
	}
	u.SubscriptionStatus = update.Status
	u.SubscriptionID = update.SubscriptionID
	u.CustomerID = update.CustomerID
	u.VariantID = update.VariantID
	u.SubscriptionEndsAt = update.SubscriptionEnds
	u.CurrentPeriodEnd = update.CurrentPeriodEnd
	u.TrialEndsAt = update.TrialEnds
	return nil
}

// UpdateSubscriptionStatus updates the subscription status and end dates for a user.
func (r *EntitlementRepository) UpdateSubscriptionStatus(ctx context.Context, userID, status string, endsAt, currentPeriodEnd *time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.userRepo.mu.Lock()
	defer r.userRepo.mu.Unlock()

	u, ok := r.userRepo.users[userID]
	if !ok {
		return domain.ErrUserNotFound
	}
	u.SubscriptionStatus = status
	u.SubscriptionEndsAt = endsAt
	u.CurrentPeriodEnd = currentPeriodEnd
	return nil
}

// UpdateSubscriptionFromProvider updates subscription details from a payment provider.
func (r *EntitlementRepository) UpdateSubscriptionFromProvider(ctx context.Context, userID string, info domain.SubscriptionInfo) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.userRepo.mu.Lock()
	defer r.userRepo.mu.Unlock()

	u, ok := r.userRepo.users[userID]
	if !ok {
		return domain.ErrUserNotFound
	}
	u.SubscriptionStatus = info.Status
	u.SubscriptionID = &info.SubscriptionID
	u.VariantID = &info.VariantID
	u.SubscriptionEndsAt = info.EndsAt
	u.TrialEndsAt = info.TrialEndsAt
	u.CurrentPeriodEnd = info.CurrentPeriodEnd
	return nil
}

// UpdateSubscriptionAfterResume updates subscription details after resuming a paused subscription.
func (r *EntitlementRepository) UpdateSubscriptionAfterResume(ctx context.Context, userID, status string, currentPeriodEnd *time.Time, variantID *string, trialEnds *time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.userRepo.mu.Lock()
	defer r.userRepo.mu.Unlock()

	u, ok := r.userRepo.users[userID]
	if !ok {
		return domain.ErrUserNotFound
	}
	u.SubscriptionStatus = status
	u.CurrentPeriodEnd = currentPeriodEnd
	u.VariantID = variantID
	u.TrialEndsAt = trialEnds
	return nil
}

// GrantFoundingMember grants founding member status to a user.
func (r *EntitlementRepository) GrantFoundingMember(ctx context.Context, userID string) error {
	r.userRepo.mu.Lock()
	defer r.userRepo.mu.Unlock()

	u, ok := r.userRepo.users[userID]
	if !ok {
		return domain.ErrUserNotFound
	}
	u.IsFoundingMember = true
	return nil
}

// GrantBetaAccess grants beta access to a user with an expiration date.
func (r *EntitlementRepository) GrantBetaAccess(ctx context.Context, userID string, expiresAt time.Time) error {
	r.userRepo.mu.Lock()
	defer r.userRepo.mu.Unlock()

	u, ok := r.userRepo.users[userID]
	if !ok {
		return domain.ErrUserNotFound
	}
	u.HasBetaAccess = true
	u.BetaExpiresAt = &expiresAt
	return nil
}

// RevokeBetaAccess revokes beta access from a user.
func (r *EntitlementRepository) RevokeBetaAccess(ctx context.Context, userID string) error {
	r.userRepo.mu.Lock()
	defer r.userRepo.mu.Unlock()

	u, ok := r.userRepo.users[userID]
	if !ok {
		return domain.ErrUserNotFound
	}
	u.HasBetaAccess = false
	u.BetaExpiresAt = nil
	return nil
}

// SetCollaborationAccess sets the collaboration access status for a user.
func (r *EntitlementRepository) SetCollaborationAccess(ctx context.Context, userID string, hasAccess bool) error {
	r.userRepo.mu.Lock()
	defer r.userRepo.mu.Unlock()

	u, ok := r.userRepo.users[userID]
	if !ok {
		return domain.ErrUserNotFound
	}
	u.HasCollaborationAccess = hasAccess
	return nil
}

// RevokeAllAccess revokes all access entitlements from a user.
func (r *EntitlementRepository) RevokeAllAccess(ctx context.Context, userID string) error {
	r.userRepo.mu.Lock()
	defer r.userRepo.mu.Unlock()

	u, ok := r.userRepo.users[userID]
	if !ok {
		return domain.ErrUserNotFound
	}
	u.HasBetaAccess = false
	u.BetaExpiresAt = nil
	u.IsFoundingMember = false
	u.HasCollaborationAccess = false
	u.SubscriptionStatus = ""
	return nil
}

// --- SpaceRepository ---

// SpaceRepository is a fake in-memory implementation of the space repository for testing.
type SpaceRepository struct {
	mu        sync.RWMutex
	spaces    map[string]*domain.Space
	members   map[string]map[string]*domain.SpaceMember // spaceID -> userID -> member
	blobs     map[string]*domain.SpaceBlob
	invites   map[string]*domain.SpaceInvite // inviteSecret -> invite
	inviteIDs map[string]*domain.SpaceInvite // inviteID -> invite
}

// NewSpaceRepository creates a new fake space repository.
func NewSpaceRepository() *SpaceRepository {
	return &SpaceRepository{
		spaces:    make(map[string]*domain.Space),
		members:   make(map[string]map[string]*domain.SpaceMember),
		blobs:     make(map[string]*domain.SpaceBlob),
		invites:   make(map[string]*domain.SpaceInvite),
		inviteIDs: make(map[string]*domain.SpaceInvite),
	}
}

// Create stores a new space in the repository.
func (r *SpaceRepository) Create(ctx context.Context, space *domain.Space) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.spaces[space.SpaceID] = space
	r.members[space.SpaceID] = make(map[string]*domain.SpaceMember)
	return nil
}

// GetOwner retrieves the owner user ID for a space.
func (r *SpaceRepository) GetOwner(ctx context.Context, spaceID string) (string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if s, ok := r.spaces[spaceID]; ok {
		return s.OwnerUserID, nil
	}
	return "", domain.ErrSpaceNotFound
}

// UpdateDisplayName updates the display name of a space.
func (r *SpaceRepository) UpdateDisplayName(ctx context.Context, spaceID, displayName string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.spaces[spaceID]; ok {
		s.DisplayName = displayName
		return nil
	}
	return domain.ErrSpaceNotFound
}

// Delete removes a space and its members from the repository.
func (r *SpaceRepository) Delete(ctx context.Context, spaceID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	_ = ctx
	delete(r.spaces, spaceID)
	delete(r.members, spaceID)
	return nil
}

// CountOccupiedCollaboratorSlotsByOwner counts occupied collaborator slots for an owner.
func (r *SpaceRepository) CountOccupiedCollaboratorSlotsByOwner(
	ctx context.Context,
	ownerUserID string,
	excludeInviteID string,
) (int, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_ = ctx

	count := 0
	for spaceID, space := range r.spaces {
		if space.OwnerUserID != ownerUserID {
			continue
		}
		if members, ok := r.members[spaceID]; ok {
			for _, member := range members {
				if member.Role == domain.RoleMember && member.InvitationStatus == domain.InvitationAccepted {
					count++
				}
			}
		}
		for _, invite := range r.inviteIDs {
			if invite.SpaceID != spaceID || invite.ID == excludeInviteID {
				continue
			}
			if invite.Status == domain.InvitationPending {
				count++
			}
		}
	}

	return count, nil
}

// ListForUser returns all spaces that a user is a member of with accepted status.
func (r *SpaceRepository) ListForUser(ctx context.Context, userID string) ([]domain.SpaceSummary, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []domain.SpaceSummary
	for spaceID, members := range r.members {
		if m, ok := members[userID]; ok && m.InvitationStatus == "accepted" {
			if s, ok := r.spaces[spaceID]; ok {
				result = append(result, domain.SpaceSummary{
					SpaceID:          spaceID,
					DisplayName:      s.DisplayName,
					OwnerUserID:      s.OwnerUserID,
					Role:             m.Role,
					InvitationStatus: m.InvitationStatus,
					CreatedAt:        s.CreatedAt,
				})
			}
		}
	}
	return result, nil
}

// GetMemberInvitationStatus retrieves the invitation status for a user in a space.
func (r *SpaceRepository) GetMemberInvitationStatus(ctx context.Context, spaceID, userID string) (string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if members, ok := r.members[spaceID]; ok {
		if m, ok := members[userID]; ok {
			return m.InvitationStatus, nil
		}
	}
	return "", domain.ErrSpaceAccessDenied
}

// GetFirstAcceptedMembership returns the first space ID where the user has accepted membership.
func (r *SpaceRepository) GetFirstAcceptedMembership(ctx context.Context, userID string) (string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for spaceID, members := range r.members {
		if m, ok := members[userID]; ok && m.InvitationStatus == "accepted" {
			return spaceID, nil
		}
	}
	return "", domain.ErrSpaceAccessDenied
}

// CreateBlob stores a new blob path for a space.
func (r *SpaceRepository) CreateBlob(ctx context.Context, spaceID, blobPath string) error {
	if blobPath == "" {
		blobPath = "data/budget_spaces/space_" + spaceID + ".db"
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.blobs[spaceID] = &domain.SpaceBlob{SpaceID: spaceID, BlobPath: blobPath, EncryptionKeyVersion: 1}
	return nil
}

// GetBlob retrieves the blob information for a space.
func (r *SpaceRepository) GetBlob(ctx context.Context, spaceID string) (*domain.SpaceBlob, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if b, ok := r.blobs[spaceID]; ok {
		return b, nil
	}
	return nil, domain.ErrSpaceNotFound
}

// UpdateSyncState updates the sync state for a space blob and returns the new version.
func (r *SpaceRepository) UpdateSyncState(ctx context.Context, spaceID, hash string, sizeBytes, mutationVersion int64) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if b, ok := r.blobs[spaceID]; ok {
		b.CurrentHash = hash
		b.SizeBytes = sizeBytes
		b.MutationVersion = mutationVersion
		b.SyncVersion++
		return b.SyncVersion, nil
	}
	return 0, domain.ErrSpaceNotFound
}

// UpdateSyncStateCAS updates the sync state only if the current version matches expectedVersion.
func (r *SpaceRepository) UpdateSyncStateCAS(ctx context.Context, spaceID, hash string, sizeBytes, mutationVersion, expectedVersion int64) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	b, ok := r.blobs[spaceID]
	if !ok {
		return 0, domain.ErrSpaceNotFound
	}
	if b.SyncVersion != expectedVersion {
		return 0, domain.ErrSyncVersionConflict
	}
	b.CurrentHash = hash
	b.SizeBytes = sizeBytes
	b.MutationVersion = mutationVersion
	b.SyncVersion++
	return b.SyncVersion, nil
}

// IncrementEncryptionKeyVersion increments the encryption key version for a space blob.
func (r *SpaceRepository) IncrementEncryptionKeyVersion(ctx context.Context, spaceID string) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if b, ok := r.blobs[spaceID]; ok {
		b.EncryptionKeyVersion++
		return b.EncryptionKeyVersion, nil
	}
	return 0, domain.ErrSpaceNotFound
}

// RaiseDataFormatVersion records the blob's client data-format version (never lowers it).
func (r *SpaceRepository) RaiseDataFormatVersion(ctx context.Context, spaceID string, version int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if b, ok := r.blobs[spaceID]; ok {
		if version > b.DataFormatVersion {
			b.DataFormatVersion = version
		}
		return nil
	}
	return domain.ErrSpaceNotFound
}

// DeleteBlob removes the blob for a space.
func (r *SpaceRepository) DeleteBlob(ctx context.Context, spaceID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.blobs, spaceID)
	return nil
}

// ListBlobsByOwner returns all blobs owned by a specific user.
func (r *SpaceRepository) ListBlobsByOwner(ctx context.Context, ownerID string) ([]domain.SpaceBlob, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []domain.SpaceBlob
	for spaceID, blob := range r.blobs {
		if s, ok := r.spaces[spaceID]; ok && s.OwnerUserID == ownerID {
			result = append(result, *blob)
		}
	}
	return result, nil
}

// CreateMember adds a new member to a space.
func (r *SpaceRepository) CreateMember(ctx context.Context, member *domain.SpaceMember) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.members[member.SpaceID]; !ok {
		r.members[member.SpaceID] = make(map[string]*domain.SpaceMember)
	}
	r.members[member.SpaceID][member.UserID] = member
	return nil
}

// ListMembers returns all members of a space.
func (r *SpaceRepository) ListMembers(ctx context.Context, spaceID string) ([]domain.SpaceMember, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if members, ok := r.members[spaceID]; ok {
		result := make([]domain.SpaceMember, 0, len(members))
		for _, m := range members {
			result = append(result, *m)
		}
		return result, nil
	}
	return nil, nil
}

// UpdateMemberEncryptedKey updates the encrypted space key for a member.
func (r *SpaceRepository) UpdateMemberEncryptedKey(ctx context.Context, spaceID, userID, encryptedKey string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if members, ok := r.members[spaceID]; ok {
		if m, ok := members[userID]; ok {
			m.EncryptedSpaceKey = encryptedKey
			return nil
		}
	}
	return domain.ErrSpaceAccessDenied
}

// DeleteMember removes a member from a space.
func (r *SpaceRepository) DeleteMember(ctx context.Context, spaceID, userID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if members, ok := r.members[spaceID]; ok {
		delete(members, userID)
	}
	return nil
}

// DeleteAllMembershipsForUser removes a user from all spaces.
func (r *SpaceRepository) DeleteAllMembershipsForUser(ctx context.Context, userID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, members := range r.members {
		delete(members, userID)
	}
	return nil
}

// DeleteAllMembershipsForSpace removes all members from a space.
func (r *SpaceRepository) DeleteAllMembershipsForSpace(ctx context.Context, spaceID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.members, spaceID)
	return nil
}

// CreateInvite stores a new space invite in the repository.
func (r *SpaceRepository) CreateInvite(ctx context.Context, invite *domain.SpaceInvite) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.invites[invite.InviteSecret] = invite
	r.inviteIDs[invite.ID] = invite
	return nil
}

// GetInviteBySecret retrieves a space invite by its secret.
func (r *SpaceRepository) GetInviteBySecret(ctx context.Context, secret string) (*domain.SpaceInvite, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if inv, ok := r.invites[secret]; ok {
		return inv, nil
	}
	return nil, domain.ErrInviteNotFound
}

// UpdateInviteBundle updates the encrypted bundle for an invite.
func (r *SpaceRepository) UpdateInviteBundle(ctx context.Context, inviteID, spaceID, bundle string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if inv, ok := r.inviteIDs[inviteID]; ok {
		inv.EncryptedBundle = bundle
		return nil
	}
	return domain.ErrInviteNotFound
}

// MarkInviteRedeemed marks an invite as redeemed by a user.
func (r *SpaceRepository) MarkInviteRedeemed(ctx context.Context, inviteID, redeemedBy string, redeemedAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if inv, ok := r.inviteIDs[inviteID]; ok {
		inv.RedeemedBy = &redeemedBy
		inv.RedeemedAt = &redeemedAt
		inv.Status = "redeemed"
		return nil
	}
	return domain.ErrInviteNotFound
}

// MarkInviteExpired marks an invite as expired.
func (r *SpaceRepository) MarkInviteExpired(ctx context.Context, inviteID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if inv, ok := r.inviteIDs[inviteID]; ok {
		inv.Status = "expired"
		return nil
	}
	return domain.ErrInviteNotFound
}

// DeleteInvite removes an invite from the repository.
func (r *SpaceRepository) DeleteInvite(ctx context.Context, inviteID, spaceID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	_ = ctx
	_ = spaceID
	if inv, ok := r.inviteIDs[inviteID]; ok {
		delete(r.invites, inv.InviteSecret)
		delete(r.inviteIDs, inviteID)
	}
	return nil
}

// DeleteAllInvitesForSpace removes all invites for a space.
func (r *SpaceRepository) DeleteAllInvitesForSpace(ctx context.Context, spaceID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	_ = ctx
	for inviteID, invite := range r.inviteIDs {
		if invite.SpaceID != spaceID {
			continue
		}
		delete(r.invites, invite.InviteSecret)
		delete(r.inviteIDs, inviteID)
	}
	return nil
}

// ListInvites returns all invites for a space.
func (r *SpaceRepository) ListInvites(ctx context.Context, spaceID string) ([]domain.SpaceInvite, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []domain.SpaceInvite
	for _, inv := range r.inviteIDs {
		if inv.SpaceID == spaceID {
			result = append(result, *inv)
		}
	}
	return result, nil
}

// --- CredentialRepository ---

// CredentialRepository is a fake in-memory implementation of the credential repository for testing.
type CredentialRepository struct {
	mu          sync.RWMutex
	credentials map[string]*domain.Credential
}

// NewCredentialRepository creates a new fake credential repository.
func NewCredentialRepository() *CredentialRepository {
	return &CredentialRepository{credentials: make(map[string]*domain.Credential)}
}

// Create stores a new credential in the repository.
func (r *CredentialRepository) Create(ctx context.Context, userID, passwordHash string, isAdmin bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.credentials[userID]; exists {
		return domain.ErrCredentialExists
	}
	r.credentials[userID] = &domain.Credential{
		UserID:       userID,
		PasswordHash: passwordHash,
		IsAdmin:      isAdmin,
		CreatedAt:    time.Now(),
	}
	return nil
}

// Upsert creates or updates a credential in the repository.
func (r *CredentialRepository) Upsert(ctx context.Context, userID, passwordHash string, isAdmin bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	if cred, exists := r.credentials[userID]; exists {
		cred.PasswordHash = passwordHash
		cred.IsAdmin = isAdmin
		cred.UpdatedAt = &now
	} else {
		r.credentials[userID] = &domain.Credential{
			UserID:       userID,
			PasswordHash: passwordHash,
			IsAdmin:      isAdmin,
			CreatedAt:    now,
		}
	}
	return nil
}

// Get retrieves a credential by user ID.
func (r *CredentialRepository) Get(ctx context.Context, userID string) (*domain.Credential, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if cred, ok := r.credentials[userID]; ok {
		return cred, nil
	}
	return nil, domain.ErrCredentialNotFound
}

// UpdatePassword updates the password hash for a credential.
func (r *CredentialRepository) UpdatePassword(ctx context.Context, userID, passwordHash string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if cred, ok := r.credentials[userID]; ok {
		cred.PasswordHash = passwordHash
		now := time.Now()
		cred.UpdatedAt = &now
		return nil
	}
	return domain.ErrCredentialNotFound
}

// SetAdmin sets the admin status for a credential.
func (r *CredentialRepository) SetAdmin(ctx context.Context, userID string, isAdmin bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if cred, ok := r.credentials[userID]; ok {
		cred.IsAdmin = isAdmin
		return nil
	}
	return domain.ErrCredentialNotFound
}

// IsAdmin checks if a user has admin privileges.
func (r *CredentialRepository) IsAdmin(ctx context.Context, userID string) (bool, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if cred, ok := r.credentials[userID]; ok {
		return cred.IsAdmin, nil
	}
	return false, domain.ErrCredentialNotFound
}

// MarkLogin records the last login time for a credential.
func (r *CredentialRepository) MarkLogin(ctx context.Context, userID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if cred, ok := r.credentials[userID]; ok {
		now := time.Now()
		cred.LastLoginAt = &now
		return nil
	}
	return domain.ErrCredentialNotFound
}

// --- SyncRepository ---

// SyncRepository is a fake in-memory implementation of the sync repository for testing.
type SyncRepository struct {
	mu             sync.RWMutex
	latestVersions map[string]int64 // spaceID -> latest mutation version
}

// NewSyncRepository creates a new fake sync repository.
func NewSyncRepository() *SyncRepository {
	return &SyncRepository{
		latestVersions: make(map[string]int64),
	}
}

// SeedLatestVersion sets the latest mutation version for a space (test helper).
func (r *SyncRepository) SeedLatestVersion(spaceID string, version int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.latestVersions[spaceID] = version
}

// GetLatestVersion returns the latest mutation version for a space.
func (r *SyncRepository) GetLatestVersion(ctx context.Context, spaceID string) (int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.latestVersions[spaceID], nil
}

// --- PushRepository ---

// PushRepository is a fake in-memory implementation of the push repository for testing.
type PushRepository struct {
	mu         sync.RWMutex
	tokens     map[string]*domain.PushToken     // userID -> token
	tokenHash  map[string]*domain.PushToken     // tokenHash -> token
	queueItems map[string]*domain.PushQueueItem // itemID -> item
	messages   map[string]map[string]string     // spaceID -> messageID -> itemID
}

// NewPushRepository creates a new fake push repository.
func NewPushRepository() *PushRepository {
	return &PushRepository{
		tokens:     make(map[string]*domain.PushToken),
		tokenHash:  make(map[string]*domain.PushToken),
		queueItems: make(map[string]*domain.PushQueueItem),
		messages:   make(map[string]map[string]string),
	}
}

// UpsertToken creates or updates a push token for a user.
func (r *PushRepository) UpsertToken(ctx context.Context, userID, tokenHash, spaceID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	// Remove old token hash mapping if exists
	if old, ok := r.tokens[userID]; ok {
		delete(r.tokenHash, old.TokenHash)
	}
	token := &domain.PushToken{
		UserID:    userID,
		TokenHash: tokenHash,
		SpaceID:   spaceID,
		IsEnabled: true,
		CreatedAt: time.Now(),
	}
	r.tokens[userID] = token
	r.tokenHash[tokenHash] = token
	return nil
}

// GetToken retrieves a push token by user ID.
func (r *PushRepository) GetToken(ctx context.Context, userID string) (*domain.PushToken, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if token, ok := r.tokens[userID]; ok {
		return token, nil
	}
	return nil, domain.ErrPushTokenNotFound
}

// GetTokenByHash retrieves a push token by its hash.
func (r *PushRepository) GetTokenByHash(ctx context.Context, tokenHash string) (*domain.PushToken, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if token, ok := r.tokenHash[tokenHash]; ok {
		return token, nil
	}
	return nil, domain.ErrPushTokenNotFound
}

// SetTokenEnabled enables or disables a push token.
func (r *PushRepository) SetTokenEnabled(ctx context.Context, userID string, enabled bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if token, ok := r.tokens[userID]; ok {
		token.IsEnabled = enabled
		return nil
	}
	return domain.ErrPushTokenNotFound
}

// DeleteToken removes a push token for a user.
func (r *PushRepository) DeleteToken(ctx context.Context, userID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if token, ok := r.tokens[userID]; ok {
		delete(r.tokenHash, token.TokenHash)
		delete(r.tokens, userID)
	}
	return nil
}

// MarkTokenUsed records the last usage time for a push token.
func (r *PushRepository) MarkTokenUsed(ctx context.Context, userID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if token, ok := r.tokens[userID]; ok {
		now := time.Now()
		token.LastUsed = &now
		return nil
	}
	return domain.ErrPushTokenNotFound
}

// CreateQueueItem adds a new item to the push queue.
func (r *PushRepository) CreateQueueItem(ctx context.Context, item *domain.PushQueueItem) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	item.CreatedAt = time.Now()
	r.queueItems[item.ID] = item
	// Track message ID for duplicate detection
	if item.MessageID != "" {
		if _, ok := r.messages[item.SpaceID]; !ok {
			r.messages[item.SpaceID] = make(map[string]string)
		}
		r.messages[item.SpaceID][item.MessageID] = item.ID
	}
	return nil
}

// CheckDuplicateMessage checks if a message ID already exists in the queue.
func (r *PushRepository) CheckDuplicateMessage(ctx context.Context, spaceID, messageID string) (existingID, status string, exists bool, err error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if msgs, ok := r.messages[spaceID]; ok {
		if itemID, ok := msgs[messageID]; ok {
			if item, ok := r.queueItems[itemID]; ok {
				return itemID, item.Status, true, nil
			}
		}
	}
	return "", "", false, nil
}

// ListPendingItems returns all pending push queue items for a user.
func (r *PushRepository) ListPendingItems(ctx context.Context, userID string) ([]domain.PushQueueItem, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []domain.PushQueueItem
	for _, item := range r.queueItems {
		if item.UserID == userID && item.Status == domain.PushStatusPending {
			result = append(result, *item)
		}
	}
	return result, nil
}

// ListPendingItemsForSpace returns pending push queue items for a user in a specific space.
func (r *PushRepository) ListPendingItemsForSpace(ctx context.Context, userID, spaceID string) ([]domain.PushQueueItem, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []domain.PushQueueItem
	for _, item := range r.queueItems {
		if item.UserID == userID && item.SpaceID == spaceID && item.Status == domain.PushStatusPending {
			result = append(result, *item)
		}
	}
	return result, nil
}

// UpdateItemStatus updates the status of a push queue item.
func (r *PushRepository) UpdateItemStatus(ctx context.Context, itemID, userID, status string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if item, ok := r.queueItems[itemID]; ok {
		if item.UserID != userID {
			return domain.ErrSpaceAccessDenied
		}
		item.Status = status
		now := time.Now()
		item.ProcessedAt = &now
		return nil
	}
	return nil
}

// GetStats returns push queue statistics for a user.
func (r *PushRepository) GetStats(ctx context.Context, userID string) (*domain.PushQueueStats, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	stats := &domain.PushQueueStats{}
	for _, item := range r.queueItems {
		if item.UserID == userID {
			stats.Total++
			switch item.Status {
			case domain.PushStatusPending:
				stats.Pending++
			case domain.PushStatusProcessed:
				stats.Processed++
			case domain.PushStatusFailed:
				stats.Failed++
			}
		}
	}
	return stats, nil
}

// ClearPendingQueue removes all pending items from the queue for a user.
func (r *PushRepository) ClearPendingQueue(ctx context.Context, userID string) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var count int64
	for id, item := range r.queueItems {
		if item.UserID == userID && item.Status == domain.PushStatusPending {
			delete(r.queueItems, id)
			count++
		}
	}
	return count, nil
}

// ClearAllQueue removes all items from the queue for a user.
func (r *PushRepository) ClearAllQueue(ctx context.Context, userID string) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var count int64
	for id, item := range r.queueItems {
		if item.UserID == userID {
			delete(r.queueItems, id)
			count++
		}
	}
	return count, nil
}

// --- AdminRepository ---

// AdminRepository is a fake in-memory implementation of the admin repository for testing.
type AdminRepository struct {
	userRepo *UserRepository
	credRepo *CredentialRepository
}

// NewAdminRepository creates a new fake admin repository.
func NewAdminRepository(userRepo *UserRepository, credRepo *CredentialRepository) *AdminRepository {
	return &AdminRepository{
		userRepo: userRepo,
		credRepo: credRepo,
	}
}

// GetStats returns aggregate statistics about users and subscriptions.
func (r *AdminRepository) GetStats(ctx context.Context) (*repository.AdminStats, error) {
	r.userRepo.mu.RLock()
	defer r.userRepo.mu.RUnlock()
	stats := &repository.AdminStats{}
	for _, u := range r.userRepo.users {
		stats.TotalUsers++
		if u.SubscriptionStatus == domain.SubscriptionActive {
			stats.ActiveUsers++
			stats.PaidUsers++
		}
		if u.SubscriptionStatus == domain.SubscriptionTrialing {
			stats.TrialUsers++
		}
		if u.HasBetaAccess {
			stats.BetaUsers++
		}
		if u.IsFoundingMember {
			stats.FoundingMembers++
		}
	}
	return stats, nil
}

// GetSelfHostStats returns statistics for self-hosted deployments.
func (r *AdminRepository) GetSelfHostStats(ctx context.Context) (*repository.SelfHostStats, error) {
	r.userRepo.mu.RLock()
	defer r.userRepo.mu.RUnlock()
	r.credRepo.mu.RLock()
	defer r.credRepo.mu.RUnlock()

	stats := &repository.SelfHostStats{
		TotalUsers: int64(len(r.userRepo.users)),
	}
	for _, cred := range r.credRepo.credentials {
		stats.LocalAccounts++
		if cred.IsAdmin {
			stats.AdminUsers++
		}
	}
	for _, u := range r.userRepo.users {
		if u.IsMasterPasswordSet {
			stats.MasterPasswordUsers++
		}
	}
	return stats, nil
}

// ListUsers returns all users with their subscription information.
func (r *AdminRepository) ListUsers(ctx context.Context) ([]repository.AdminUser, error) {
	r.userRepo.mu.RLock()
	defer r.userRepo.mu.RUnlock()
	result := make([]repository.AdminUser, 0, len(r.userRepo.users))
	for _, u := range r.userRepo.users {
		result = append(result, repository.AdminUser{
			ID:                     u.ID,
			Name:                   u.Name,
			Email:                  u.Email,
			CreatedAt:              u.CreatedAt,
			SubscriptionStatus:     u.SubscriptionStatus,
			SubscriptionID:         u.SubscriptionID,
			CustomerID:             u.CustomerID,
			HasBetaAccess:          u.HasBetaAccess,
			IsFoundingMember:       u.IsFoundingMember,
			HasCollaborationAccess: u.HasCollaborationAccess,
			IsBlocked:              u.IsBlocked,
		})
	}
	return result, nil
}

// GetUser returns a single user for admin views.
func (r *AdminRepository) GetUser(ctx context.Context, userID string) (*repository.AdminUser, error) {
	r.userRepo.mu.RLock()
	defer r.userRepo.mu.RUnlock()

	user, ok := r.userRepo.users[userID]
	if !ok {
		return nil, domain.ErrUserNotFound
	}

	result := &repository.AdminUser{
		ID:                     user.ID,
		Name:                   user.Name,
		Email:                  user.Email,
		CreatedAt:              user.CreatedAt,
		SubscriptionStatus:     user.SubscriptionStatus,
		SubscriptionID:         user.SubscriptionID,
		CustomerID:             user.CustomerID,
		VariantID:              user.VariantID,
		SubscriptionEndsAt:     user.SubscriptionEndsAt,
		TrialEndsAt:            user.TrialEndsAt,
		CurrentPeriodEnd:       user.CurrentPeriodEnd,
		HasBetaAccess:          user.HasBetaAccess,
		BetaExpiresAt:          user.BetaExpiresAt,
		IsFoundingMember:       user.IsFoundingMember,
		IsMasterPasswordSet:    user.IsMasterPasswordSet,
		HasCollaborationAccess: user.HasCollaborationAccess,
		IsBlocked:              user.IsBlocked,
	}
	if cred, ok := r.credRepo.credentials[userID]; ok {
		result.LastLogin = cred.LastLoginAt
		result.IsAdmin = cred.IsAdmin
	}

	return result, nil
}

// ListSelfHostUsers returns all users for self-hosted admin views.
func (r *AdminRepository) ListSelfHostUsers(ctx context.Context) ([]repository.SelfHostUser, error) {
	r.userRepo.mu.RLock()
	defer r.userRepo.mu.RUnlock()
	r.credRepo.mu.RLock()
	defer r.credRepo.mu.RUnlock()

	result := make([]repository.SelfHostUser, 0, len(r.userRepo.users))
	for _, u := range r.userRepo.users {
		user := repository.SelfHostUser{
			ID:                  u.ID,
			Name:                u.Name,
			Email:               u.Email,
			CreatedAt:           u.CreatedAt,
			IsBlocked:           u.IsBlocked,
			IsMasterPasswordSet: u.IsMasterPasswordSet,
		}
		if cred, ok := r.credRepo.credentials[u.ID]; ok {
			user.HasLocalPassword = true
			user.IsAdmin = cred.IsAdmin
			user.LastLoginAt = cred.LastLoginAt
		}
		result = append(result, user)
	}
	return result, nil
}

// ListRecentUsers returns recently created users.
func (r *AdminRepository) ListRecentUsers(ctx context.Context) ([]repository.RecentUser, error) {
	r.userRepo.mu.RLock()
	defer r.userRepo.mu.RUnlock()
	result := make([]repository.RecentUser, 0, len(r.userRepo.users))
	for _, u := range r.userRepo.users {
		result = append(result, repository.RecentUser{
			ID:        u.ID,
			Name:      u.Name,
			Email:     u.Email,
			CreatedAt: u.CreatedAt,
		})
	}
	return result, nil
}

// ListUsersWithSubscription returns users who have active subscriptions.
func (r *AdminRepository) ListUsersWithSubscription(ctx context.Context) ([]repository.UserWithSubscription, error) {
	r.userRepo.mu.RLock()
	defer r.userRepo.mu.RUnlock()
	var result []repository.UserWithSubscription
	for _, u := range r.userRepo.users {
		if u.SubscriptionID != nil && u.CustomerID != nil {
			result = append(result, repository.UserWithSubscription{
				ID:             u.ID,
				Email:          u.Email,
				SubscriptionID: *u.SubscriptionID,
				CustomerID:     *u.CustomerID,
			})
		}
	}
	return result, nil
}

// CountUserMutations returns the total number of mutations authored by a user.
func (r *AdminRepository) CountUserMutations(ctx context.Context, userID string) (int64, error) {
	return 0, nil
}

// GetLastUserMutation returns the latest mutation authored by a user.
func (r *AdminRepository) GetLastUserMutation(ctx context.Context, userID string) (*repository.UserMutationRecord, error) {
	return nil, sql.ErrNoRows
}

// ListUserMutationDays returns mutation counts grouped by day.
func (r *AdminRepository) ListUserMutationDays(ctx context.Context, userID string, startInclusive, endExclusive time.Time) ([]repository.AdminDayCount, error) {
	return []repository.AdminDayCount{}, nil
}

// MigrateUserID migrates a user from an old ID to a new ID.
func (r *AdminRepository) MigrateUserID(ctx context.Context, oldID, newID, name, email string) error {
	r.userRepo.mu.Lock()
	defer r.userRepo.mu.Unlock()
	if u, ok := r.userRepo.users[oldID]; ok {
		u.ID = newID
		u.Name = name
		u.Email = email
		delete(r.userRepo.users, oldID)
		r.userRepo.users[newID] = u
		return nil
	}
	return domain.ErrUserNotFound
}

// BackfillTrialForInactiveUsers grants trial access to inactive users without subscriptions.
func (r *AdminRepository) BackfillTrialForInactiveUsers(ctx context.Context, trialDays int) (int64, error) {
	r.userRepo.mu.Lock()
	defer r.userRepo.mu.Unlock()
	var count int64
	trialEnd := time.Now().AddDate(0, 0, trialDays)
	for _, u := range r.userRepo.users {
		if u.SubscriptionStatus == "" && !u.IsFoundingMember && !u.HasBetaAccess {
			u.SubscriptionStatus = domain.SubscriptionTrialing
			u.TrialEndsAt = &trialEnd
			count++
		}
	}
	return count, nil
}

// IsLocalAdmin checks if a user is a local admin.
func (r *AdminRepository) IsLocalAdmin(ctx context.Context, userID string) (bool, error) {
	r.credRepo.mu.RLock()
	defer r.credRepo.mu.RUnlock()
	if cred, ok := r.credRepo.credentials[userID]; ok {
		return cred.IsAdmin, nil
	}
	return false, nil
}

// RevokeAllAccess revokes all access and subscription entitlements from a user.
func (r *AdminRepository) RevokeAllAccess(ctx context.Context, userID string) error {
	r.userRepo.mu.Lock()
	defer r.userRepo.mu.Unlock()
	if u, ok := r.userRepo.users[userID]; ok {
		u.HasBetaAccess = false
		u.BetaExpiresAt = nil
		u.IsFoundingMember = false
		u.HasCollaborationAccess = false
		u.SubscriptionStatus = ""
		u.SubscriptionID = nil
		u.CustomerID = nil
		return nil
	}
	return domain.ErrUserNotFound
}

// --- ExchangeRateRepository ---

// ExchangeRateRepository is a fake in-memory implementation of the exchange rate repository for testing.
type ExchangeRateRepository struct {
	mu    sync.RWMutex
	rates map[string]float64 // key: "base:target:month" -> rate
}

// NewExchangeRateRepository creates a new fake exchange rate repository.
func NewExchangeRateRepository() *ExchangeRateRepository {
	return &ExchangeRateRepository{
		rates: make(map[string]float64),
	}
}

func (r *ExchangeRateRepository) rateKey(base, target, month string) string {
	return base + ":" + target + ":" + month
}

// GetRate retrieves an exchange rate for a currency pair and month.
func (r *ExchangeRateRepository) GetRate(ctx context.Context, baseCurrency, targetCurrency, month string) (float64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	key := r.rateKey(baseCurrency, targetCurrency, month)
	if rate, ok := r.rates[key]; ok {
		return rate, nil
	}
	return 0, nil // Return 0 for not found (not an error in this context)
}

// UpsertRate creates or updates an exchange rate for a currency pair and month.
func (r *ExchangeRateRepository) UpsertRate(ctx context.Context, baseCurrency, targetCurrency, month string, rate float64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := r.rateKey(baseCurrency, targetCurrency, month)
	r.rates[key] = rate
	return nil
}

// TrialRewardsRepository is an in-memory implementation of
// repository.TrialRewardsRepository for tests. Signals are stored in a flat
// slice with PK semantics enforced manually on Upsert.
type TrialRewardsRepository struct {
	signals  []domain.TrialSignal
	progress map[string]*domain.TrialProgress
	codes    map[string]*domain.DiscountCode
	// Mutations is used by the forgery-check counter; tests can set it.
	Mutations map[string]int
}

// NewTrialRewardsRepository constructs an empty in-memory repository.
func NewTrialRewardsRepository() *TrialRewardsRepository {
	return &TrialRewardsRepository{
		progress:  make(map[string]*domain.TrialProgress),
		codes:     make(map[string]*domain.DiscountCode),
		Mutations: make(map[string]int),
	}
}

// RecordSignal upserts a (user, kind, day) row, incrementing on collision.
func (r *TrialRewardsRepository) RecordSignal(ctx context.Context, userID string, kind domain.SignalKind, day string, at time.Time) error {
	for i := range r.signals {
		s := &r.signals[i]
		if s.UserID == userID && s.Kind == kind && s.Day == day {
			s.Count++
			s.LastAt = at
			return nil
		}
	}
	r.signals = append(r.signals, domain.TrialSignal{
		UserID:  userID,
		Kind:    kind,
		Day:     day,
		Count:   1,
		FirstAt: at,
		LastAt:  at,
	})
	return nil
}

// CountDistinctLoggingDaysInRange returns distinct daily-logging days in range.
func (r *TrialRewardsRepository) CountDistinctLoggingDaysInRange(ctx context.Context, userID, fromDay, toDay string) (int, error) {
	count := 0
	for _, s := range r.signals {
		if s.UserID == userID && s.Kind == domain.SignalDailyLogging && s.Day >= fromDay && s.Day <= toDay {
			count++
		}
	}
	return count, nil
}

// CountDistinctMonthsForKind returns the number of distinct rows for a kind.
// In the fake, signals are unique by (user_id, kind, day) so a simple row
// count gives distinct-months when the day column stores YYYY-MM-01.
func (r *TrialRewardsRepository) CountDistinctMonthsForKind(ctx context.Context, userID string, kind domain.SignalKind) (int, error) {
	count := 0
	for _, s := range r.signals {
		if s.UserID == userID && s.Kind == kind {
			count++
		}
	}
	return count, nil
}

// CountSignalsOfKind returns the total count of a signal kind for a user.
func (r *TrialRewardsRepository) CountSignalsOfKind(ctx context.Context, userID string, kind domain.SignalKind) (int, error) {
	total := 0
	for _, s := range r.signals {
		if s.UserID == userID && s.Kind == kind {
			total += s.Count
		}
	}
	return total, nil
}

// GetEarliestSignalAt returns the earliest occurrence timestamp for a kind.
func (r *TrialRewardsRepository) GetEarliestSignalAt(ctx context.Context, userID string, kind domain.SignalKind) (*time.Time, error) {
	var earliest *time.Time
	for i := range r.signals {
		s := &r.signals[i]
		if s.UserID != userID || s.Kind != kind {
			continue
		}
		if earliest == nil || s.FirstAt.Before(*earliest) {
			t := s.FirstAt
			earliest = &t
		}
	}
	return earliest, nil
}

// GetNthSignalAt returns the nth occurrence timestamp (0-indexed) for a kind.
func (r *TrialRewardsRepository) GetNthSignalAt(ctx context.Context, userID string, kind domain.SignalKind, n int) (*time.Time, error) {
	var matches []time.Time
	for _, s := range r.signals {
		if s.UserID == userID && s.Kind == kind {
			matches = append(matches, s.FirstAt)
		}
	}
	if n < 0 || n >= len(matches) {
		return nil, nil
	}
	// sort matches ascending
	for i := 1; i < len(matches); i++ {
		for j := i; j > 0 && matches[j-1].After(matches[j]); j-- {
			matches[j-1], matches[j] = matches[j], matches[j-1]
		}
	}
	return &matches[n], nil
}

// CountUserMutationsForForgeryCheck returns the test-controlled mutation count.
func (r *TrialRewardsRepository) CountUserMutationsForForgeryCheck(ctx context.Context, userID string) (int, error) {
	return r.Mutations[userID], nil
}

// UpsertProgress writes the user's denormalized progress, with COALESCE
// semantics for first-occurrence and tier-unlock timestamps.
func (r *TrialRewardsRepository) UpsertProgress(ctx context.Context, p *domain.TrialProgress) error {
	existing := r.progress[p.UserID]
	merged := *p
	if existing != nil {
		// COALESCE semantics: existing non-nil "first occurrence" timestamps win.
		coalesce := func(existingT, newT *time.Time) *time.Time {
			if existingT != nil {
				return existingT
			}
			return newT
		}
		merged.FirstReconciliationAt = coalesce(existing.FirstReconciliationAt, p.FirstReconciliationAt)
		merged.SecondReconciliationAt = coalesce(existing.SecondReconciliationAt, p.SecondReconciliationAt)
		merged.BudgetCycleAssignedAt = coalesce(existing.BudgetCycleAssignedAt, p.BudgetCycleAssignedAt)
		merged.OverspendCoveredAt = coalesce(existing.OverspendCoveredAt, p.OverspendCoveredAt)
		merged.GoalFundedAt = coalesce(existing.GoalFundedAt, p.GoalFundedAt)
		merged.RuleAppliedHistoricalAt = coalesce(existing.RuleAppliedHistoricalAt, p.RuleAppliedHistoricalAt)
		merged.MonthlyReviewAt = coalesce(existing.MonthlyReviewAt, p.MonthlyReviewAt)
		merged.Tier1UnlockedAt = coalesce(existing.Tier1UnlockedAt, p.Tier1UnlockedAt)
		merged.Tier2UnlockedAt = coalesce(existing.Tier2UnlockedAt, p.Tier2UnlockedAt)
		merged.Tier3UnlockedAt = coalesce(existing.Tier3UnlockedAt, p.Tier3UnlockedAt)
	}
	stored := merged
	r.progress[p.UserID] = &stored
	return nil
}

// GetProgress returns the user's progress row or nil if absent.
func (r *TrialRewardsRepository) GetProgress(ctx context.Context, userID string) (*domain.TrialProgress, error) {
	p, ok := r.progress[userID]
	if !ok {
		return nil, nil
	}
	out := *p
	return &out, nil
}

// CreateDiscountCode persists a new code, erroring on (user, tier) collision.
func (r *TrialRewardsRepository) CreateDiscountCode(ctx context.Context, c *domain.DiscountCode) error {
	for _, existing := range r.codes {
		if existing.UserID == c.UserID && existing.Tier == c.Tier {
			return errors.New("code already exists for user/tier")
		}
	}
	stored := *c
	r.codes[c.Code] = &stored
	return nil
}

// GetDiscountCodeByCode looks up a code by its string value.
func (r *TrialRewardsRepository) GetDiscountCodeByCode(ctx context.Context, code string) (*domain.DiscountCode, error) {
	c, ok := r.codes[code]
	if !ok {
		return nil, nil
	}
	out := *c
	return &out, nil
}

// GetDiscountCodeByUserTier returns the code for a (user, tier) pair, if any.
func (r *TrialRewardsRepository) GetDiscountCodeByUserTier(ctx context.Context, userID string, tier domain.RewardTier) (*domain.DiscountCode, error) {
	for _, c := range r.codes {
		if c.UserID == userID && c.Tier == tier {
			out := *c
			return &out, nil
		}
	}
	return nil, nil
}

// ListDiscountCodesByUser returns all codes earned by a user.
func (r *TrialRewardsRepository) ListDiscountCodesByUser(ctx context.Context, userID string) ([]domain.DiscountCode, error) {
	var out []domain.DiscountCode
	for _, c := range r.codes {
		if c.UserID == userID {
			out = append(out, *c)
		}
	}
	return out, nil
}

// MarkDiscountCodeRedeemed records a code as redeemed; idempotent.
func (r *TrialRewardsRepository) MarkDiscountCodeRedeemed(ctx context.Context, code string, redeemedAt time.Time, subID string) error {
	c, ok := r.codes[code]
	if !ok {
		return errors.New("code not found")
	}
	if c.RedeemedAt != nil {
		return nil
	}
	t := redeemedAt
	c.RedeemedAt = &t
	if subID != "" {
		s := subID
		c.RedeemedSubID = &s
	}
	return nil
}

// ExtendDiscountCodeValidity bumps a code's expiry timestamp.
func (r *TrialRewardsRepository) ExtendDiscountCodeValidity(ctx context.Context, code string, validUntil time.Time) error {
	c, ok := r.codes[code]
	if !ok {
		return errors.New("code not found")
	}
	c.ValidUntil = validUntil
	return nil
}

// DevReset wipes every trial-rewards record tied to the user from this
// in-memory store.
func (r *TrialRewardsRepository) DevReset(ctx context.Context, userID string) error {
	delete(r.progress, userID)
	for code, c := range r.codes {
		if c.UserID == userID {
			delete(r.codes, code)
		}
	}
	kept := r.signals[:0]
	for _, s := range r.signals {
		if s.UserID != userID {
			kept = append(kept, s)
		}
	}
	r.signals = kept
	return nil
}

// ListRates returns all exchange rates for a base currency in a specific month.
func (r *ExchangeRateRepository) ListRates(ctx context.Context, baseCurrency, month string) (map[string]float64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make(map[string]float64)
	prefix := baseCurrency + ":"
	suffix := ":" + month
	for key, rate := range r.rates {
		if len(key) > len(prefix)+len(suffix) {
			if key[:len(prefix)] == prefix && key[len(key)-len(suffix):] == suffix {
				// Extract target currency from key
				target := key[len(prefix) : len(key)-len(suffix)]
				result[target] = rate
			}
		}
	}
	return result, nil
}
