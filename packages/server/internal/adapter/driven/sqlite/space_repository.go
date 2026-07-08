package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
)

// SpaceRepository implements repository.SpaceRepository using SQLite.
type SpaceRepository struct {
	queries *sqlc.Queries
}

// NewSpaceRepository creates a new SpaceRepository.
func NewSpaceRepository(queries *sqlc.Queries) *SpaceRepository {
	return &SpaceRepository{queries: queries}
}

var _ repository.SpaceRepository = (*SpaceRepository)(nil)

// Create stores a new space in the database.
func (r *SpaceRepository) Create(ctx context.Context, space *domain.Space) error {
	_, err := r.queries.CreateSpace(ctx, sqlc.CreateSpaceParams{
		SpaceID:     space.SpaceID,
		OwnerUserID: space.OwnerUserID,
		DisplayName: space.DisplayName,
		CreatedAt:   space.CreatedAt,
	})
	return err
}

// GetOwner retrieves the owner user ID for the specified space.
func (r *SpaceRepository) GetOwner(ctx context.Context, spaceID string) (string, error) {
	ownerID, err := r.queries.GetSpaceOwner(ctx, spaceID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", domain.ErrSpaceNotFound
		}
		return "", err
	}
	return ownerID, nil
}

// UpdateDisplayName updates the display name for the specified space.
func (r *SpaceRepository) UpdateDisplayName(ctx context.Context, spaceID, displayName string) error {
	return r.queries.UpdateSpaceDisplayName(ctx, sqlc.UpdateSpaceDisplayNameParams{
		DisplayName: displayName,
		SpaceID:     spaceID,
	})
}

// Delete removes a space from the database.
func (r *SpaceRepository) Delete(ctx context.Context, spaceID string) error {
	return r.queries.DeleteSpace(ctx, spaceID)
}

// CountOccupiedCollaboratorSlotsByOwner counts accepted member seats and pending invites
// across all workspaces owned by the specified owner.
func (r *SpaceRepository) CountOccupiedCollaboratorSlotsByOwner(
	ctx context.Context,
	ownerUserID string,
	excludeInviteID string,
) (int, error) {
	count, err := r.queries.CountOccupiedCollaboratorSlotsByOwner(
		ctx,
		sqlc.CountOccupiedCollaboratorSlotsByOwnerParams{
			OwnerUserID:   ownerUserID,
			OwnerUserID_2: ownerUserID,
			Column3:       excludeInviteID,
			ID:            excludeInviteID,
		},
	)
	if err != nil {
		return 0, err
	}
	return int(count), nil
}

// ListForUser returns all spaces accessible by the specified user.
func (r *SpaceRepository) ListForUser(ctx context.Context, userID string) ([]domain.SpaceSummary, error) {
	rows, err := r.queries.ListSpacesForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to list spaces: %w", err)
	}

	spaces := make([]domain.SpaceSummary, 0, len(rows))
	for i := range rows {
		row := &rows[i]
		summary := domain.SpaceSummary{
			SpaceID:           row.SpaceID,
			DisplayName:       row.DisplayName,
			OwnerUserID:       row.OwnerUserID,
			Role:              row.Role,
			InvitationStatus:  row.InvitationStatus,
			EncryptedSpaceKey: row.EncryptedSpaceKey,
			CreatedAt:         row.CreatedAt,
		}
		if row.UpdatedAt.Valid {
			summary.UpdatedAt = &row.UpdatedAt.Time
		}
		spaces = append(spaces, summary)
	}
	return spaces, nil
}

// GetMemberInvitationStatus returns the invitation status for a user in a space.
func (r *SpaceRepository) GetMemberInvitationStatus(ctx context.Context, spaceID, userID string) (string, error) {
	status, err := r.queries.GetMemberInvitationStatus(ctx, sqlc.GetMemberInvitationStatusParams{
		SpaceID: spaceID,
		UserID:  userID,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", domain.ErrSpaceAccessDenied
		}
		return "", err
	}
	return status, nil
}

// GetFirstAcceptedMembership returns the first space ID where the user has accepted membership.
func (r *SpaceRepository) GetFirstAcceptedMembership(ctx context.Context, userID string) (string, error) {
	spaceID, err := r.queries.GetFirstAcceptedMembership(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", domain.ErrSpaceAccessDenied
		}
		return "", err
	}
	return spaceID, nil
}

// CreateBlob creates a new blob entry for a space.
func (r *SpaceRepository) CreateBlob(ctx context.Context, spaceID, _ string) error {
	blobPath := SpaceBlobPath(spaceID)
	return r.queries.CreateSpaceBlob(ctx, sqlc.CreateSpaceBlobParams{
		SpaceID:   spaceID,
		BlobPath:  blobPath,
		UpdatedAt: time.Now(),
	})
}

// GetBlob retrieves the blob information for a space.
func (r *SpaceRepository) GetBlob(ctx context.Context, spaceID string) (*domain.SpaceBlob, error) {
	blob, err := r.queries.GetSpaceBlob(ctx, spaceID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrSpaceNotFound
		}
		return nil, err
	}
	blob.BlobPath = r.reconcileBlobPath(ctx, &blob)
	return ToSpaceBlob(&blob), nil
}

// UpdateSyncState updates the sync state for a space blob.
func (r *SpaceRepository) UpdateSyncState(ctx context.Context, spaceID, hash string, sizeBytes, mutationVersion int64) (int64, error) {
	return r.queries.UpdateSpaceSyncState(ctx, sqlc.UpdateSpaceSyncStateParams{
		CurrentHash:     hash,
		SizeBytes:       sizeBytes,
		MutationVersion: mutationVersion,
		SpaceID:         spaceID,
	})
}

// UpdateSyncStateCAS advances the sync state only when the stored sync_version
// still equals expectedVersion, returning domain.ErrSyncVersionConflict when a
// concurrent upload won the race.
func (r *SpaceRepository) UpdateSyncStateCAS(ctx context.Context, spaceID, hash string, sizeBytes, mutationVersion, expectedVersion int64) (int64, error) {
	version, err := r.queries.UpdateSpaceSyncStateCAS(ctx, sqlc.UpdateSpaceSyncStateCASParams{
		CurrentHash:     hash,
		SizeBytes:       sizeBytes,
		MutationVersion: mutationVersion,
		SpaceID:         spaceID,
		SyncVersion:     expectedVersion,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, domain.ErrSyncVersionConflict
		}
		return 0, err
	}
	return version, nil
}

// IncrementEncryptionKeyVersion increments the encryption key version for a space blob.
func (r *SpaceRepository) IncrementEncryptionKeyVersion(ctx context.Context, spaceID string) (int64, error) {
	version, err := r.queries.IncrementEncryptionKeyVersion(ctx, spaceID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, domain.ErrSpaceNotFound
		}
		return 0, err
	}
	return version, nil
}

// RaiseDataFormatVersion records that the blob now holds (at least) the given
// data format. Never lowers the stored version.
func (r *SpaceRepository) RaiseDataFormatVersion(ctx context.Context, spaceID string, version int64) error {
	return r.queries.RaiseSpaceDataFormatVersion(ctx, sqlc.RaiseSpaceDataFormatVersionParams{
		MAX:     version,
		SpaceID: spaceID,
	})
}

// DeleteBlob removes the blob entry for a space.
func (r *SpaceRepository) DeleteBlob(ctx context.Context, spaceID string) error {
	return r.queries.DeleteSpaceBlob(ctx, spaceID)
}

// ListBlobsByOwner returns all blobs owned by the specified user.
func (r *SpaceRepository) ListBlobsByOwner(ctx context.Context, ownerID string) ([]domain.SpaceBlob, error) {
	rows, err := r.queries.ListSpaceBlobsByOwner(ctx, ownerID)
	if err != nil {
		return nil, err
	}

	blobs := make([]domain.SpaceBlob, 0, len(rows))
	for _, row := range rows {
		blob, err := r.queries.GetSpaceBlob(ctx, row.SpaceID)
		if err != nil {
			return nil, err
		}
		blobPath := r.reconcileBlobPath(ctx, &blob)
		blobs = append(blobs, domain.SpaceBlob{
			SpaceID:  row.SpaceID,
			BlobPath: blobPath,
		})
	}
	return blobs, nil
}

func (r *SpaceRepository) reconcileBlobPath(ctx context.Context, blob *sqlc.BudgetSpaceBlob) string {
	if blob == nil {
		return ""
	}
	canonicalPath := SpaceBlobPath(blob.SpaceID)
	if blob.BlobPath == canonicalPath {
		return canonicalPath
	}

	legacyExists := fileExists(blob.BlobPath)
	canonicalExists := fileExists(canonicalPath)

	if legacyExists && !canonicalExists {
		if err := moveFile(blob.BlobPath, canonicalPath); err != nil {
			return blob.BlobPath
		}
		canonicalExists = true
	}

	if canonicalExists || !legacyExists {
		if err := r.queries.UpdateSpaceBlobMetadata(ctx, sqlc.UpdateSpaceBlobMetadataParams{
			BlobPath:    canonicalPath,
			CurrentHash: blob.CurrentHash,
			SyncVersion: blob.SyncVersion,
			SizeBytes:   blob.SizeBytes,
			SpaceID:     blob.SpaceID,
		}); err == nil {
			return canonicalPath
		}
	}

	return blob.BlobPath
}

func fileExists(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func moveFile(src, dst string) error {
	if src == "" || src == dst {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o750); err != nil {
		return err
	}
	if err := os.Rename(src, dst); err == nil {
		return nil
	}

	source, err := os.Open(src) //nolint:gosec // source path is persisted server metadata
	if err != nil {
		return err
	}
	defer func() {
		_ = source.Close()
	}()

	info, err := source.Stat()
	if err != nil {
		return err
	}

	target, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode().Perm()) //nolint:gosec // destination path is canonical server path
	if err != nil {
		return err
	}
	if _, err := io.Copy(target, source); err != nil {
		_ = target.Close()
		return err
	}
	if err := target.Close(); err != nil {
		return err
	}

	return os.Remove(src)
}

// CreateMember adds a new member to a space.
func (r *SpaceRepository) CreateMember(ctx context.Context, member *domain.SpaceMember) error {
	return r.queries.CreateSpaceMember(ctx, sqlc.CreateSpaceMemberParams{
		SpaceID:           member.SpaceID,
		UserID:            member.UserID,
		Role:              member.Role,
		EncryptedSpaceKey: member.EncryptedSpaceKey,
		InvitationStatus:  member.InvitationStatus,
		InvitedAt:         member.InvitedAt,
		AcceptedAt:        ToNullTime(member.AcceptedAt),
	})
}

// ListMembers returns all members of a space.
func (r *SpaceRepository) ListMembers(ctx context.Context, spaceID string) ([]domain.SpaceMember, error) {
	rows, err := r.queries.ListSpaceMembers(ctx, spaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to list members: %w", err)
	}

	members := make([]domain.SpaceMember, 0, len(rows))
	for i := range rows {
		row := &rows[i]
		member := domain.SpaceMember{
			SpaceID:           row.SpaceID,
			UserID:            row.UserID,
			UserName:          row.UserName,
			UserEmail:         row.UserEmail,
			Role:              row.Role,
			EncryptedSpaceKey: row.EncryptedSpaceKey,
			InvitationStatus:  row.InvitationStatus,
			InvitedAt:         row.InvitedAt,
		}
		if row.AcceptedAt.Valid {
			member.AcceptedAt = &row.AcceptedAt.Time
		}
		members = append(members, member)
	}
	return members, nil
}

// UpdateMemberEncryptedKey updates the encrypted space key for a member.
func (r *SpaceRepository) UpdateMemberEncryptedKey(ctx context.Context, spaceID, userID, encryptedKey string) error {
	return r.queries.UpdateMemberEncryptedKey(ctx, sqlc.UpdateMemberEncryptedKeyParams{
		EncryptedSpaceKey: encryptedKey,
		SpaceID:           spaceID,
		UserID:            userID,
	})
}

// DeleteMember removes a member from a space.
func (r *SpaceRepository) DeleteMember(ctx context.Context, spaceID, userID string) error {
	return r.queries.DeleteSpaceMember(ctx, sqlc.DeleteSpaceMemberParams{
		SpaceID: spaceID,
		UserID:  userID,
	})
}

// DeleteAllMembershipsForUser removes all space memberships for a user.
func (r *SpaceRepository) DeleteAllMembershipsForUser(ctx context.Context, userID string) error {
	return r.queries.DeleteAllMembershipsForUser(ctx, userID)
}

// DeleteAllMembershipsForSpace removes all memberships for a space.
func (r *SpaceRepository) DeleteAllMembershipsForSpace(ctx context.Context, spaceID string) error {
	return r.queries.DeleteAllMembershipsForSpace(ctx, spaceID)
}

// CreateInvite creates a new space invitation.
func (r *SpaceRepository) CreateInvite(ctx context.Context, invite *domain.SpaceInvite) error {
	_, err := r.queries.CreateSpaceInvite(ctx, sqlc.CreateSpaceInviteParams{
		ID:            invite.ID,
		SpaceID:       invite.SpaceID,
		InviterUserID: invite.InviterUserID,
		InviteeEmail:  sql.NullString{String: invite.InviteeEmail, Valid: invite.InviteeEmail != ""},
		InviteSecret:  invite.InviteSecret,
		ExpiresAt:     ToNullTime(invite.ExpiresAt),
		CreatedAt:     invite.CreatedAt,
	})
	return err
}

// GetInviteBySecret retrieves an invitation by its secret token.
func (r *SpaceRepository) GetInviteBySecret(ctx context.Context, secret string) (*domain.SpaceInvite, error) {
	row, err := r.queries.GetSpaceInviteBySecret(ctx, secret)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrInviteNotFound
		}
		return nil, err
	}

	invite := &domain.SpaceInvite{
		ID:               row.ID,
		SpaceID:          row.SpaceID,
		SpaceDisplayName: row.DisplayName,
		InviterUserID:    row.InviterUserID,
		Status:           row.Status,
	}
	if row.EncryptedBundle.Valid {
		invite.EncryptedBundle = row.EncryptedBundle.String
	}
	if row.ExpiresAt.Valid {
		invite.ExpiresAt = &row.ExpiresAt.Time
	}

	return invite, nil
}

// UpdateInviteBundle updates the encrypted bundle for an invitation.
func (r *SpaceRepository) UpdateInviteBundle(ctx context.Context, inviteID, spaceID, bundle string) error {
	return r.queries.UpdateInviteBundle(ctx, sqlc.UpdateInviteBundleParams{
		EncryptedBundle: sql.NullString{String: bundle, Valid: true},
		ID:              inviteID,
		SpaceID:         spaceID,
	})
}

// MarkInviteRedeemed marks an invitation as redeemed by a user.
func (r *SpaceRepository) MarkInviteRedeemed(ctx context.Context, inviteID, redeemedBy string, redeemedAt time.Time) error {
	return r.queries.MarkInviteRedeemed(ctx, sqlc.MarkInviteRedeemedParams{
		RedeemedAt: sql.NullTime{Time: redeemedAt, Valid: true},
		RedeemedBy: sql.NullString{String: redeemedBy, Valid: true},
		ID:         inviteID,
	})
}

// MarkInviteExpired marks an invitation as expired.
func (r *SpaceRepository) MarkInviteExpired(ctx context.Context, inviteID string) error {
	return r.queries.MarkInviteExpired(ctx, inviteID)
}

// DeleteInvite removes an invitation from the database.
func (r *SpaceRepository) DeleteInvite(ctx context.Context, inviteID, spaceID string) error {
	return r.queries.DeleteSpaceInvite(ctx, sqlc.DeleteSpaceInviteParams{
		ID:      inviteID,
		SpaceID: spaceID,
	})
}

// DeleteAllInvitesForSpace removes all invitations for the specified space.
func (r *SpaceRepository) DeleteAllInvitesForSpace(ctx context.Context, spaceID string) error {
	return r.queries.DeleteAllInvitesForSpace(ctx, spaceID)
}

// ListInvites returns all invitations for a space.
func (r *SpaceRepository) ListInvites(ctx context.Context, spaceID string) ([]domain.SpaceInvite, error) {
	rows, err := r.queries.ListSpaceInvites(ctx, spaceID)
	if err != nil {
		return nil, err
	}

	invites := make([]domain.SpaceInvite, 0, len(rows))
	for i := range rows {
		invites = append(invites, *ToSpaceInvite(&rows[i]))
	}
	return invites, nil
}
