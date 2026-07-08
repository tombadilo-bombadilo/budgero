package repository

import (
	"context"
	"time"

	"budgero-server/internal/domain"
)

// SpaceRepository defines methods for space data persistence.
type SpaceRepository interface {
	// Create creates a new budget space.
	Create(ctx context.Context, space *domain.Space) error

	// GetOwner returns the owner user ID of a space.
	GetOwner(ctx context.Context, spaceID string) (string, error)

	// UpdateDisplayName updates a space's display name.
	UpdateDisplayName(ctx context.Context, spaceID, displayName string) error

	// Delete deletes a space.
	Delete(ctx context.Context, spaceID string) error

	// CountOccupiedCollaboratorSlotsByOwner counts accepted member seats and
	// pending invites across all workspaces owned by the specified owner.
	CountOccupiedCollaboratorSlotsByOwner(ctx context.Context, ownerUserID, excludeInviteID string) (int, error)

	// ListForUser returns all spaces a user belongs to.
	ListForUser(ctx context.Context, userID string) ([]domain.SpaceSummary, error)

	// GetMemberInvitationStatus gets a user's invitation status for a space.
	GetMemberInvitationStatus(ctx context.Context, spaceID, userID string) (string, error)

	// GetFirstAcceptedMembership returns the first accepted space membership for a user.
	GetFirstAcceptedMembership(ctx context.Context, userID string) (string, error)

	// Blob operations

	// CreateBlob creates blob metadata for a space.
	CreateBlob(ctx context.Context, spaceID, blobPath string) error

	// GetBlob retrieves blob metadata for a space.
	GetBlob(ctx context.Context, spaceID string) (*domain.SpaceBlob, error)

	// UpdateSyncState updates the sync state for a space.
	UpdateSyncState(ctx context.Context, spaceID, hash string, sizeBytes, mutationVersion int64) (int64, error)

	// UpdateSyncStateCAS updates the sync state only if the current version
	// matches expectedVersion; returns domain.ErrSyncVersionConflict otherwise.
	UpdateSyncStateCAS(ctx context.Context, spaceID, hash string, sizeBytes, mutationVersion, expectedVersion int64) (int64, error)

	// IncrementEncryptionKeyVersion increments the encryption key version for a space.
	IncrementEncryptionKeyVersion(ctx context.Context, spaceID string) (int64, error)

	// RaiseDataFormatVersion records the blob's client data-format version (never lowers it).
	RaiseDataFormatVersion(ctx context.Context, spaceID string, version int64) error

	// DeleteBlob deletes blob metadata for a space.
	DeleteBlob(ctx context.Context, spaceID string) error

	// ListBlobsByOwner lists all space blobs owned by a user.
	ListBlobsByOwner(ctx context.Context, ownerID string) ([]domain.SpaceBlob, error)

	// Member operations

	// CreateMember creates a space membership.
	CreateMember(ctx context.Context, member *domain.SpaceMember) error

	// ListMembers returns all members of a space.
	ListMembers(ctx context.Context, spaceID string) ([]domain.SpaceMember, error)

	// UpdateMemberEncryptedKey updates a member's encrypted space key.
	UpdateMemberEncryptedKey(ctx context.Context, spaceID, userID, encryptedKey string) error

	// DeleteMember removes a member from a space.
	DeleteMember(ctx context.Context, spaceID, userID string) error

	// DeleteAllMembershipsForUser deletes all memberships for a user.
	DeleteAllMembershipsForUser(ctx context.Context, userID string) error

	// DeleteAllMembershipsForSpace deletes all memberships for a space.
	DeleteAllMembershipsForSpace(ctx context.Context, spaceID string) error

	// Invite operations

	// CreateInvite creates a new space invite.
	CreateInvite(ctx context.Context, invite *domain.SpaceInvite) error

	// GetInviteBySecret retrieves an invite by its secret.
	GetInviteBySecret(ctx context.Context, secret string) (*domain.SpaceInvite, error)

	// UpdateInviteBundle updates the encrypted bundle for an invite.
	UpdateInviteBundle(ctx context.Context, inviteID, spaceID, bundle string) error

	// MarkInviteRedeemed marks an invite as redeemed.
	MarkInviteRedeemed(ctx context.Context, inviteID, redeemedBy string, redeemedAt time.Time) error

	// MarkInviteExpired marks an invite as expired.
	MarkInviteExpired(ctx context.Context, inviteID string) error

	// DeleteInvite deletes an invite.
	DeleteInvite(ctx context.Context, inviteID, spaceID string) error

	// DeleteAllInvitesForSpace deletes all invites for a space.
	DeleteAllInvitesForSpace(ctx context.Context, spaceID string) error

	// ListInvites lists all invites for a space.
	ListInvites(ctx context.Context, spaceID string) ([]domain.SpaceInvite, error)
}
