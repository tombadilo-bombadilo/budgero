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

	"github.com/google/uuid"
)

// SpaceService implements driving.SpaceService.
type SpaceService struct {
	spaceRepo repository.SpaceRepository
	userRepo  repository.UserRepository
	cfg       *config.Config
}

// NewSpaceService creates a new SpaceService.
func NewSpaceService(spaceRepo repository.SpaceRepository, extras ...interface{}) *SpaceService {
	svc := &SpaceService{spaceRepo: spaceRepo}
	for _, extra := range extras {
		switch value := extra.(type) {
		case repository.UserRepository:
			svc.userRepo = value
		case *config.Config:
			svc.cfg = value
		}
	}
	return svc
}

var _ driving.SpaceService = (*SpaceService)(nil)

// Create creates a new space with the given display name and assigns the user as owner.
func (s *SpaceService) Create(ctx context.Context, userID, displayName string) (*domain.SpaceSummary, error) {
	trimmedName := strings.TrimSpace(displayName)
	if trimmedName == "" {
		trimmedName = "Shared Budget"
	}

	spaceID := uuid.NewString()
	now := time.Now()

	space := &domain.Space{
		SpaceID:     spaceID,
		OwnerUserID: userID,
		DisplayName: trimmedName,
		CreatedAt:   now,
	}
	if err := s.spaceRepo.Create(ctx, space); err != nil {
		return nil, err
	}

	member := &domain.SpaceMember{
		SpaceID:           spaceID,
		UserID:            userID,
		Role:              "owner",
		EncryptedSpaceKey: "",
		InvitationStatus:  "accepted",
		InvitedAt:         now,
		AcceptedAt:        &now,
	}
	if err := s.spaceRepo.CreateMember(ctx, member); err != nil {
		return nil, err
	}

	if err := s.spaceRepo.CreateBlob(ctx, spaceID, ""); err != nil {
		return nil, err
	}

	return &domain.SpaceSummary{
		SpaceID:          spaceID,
		DisplayName:      trimmedName,
		OwnerUserID:      userID,
		Role:             "owner",
		InvitationStatus: "accepted",
		CreatedAt:        now,
	}, nil
}

// ListForUser returns all spaces the user is a member of.
func (s *SpaceService) ListForUser(ctx context.Context, userID string) ([]domain.SpaceSummary, error) {
	spaces, err := s.spaceRepo.ListForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	s.annotateSpaceAccess(ctx, spaces)
	return spaces, nil
}

// ListMembers returns all members of a space after verifying the requestor has access.
func (s *SpaceService) ListMembers(ctx context.Context, requestorID, spaceID string) ([]domain.SpaceMember, error) {
	// Verify access
	resolvedID, err := s.ResolveSpaceID(ctx, requestorID, spaceID)
	if err != nil {
		return nil, err
	}

	return s.spaceRepo.ListMembers(ctx, resolvedID)
}

// UpdateDisplayName updates the display name of a space (owner only).
func (s *SpaceService) UpdateDisplayName(ctx context.Context, actorID, spaceID, displayName string) error {
	trimmed := strings.TrimSpace(displayName)
	if trimmed == "" {
		return fmt.Errorf("display name cannot be empty")
	}

	resolvedID, err := s.ResolveSpaceID(ctx, actorID, spaceID)
	if err != nil {
		return err
	}

	owner, err := s.IsOwner(ctx, actorID, resolvedID)
	if err != nil {
		return err
	}
	if !owner {
		return domain.ErrSpaceAccessDenied
	}

	return s.spaceRepo.UpdateDisplayName(ctx, resolvedID, trimmed)
}

// Delete permanently deletes a space and its associated sharing/blob data.
func (s *SpaceService) Delete(ctx context.Context, actorID, spaceID string) error {
	resolvedID, err := s.ResolveSpaceID(ctx, actorID, spaceID)
	if err != nil {
		return err
	}

	owner, err := s.IsOwner(ctx, actorID, resolvedID)
	if err != nil {
		return err
	}
	if !owner {
		return domain.ErrSpaceAccessDenied
	}

	var blobPath string
	if blob, err := s.spaceRepo.GetBlob(ctx, resolvedID); err == nil && blob != nil {
		blobPath = blob.BlobPath
	}

	if err := s.spaceRepo.DeleteAllInvitesForSpace(ctx, resolvedID); err != nil {
		return fmt.Errorf("%w: %w", domain.ErrSpaceDeleteFailed, err)
	}
	if err := s.spaceRepo.DeleteAllMembershipsForSpace(ctx, resolvedID); err != nil {
		return fmt.Errorf("%w: %w", domain.ErrSpaceDeleteFailed, err)
	}
	if err := s.spaceRepo.DeleteBlob(ctx, resolvedID); err != nil {
		return fmt.Errorf("%w: %w", domain.ErrSpaceDeleteFailed, err)
	}
	if err := s.spaceRepo.Delete(ctx, resolvedID); err != nil {
		return fmt.Errorf("%w: %w", domain.ErrSpaceDeleteFailed, err)
	}
	if s.userRepo != nil {
		if err := s.userRepo.ClearDanglingPrimarySpaceIDs(ctx); err != nil {
			return fmt.Errorf("%w: %w", domain.ErrSpaceDeleteFailed, err)
		}
	}
	if blobPath != "" {
		if err := os.Remove(blobPath); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("%w: %w", domain.ErrSpaceDeleteFailed, err)
		}
	}

	return nil
}

// RemoveMember removes a member from a space or allows a member to leave.
func (s *SpaceService) RemoveMember(ctx context.Context, actorID, spaceID, memberID string) error {
	resolvedID, err := s.ResolveSpaceID(ctx, actorID, spaceID)
	if err != nil {
		return err
	}

	// Check permissions
	if actorID != memberID {
		actorIsOwner, err := s.IsOwner(ctx, actorID, resolvedID)
		if err != nil {
			return err
		}
		if !actorIsOwner {
			return domain.ErrSpaceAccessDenied
		}

		// Can't remove owner
		memberIsOwner, err := s.IsOwner(ctx, memberID, resolvedID)
		if err != nil {
			return err
		}
		if memberIsOwner {
			return fmt.Errorf("cannot remove space owner")
		}
	} else {
		// Can't leave if you're the owner
		actorIsOwner, err := s.IsOwner(ctx, actorID, resolvedID)
		if err != nil {
			return err
		}
		if actorIsOwner {
			return fmt.Errorf("owners must transfer ownership before leaving")
		}
	}

	return s.spaceRepo.DeleteMember(ctx, resolvedID, memberID)
}

// ResolveSpaceID resolves and validates a space ID for the user, returning their first accepted space if empty.
func (s *SpaceService) ResolveSpaceID(ctx context.Context, userID, requestedSpaceID string) (string, error) {
	requested := strings.TrimSpace(requestedSpaceID)

	if requested != "" {
		status, err := s.spaceRepo.GetMemberInvitationStatus(ctx, requested, userID)
		if err != nil {
			return "", domain.ErrSpaceAccessDenied
		}
		if !strings.EqualFold(status, "accepted") {
			return "", domain.ErrSpaceAccessDenied
		}
		return requested, nil
	}

	spaces, err := s.ListForUser(ctx, userID)
	if err != nil {
		return "", domain.ErrSpaceAccessDenied
	}

	for i := range spaces {
		space := spaces[i]
		if !strings.EqualFold(space.InvitationStatus, domain.InvitationAccepted) || !space.IsAccessible {
			continue
		}
		if strings.EqualFold(space.Role, domain.RoleOwner) {
			return space.SpaceID, nil
		}
	}

	for i := range spaces {
		space := spaces[i]
		if strings.EqualFold(space.InvitationStatus, domain.InvitationAccepted) && space.IsAccessible {
			return space.SpaceID, nil
		}
	}

	return "", domain.ErrSpaceAccessDenied
}

// UpdateMemberEncryptedKey updates the encrypted space key for a member.
func (s *SpaceService) UpdateMemberEncryptedKey(ctx context.Context, userID, spaceID, encryptedKey string) error {
	resolvedID, err := s.ResolveSpaceID(ctx, userID, spaceID)
	if err != nil {
		return err
	}

	return s.spaceRepo.UpdateMemberEncryptedKey(ctx, resolvedID, userID, encryptedKey)
}

// IsOwner checks if the user is the owner of the space.
func (s *SpaceService) IsOwner(ctx context.Context, userID, spaceID string) (bool, error) {
	ownerID, err := s.spaceRepo.GetOwner(ctx, spaceID)
	if err != nil {
		return false, err
	}
	return ownerID == userID, nil
}

// GetBlobMetadata returns the blob metadata for a space.
func (s *SpaceService) GetBlobMetadata(ctx context.Context, userID, spaceID string) (*domain.SpaceBlob, error) {
	resolvedID, err := s.ResolveSpaceID(ctx, userID, spaceID)
	if err != nil {
		return nil, err
	}

	return s.spaceRepo.GetBlob(ctx, resolvedID)
}

// RaiseDataFormatVersion records the blob's client data-format version (never lowers it).
func (s *SpaceService) RaiseDataFormatVersion(
	ctx context.Context,
	userID, spaceID string,
	version int64,
) error {
	resolvedID, err := s.ResolveSpaceID(ctx, userID, spaceID)
	if err != nil {
		return err
	}
	return s.spaceRepo.RaiseDataFormatVersion(ctx, resolvedID, version)
}

// GetSyncState returns the current sync state for a space.
func (s *SpaceService) GetSyncState(ctx context.Context, userID, spaceID string) (*domain.SyncState, error) {
	resolvedID, err := s.ResolveSpaceID(ctx, userID, spaceID)
	if err != nil {
		return nil, err
	}

	blob, err := s.spaceRepo.GetBlob(ctx, resolvedID)
	if err != nil {
		return nil, err
	}

	return &domain.SyncState{
		SpaceID:              resolvedID,
		Version:              blob.SyncVersion,
		Hash:                 blob.CurrentHash,
		EncryptionKeyVersion: blob.EncryptionKeyVersion,
	}, nil
}

// GetDatabaseHash returns the current database hash for a space.
func (s *SpaceService) GetDatabaseHash(ctx context.Context, userID, spaceID string) (string, error) {
	resolvedID, err := s.ResolveSpaceID(ctx, userID, spaceID)
	if err != nil {
		return "", err
	}

	blob, err := s.spaceRepo.GetBlob(ctx, resolvedID)
	if err != nil {
		return "", err
	}

	return blob.CurrentHash, nil
}

// UpdateSyncState updates the sync state with a new hash and size, returning the new version.
func (s *SpaceService) UpdateSyncState(ctx context.Context, userID, spaceID, hash string, sizeBytes, mutationVersion int64) (int64, error) {
	resolvedID, err := s.ResolveSpaceID(ctx, userID, spaceID)
	if err != nil {
		return 0, err
	}

	return s.spaceRepo.UpdateSyncState(ctx, resolvedID, hash, sizeBytes, mutationVersion)
}

// UpdateSyncStateCAS advances the sync state only if the server's current
// version still equals expectedVersion (compare-and-swap), so concurrent
// uploads against the same base version cannot silently overwrite each other.
// Returns domain.ErrSyncVersionConflict when the version moved.
func (s *SpaceService) UpdateSyncStateCAS(ctx context.Context, userID, spaceID, hash string, sizeBytes, mutationVersion, expectedVersion int64) (int64, error) {
	resolvedID, err := s.ResolveSpaceID(ctx, userID, spaceID)
	if err != nil {
		return 0, err
	}

	return s.spaceRepo.UpdateSyncStateCAS(ctx, resolvedID, hash, sizeBytes, mutationVersion, expectedVersion)
}

// IncrementEncryptionKeyVersion increments the encryption key version for a space.
// This should be called when a user changes their master password.
func (s *SpaceService) IncrementEncryptionKeyVersion(ctx context.Context, userID, spaceID string) (int64, error) {
	resolvedID, err := s.ResolveSpaceID(ctx, userID, spaceID)
	if err != nil {
		return 0, err
	}

	return s.spaceRepo.IncrementEncryptionKeyVersion(ctx, resolvedID)
}

// CreateInvite creates a new invitation for a user to join a space.
// The inviteSecretHash is provided by the client (client generates secret, hashes it, sends hash).
func (s *SpaceService) CreateInvite(ctx context.Context, spaceID, inviterID, inviteeEmail, inviteSecretHash string, expiresAt time.Time) (*domain.SpaceInvite, error) {
	if err := s.ensureCollaboratorSlotAvailable(ctx, spaceID, ""); err != nil {
		return nil, err
	}

	inviteID := uuid.NewString()

	invite := &domain.SpaceInvite{
		ID:            inviteID,
		SpaceID:       spaceID,
		InviterUserID: inviterID,
		InviteeEmail:  inviteeEmail,
		InviteSecret:  inviteSecretHash,
		Status:        "pending",
		ExpiresAt:     &expiresAt,
		CreatedAt:     time.Now(),
	}
	if err := s.spaceRepo.CreateInvite(ctx, invite); err != nil {
		return nil, err
	}

	return invite, nil
}

// GetInviteBySecret retrieves an invitation by its secret token.
func (s *SpaceService) GetInviteBySecret(ctx context.Context, secret string) (*domain.SpaceInvite, error) {
	return s.spaceRepo.GetInviteBySecret(ctx, secret)
}

// UpdateInviteBundle updates the encrypted bundle for an invitation.
func (s *SpaceService) UpdateInviteBundle(ctx context.Context, inviteID, spaceID, bundle string) error {
	return s.spaceRepo.UpdateInviteBundle(ctx, inviteID, spaceID, bundle)
}

// RedeemInvite redeems an invitation, adding the user as a member of the space.
func (s *SpaceService) RedeemInvite(ctx context.Context, invite *domain.SpaceInvite, userID, encryptedSpaceKey string) error {
	// Check if invite can be redeemed (not expired, not already used)
	if err := invite.CanBeRedeemed(); err != nil {
		if invite.IsExpired() {
			_ = s.spaceRepo.MarkInviteExpired(ctx, invite.ID)
		}
		return err
	}

	// Check for encrypted bundle
	if invite.EncryptedBundle == "" {
		return domain.ErrInviteMissingBundle
	}

	if err := s.ensureCollaboratorSlotAvailable(ctx, invite.SpaceID, invite.ID); err != nil {
		return err
	}

	now := time.Now()

	// Create membership
	member := &domain.SpaceMember{
		SpaceID:           invite.SpaceID,
		UserID:            userID,
		Role:              "member",
		EncryptedSpaceKey: encryptedSpaceKey,
		InvitationStatus:  "accepted",
		InvitedAt:         now,
		AcceptedAt:        &now,
	}
	if err := s.spaceRepo.CreateMember(ctx, member); err != nil {
		return err
	}

	// Mark invite as redeemed
	return s.spaceRepo.MarkInviteRedeemed(ctx, invite.ID, userID, now)
}

// DeleteInvite deletes an invitation from a space.
func (s *SpaceService) DeleteInvite(ctx context.Context, inviteID, spaceID string) error {
	return s.spaceRepo.DeleteInvite(ctx, inviteID, spaceID)
}

// ListInvites returns all invitations for a space.
func (s *SpaceService) ListInvites(ctx context.Context, spaceID string) ([]domain.SpaceInvite, error) {
	return s.spaceRepo.ListInvites(ctx, spaceID)
}

func (s *SpaceService) annotateSpaceAccess(ctx context.Context, spaces []domain.SpaceSummary) {
	if s.userRepo == nil {
		for i := range spaces {
			spaces[i].IsAccessible = strings.EqualFold(spaces[i].InvitationStatus, domain.InvitationAccepted)
			if spaces[i].IsAccessible {
				spaces[i].AccessReason = domain.SpaceAccessReasonActive
			}
		}
		return
	}

	ownerCache := make(map[string]*domain.User, len(spaces))

	for i := range spaces {
		space := &spaces[i]
		space.IsAccessible = false
		space.AccessReason = ""

		if !strings.EqualFold(space.InvitationStatus, domain.InvitationAccepted) {
			continue
		}

		space.IsAccessible = true
		space.AccessReason = domain.SpaceAccessReasonActive

		owner, ok := ownerCache[space.OwnerUserID]
		if !ok {
			user, err := s.userRepo.GetByID(ctx, space.OwnerUserID)
			if err != nil {
				space.IsAccessible = false
				if strings.EqualFold(space.Role, domain.RoleOwner) {
					space.AccessReason = domain.SpaceAccessReasonOwnedSubscriptionRequired
				} else {
					space.AccessReason = domain.SpaceAccessReasonSharedOwnerInactive
				}
				continue
			}
			owner = user
			ownerCache[space.OwnerUserID] = user
		}

		if s.ownerHasWorkspaceAccess(owner) {
			continue
		}

		space.IsAccessible = false
		if strings.EqualFold(space.Role, domain.RoleOwner) {
			space.AccessReason = domain.SpaceAccessReasonOwnedSubscriptionRequired
			continue
		}
		space.AccessReason = domain.SpaceAccessReasonSharedOwnerInactive
	}
}

func (s *SpaceService) ownerHasWorkspaceAccess(user *domain.User) bool {
	if s.cfg != nil && s.cfg.Auth.SelfHostable {
		return true
	}
	return user != nil && user.HasOwnerWorkspaceSubscription()
}

func (s *SpaceService) ensureCollaboratorSlotAvailable(
	ctx context.Context,
	spaceID string,
	excludeInviteID string,
) error {
	ownerUserID, err := s.spaceRepo.GetOwner(ctx, spaceID)
	if err != nil {
		return err
	}
	occupied, err := s.spaceRepo.CountOccupiedCollaboratorSlotsByOwner(ctx, ownerUserID, excludeInviteID)
	if err != nil {
		return err
	}
	if occupied >= domain.MaxOwnedCollaboratorSeats {
		return domain.ErrSpaceMemberLimitReached
	}
	return nil
}
