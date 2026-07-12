package sqlite_test

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/sqlite"
	sqlite_sqlc "budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/domain"
	"budgero-server/internal/testkit"
)

// Adapter integration tests: Real database

func TestSpaceRepository_Create(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	// Seed owner user
	userID := testkit.SeedUser(t, queries, "owner@example.com")

	space := &domain.Space{
		SpaceID:     testkit.GenerateID(),
		OwnerUserID: userID,
		DisplayName: "Test Space",
		CreatedAt:   time.Now(),
	}

	err := repo.Create(ctx, space)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	// Verify by getting owner
	ownerID, err := repo.GetOwner(ctx, space.SpaceID)
	if err != nil {
		t.Fatalf("GetOwner() error = %v", err)
	}
	if ownerID != userID {
		t.Errorf("GetOwner() = %v, want %v", ownerID, userID)
	}
}

func TestSpaceRepository_GetOwner(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	ownerID, err := repo.GetOwner(ctx, spaceID)
	if err != nil {
		t.Fatalf("GetOwner() error = %v", err)
	}
	if ownerID != userID {
		t.Errorf("GetOwner() = %v, want %v", ownerID, userID)
	}
}

func TestSpaceRepository_GetOwner_NotFound(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	_, err := repo.GetOwner(ctx, "nonexistent")
	if !errors.Is(err, domain.ErrSpaceNotFound) {
		t.Errorf("GetOwner() error = %v, want ErrSpaceNotFound", err)
	}
}

func TestSpaceRepository_UpdateDisplayName(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Original Name")

	newName := "Updated Name"
	err := repo.UpdateDisplayName(ctx, spaceID, newName)
	if err != nil {
		t.Fatalf("UpdateDisplayName() error = %v", err)
	}

	// Verify by listing
	spaces, err := repo.ListForUser(ctx, userID)
	if err != nil {
		t.Fatalf("ListForUser() error = %v", err)
	}
	if len(spaces) != 1 {
		t.Fatalf("ListForUser() returned %d spaces, want 1", len(spaces))
	}
	if spaces[0].DisplayName != newName {
		t.Errorf("DisplayName = %v, want %v", spaces[0].DisplayName, newName)
	}
}

func TestSpaceRepository_Delete(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "To Delete")

	err := repo.Delete(ctx, spaceID)
	if err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	// Verify deleted
	_, err = repo.GetOwner(ctx, spaceID)
	if !errors.Is(err, domain.ErrSpaceNotFound) {
		t.Errorf("GetOwner() after delete: error = %v, want ErrSpaceNotFound", err)
	}
}

func TestSpaceRepository_ListForUser(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "owner@example.com")

	// Initially empty
	spaces, err := repo.ListForUser(ctx, userID)
	if err != nil {
		t.Fatalf("ListForUser() error = %v", err)
	}
	if len(spaces) != 0 {
		t.Errorf("ListForUser() returned %d spaces, want 0", len(spaces))
	}

	// Create spaces
	testkit.SeedSpace(t, sqlDB, queries, userID, "Space 1")
	testkit.SeedSpace(t, sqlDB, queries, userID, "Space 2")

	spaces, err = repo.ListForUser(ctx, userID)
	if err != nil {
		t.Fatalf("ListForUser() error = %v", err)
	}
	if len(spaces) != 2 {
		t.Errorf("ListForUser() returned %d spaces, want 2", len(spaces))
	}
}

func TestSpaceRepository_GetMemberInvitationStatus(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	status, err := repo.GetMemberInvitationStatus(ctx, spaceID, userID)
	if err != nil {
		t.Fatalf("GetMemberInvitationStatus() error = %v", err)
	}
	if status != "accepted" {
		t.Errorf("GetMemberInvitationStatus() = %v, want accepted", status)
	}
}

func TestSpaceRepository_GetMemberInvitationStatus_NotMember(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	ownerID := testkit.SeedUser(t, queries, "owner@example.com")
	otherID := testkit.SeedUser(t, queries, "other@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Test Space")

	_, err := repo.GetMemberInvitationStatus(ctx, spaceID, otherID)
	if !errors.Is(err, domain.ErrSpaceAccessDenied) {
		t.Errorf("GetMemberInvitationStatus() error = %v, want ErrSpaceAccessDenied", err)
	}
}

func TestSpaceRepository_GetFirstAcceptedMembership(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	foundSpaceID, err := repo.GetFirstAcceptedMembership(ctx, userID)
	if err != nil {
		t.Fatalf("GetFirstAcceptedMembership() error = %v", err)
	}
	if foundSpaceID != spaceID {
		t.Errorf("GetFirstAcceptedMembership() = %v, want %v", foundSpaceID, spaceID)
	}
}

func TestSpaceRepository_GetFirstAcceptedMembership_NoMemberships(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "lonely@example.com")

	_, err := repo.GetFirstAcceptedMembership(ctx, userID)
	if !errors.Is(err, domain.ErrSpaceAccessDenied) {
		t.Errorf("GetFirstAcceptedMembership() error = %v, want ErrSpaceAccessDenied", err)
	}
}

// Blob tests
func TestSpaceRepository_CreateBlob(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "owner@example.com")

	// Create space without blob (manually)
	spaceID := testkit.GenerateID()
	space := &domain.Space{
		SpaceID:     spaceID,
		OwnerUserID: userID,
		DisplayName: "Test Space",
		CreatedAt:   time.Now(),
	}
	_ = repo.Create(ctx, space)

	// Create blob
	err := repo.CreateBlob(ctx, spaceID, "/tmp/test_blob.db")
	if err != nil {
		t.Fatalf("CreateBlob() error = %v", err)
	}

	// Verify
	blob, err := repo.GetBlob(ctx, spaceID)
	if err != nil {
		t.Fatalf("GetBlob() error = %v", err)
	}
	wantPath := sqlite.SpaceBlobPath(spaceID)
	if blob.BlobPath != wantPath {
		t.Errorf("BlobPath = %v, want %v", blob.BlobPath, wantPath)
	}
}

func TestSpaceRepository_GetBlob(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	blob, err := repo.GetBlob(ctx, spaceID)
	if err != nil {
		t.Fatalf("GetBlob() error = %v", err)
	}
	if blob.SpaceID != spaceID {
		t.Errorf("SpaceID = %v, want %v", blob.SpaceID, spaceID)
	}
}

func TestSpaceRepository_GetBlob_CanonicalizesLegacyPathWhenFileMissing(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	legacyPath := filepath.Join("data", "budget_spaces", "space_"+spaceID+".db")
	if err := queries.UpdateSpaceBlobMetadata(ctx, sqlite_sqlc.UpdateSpaceBlobMetadataParams{
		BlobPath:    legacyPath,
		CurrentHash: "",
		SyncVersion: 0,
		SizeBytes:   0,
		SpaceID:     spaceID,
	}); err != nil {
		t.Fatalf("UpdateSpaceBlobMetadata() error = %v", err)
	}

	blob, err := repo.GetBlob(ctx, spaceID)
	if err != nil {
		t.Fatalf("GetBlob() error = %v", err)
	}

	wantPath := sqlite.SpaceBlobPath(spaceID)
	if blob.BlobPath != wantPath {
		t.Errorf("BlobPath = %v, want %v", blob.BlobPath, wantPath)
	}
}

func TestSpaceRepository_GetBlob_MigratesLegacyFileToCanonicalPath(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	legacyDir := t.TempDir()
	legacyPath := filepath.Join(legacyDir, "legacy_blob.db")
	legacyContents := []byte("legacy-payload")
	if err := os.WriteFile(legacyPath, legacyContents, 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	if err := queries.UpdateSpaceBlobMetadata(ctx, sqlite_sqlc.UpdateSpaceBlobMetadataParams{
		BlobPath:    legacyPath,
		CurrentHash: "hash",
		SyncVersion: 3,
		SizeBytes:   int64(len(legacyContents)),
		SpaceID:     spaceID,
	}); err != nil {
		t.Fatalf("UpdateSpaceBlobMetadata() error = %v", err)
	}

	blob, err := repo.GetBlob(ctx, spaceID)
	if err != nil {
		t.Fatalf("GetBlob() error = %v", err)
	}

	wantPath := sqlite.SpaceBlobPath(spaceID)
	if blob.BlobPath != wantPath {
		t.Errorf("BlobPath = %v, want %v", blob.BlobPath, wantPath)
	}

	migrated, err := os.ReadFile(wantPath) //nolint:gosec // wantPath is generated via sqlite.SpaceBlobPath
	if err != nil {
		t.Fatalf("ReadFile() migrated path error = %v", err)
	}
	if !bytes.Equal(migrated, legacyContents) {
		t.Errorf("migrated file contents = %q, want %q", migrated, legacyContents)
	}
	if _, err := os.Stat(legacyPath); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("legacy file still exists or unexpected stat error: %v", err)
	}
}

func TestSpaceRepository_GetBlob_NotFound(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	_, err := repo.GetBlob(ctx, "nonexistent")
	if !errors.Is(err, domain.ErrSpaceNotFound) {
		t.Errorf("GetBlob() error = %v, want ErrSpaceNotFound", err)
	}
}

func TestSpaceRepository_UpdateSyncState(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	hash := "abc123hash"
	sizeBytes := int64(1024)

	newVersion, err := repo.UpdateSyncState(ctx, spaceID, hash, sizeBytes, 42)
	if err != nil {
		t.Fatalf("UpdateSyncState() error = %v", err)
	}
	if newVersion < 1 {
		t.Errorf("UpdateSyncState() version = %v, want >= 1", newVersion)
	}

	// Verify
	blob, _ := repo.GetBlob(ctx, spaceID)
	if blob.CurrentHash != hash {
		t.Errorf("CurrentHash = %v, want %v", blob.CurrentHash, hash)
	}
	if blob.SizeBytes != sizeBytes {
		t.Errorf("SizeBytes = %v, want %v", blob.SizeBytes, sizeBytes)
	}
	if blob.MutationVersion != 42 {
		t.Errorf("MutationVersion = %v, want 42", blob.MutationVersion)
	}
}

func TestSpaceRepository_DeleteBlob(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	err := repo.DeleteBlob(ctx, spaceID)
	if err != nil {
		t.Fatalf("DeleteBlob() error = %v", err)
	}

	// Verify deleted
	_, err = repo.GetBlob(ctx, spaceID)
	if !errors.Is(err, domain.ErrSpaceNotFound) {
		t.Errorf("GetBlob() after delete: error = %v, want ErrSpaceNotFound", err)
	}
}

func TestSpaceRepository_ListBlobsByOwner(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "owner@example.com")
	testkit.SeedSpace(t, sqlDB, queries, userID, "Space 1")
	testkit.SeedSpace(t, sqlDB, queries, userID, "Space 2")

	blobs, err := repo.ListBlobsByOwner(ctx, userID)
	if err != nil {
		t.Fatalf("ListBlobsByOwner() error = %v", err)
	}
	if len(blobs) != 2 {
		t.Errorf("ListBlobsByOwner() returned %d blobs, want 2", len(blobs))
	}
}

// Member tests
func TestSpaceRepository_CreateMember(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	ownerID := testkit.SeedUser(t, queries, "owner@example.com")
	memberID := testkit.SeedUser(t, queries, "member@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Test Space")

	now := time.Now()
	member := &domain.SpaceMember{
		SpaceID:           spaceID,
		UserID:            memberID,
		Role:              "member",
		EncryptedSpaceKey: "encrypted_key",
		InvitationStatus:  "accepted",
		InvitedAt:         now,
		AcceptedAt:        &now,
	}

	err := repo.CreateMember(ctx, member)
	if err != nil {
		t.Fatalf("CreateMember() error = %v", err)
	}

	// Verify
	members, _ := repo.ListMembers(ctx, spaceID)
	if len(members) != 2 { // owner + new member
		t.Errorf("ListMembers() returned %d members, want 2", len(members))
	}
}

func TestSpaceRepository_ListMembers(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	ownerID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Test Space")

	members, err := repo.ListMembers(ctx, spaceID)
	if err != nil {
		t.Fatalf("ListMembers() error = %v", err)
	}
	if len(members) != 1 {
		t.Errorf("ListMembers() returned %d members, want 1 (owner)", len(members))
	}
	if members[0].Role != "owner" {
		t.Errorf("Member role = %v, want owner", members[0].Role)
	}
}

func TestSpaceRepository_UpdateMemberEncryptedKey(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	ownerID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Test Space")

	newKey := "new_encrypted_key"
	err := repo.UpdateMemberEncryptedKey(ctx, spaceID, ownerID, newKey)
	if err != nil {
		t.Fatalf("UpdateMemberEncryptedKey() error = %v", err)
	}

	// Verify
	members, _ := repo.ListMembers(ctx, spaceID)
	if members[0].EncryptedSpaceKey != newKey {
		t.Errorf("EncryptedSpaceKey = %v, want %v", members[0].EncryptedSpaceKey, newKey)
	}
}

func TestSpaceRepository_UpdateMemberEncryptedKeysAtomic(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	ownerID := testkit.SeedUser(t, queries, "owner-batch@example.com")
	spaceOne := testkit.SeedSpace(t, sqlDB, queries, ownerID, "One")
	spaceTwo := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Two")

	if err := repo.UpdateMemberEncryptedKeys(ctx, ownerID, map[string]string{
		spaceOne: "new-one",
		spaceTwo: "new-two",
	}); err != nil {
		t.Fatalf("UpdateMemberEncryptedKeys() error = %v", err)
	}
	for spaceID, want := range map[string]string{spaceOne: "new-one", spaceTwo: "new-two"} {
		members, _ := repo.ListMembers(ctx, spaceID)
		if members[0].EncryptedSpaceKey != want {
			t.Fatalf("space %s key = %q, want %q", spaceID, members[0].EncryptedSpaceKey, want)
		}
	}

	if err := repo.UpdateMemberEncryptedKeys(ctx, ownerID, map[string]string{
		spaceOne:  "must-not-land",
		"missing": "missing-key",
	}); !errors.Is(err, domain.ErrSpaceAccessDenied) {
		t.Fatalf("partial batch error = %v, want access denied", err)
	}
	members, _ := repo.ListMembers(ctx, spaceOne)
	if members[0].EncryptedSpaceKey != "new-one" {
		t.Fatalf("partial batch changed existing key to %q", members[0].EncryptedSpaceKey)
	}
}

func TestSpaceRepository_DeleteMember(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	ownerID := testkit.SeedUser(t, queries, "owner@example.com")
	memberID := testkit.SeedUser(t, queries, "member@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Test Space")

	// Add member
	testkit.SeedMembership(t, queries, spaceID, memberID, "member")

	// Delete member
	err := repo.DeleteMember(ctx, spaceID, memberID)
	if err != nil {
		t.Fatalf("DeleteMember() error = %v", err)
	}

	// Verify
	members, _ := repo.ListMembers(ctx, spaceID)
	if len(members) != 1 {
		t.Errorf("ListMembers() after delete returned %d members, want 1", len(members))
	}
}

func TestSpaceRepository_DeleteAllMembershipsForUser(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	ownerID := testkit.SeedUser(t, queries, "owner@example.com")
	memberID := testkit.SeedUser(t, queries, "member@example.com")

	// Create two spaces and add member to both
	spaceID1 := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Space 1")
	spaceID2 := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Space 2")
	testkit.SeedMembership(t, queries, spaceID1, memberID, "member")
	testkit.SeedMembership(t, queries, spaceID2, memberID, "member")

	// Delete all memberships for member
	err := repo.DeleteAllMembershipsForUser(ctx, memberID)
	if err != nil {
		t.Fatalf("DeleteAllMembershipsForUser() error = %v", err)
	}

	// Verify - user should have no spaces
	spaces, _ := repo.ListForUser(ctx, memberID)
	if len(spaces) != 0 {
		t.Errorf("ListForUser() after delete returned %d spaces, want 0", len(spaces))
	}
}

func TestSpaceRepository_DeleteAllMembershipsForSpace(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	ownerID := testkit.SeedUser(t, queries, "owner@example.com")
	memberID := testkit.SeedUser(t, queries, "member@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Test Space")

	// Add member
	testkit.SeedMembership(t, queries, spaceID, memberID, "member")

	// Delete all memberships for space
	err := repo.DeleteAllMembershipsForSpace(ctx, spaceID)
	if err != nil {
		t.Fatalf("DeleteAllMembershipsForSpace() error = %v", err)
	}

	// Verify
	members, _ := repo.ListMembers(ctx, spaceID)
	if len(members) != 0 {
		t.Errorf("ListMembers() after delete returned %d members, want 0", len(members))
	}
}

// Invite tests
func TestSpaceRepository_CreateInvite(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	ownerID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Test Space")

	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	invite := &domain.SpaceInvite{
		ID:            testkit.GenerateID(),
		SpaceID:       spaceID,
		InviterUserID: ownerID,
		InviteeEmail:  "invitee@example.com",
		InviteSecret:  testkit.GenerateSecret(),
		ExpiresAt:     &expiresAt,
		CreatedAt:     time.Now(),
	}

	err := repo.CreateInvite(ctx, invite)
	if err != nil {
		t.Fatalf("CreateInvite() error = %v", err)
	}

	// Verify by getting
	found, err := repo.GetInviteBySecret(ctx, invite.InviteSecret)
	if err != nil {
		t.Fatalf("GetInviteBySecret() error = %v", err)
	}
	if found.ID != invite.ID {
		t.Errorf("Invite ID = %v, want %v", found.ID, invite.ID)
	}
}

func TestSpaceRepository_GetInviteBySecret(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	ownerID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Test Space")

	inviteID, secret := testkit.SeedInvite(t, queries, spaceID, ownerID, "invitee@example.com")

	invite, err := repo.GetInviteBySecret(ctx, secret)
	if err != nil {
		t.Fatalf("GetInviteBySecret() error = %v", err)
	}
	if invite.ID != inviteID {
		t.Errorf("Invite ID = %v, want %v", invite.ID, inviteID)
	}
	if invite.SpaceID != spaceID {
		t.Errorf("SpaceID = %v, want %v", invite.SpaceID, spaceID)
	}
}

func TestSpaceRepository_GetInviteBySecret_NotFound(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	_, err := repo.GetInviteBySecret(ctx, "nonexistent_secret")
	if !errors.Is(err, domain.ErrInviteNotFound) {
		t.Errorf("GetInviteBySecret() error = %v, want ErrInviteNotFound", err)
	}
}

func TestSpaceRepository_UpdateInviteBundle(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	ownerID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Test Space")
	inviteID, secret := testkit.SeedInvite(t, queries, spaceID, ownerID, "invitee@example.com")

	bundle := "encrypted_bundle_data"
	err := repo.UpdateInviteBundle(ctx, inviteID, spaceID, bundle)
	if err != nil {
		t.Fatalf("UpdateInviteBundle() error = %v", err)
	}

	// Verify
	invite, _ := repo.GetInviteBySecret(ctx, secret)
	if invite.EncryptedBundle != bundle {
		t.Errorf("EncryptedBundle = %v, want %v", invite.EncryptedBundle, bundle)
	}
}

func TestSpaceRepository_MarkInviteRedeemed(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	ownerID := testkit.SeedUser(t, queries, "owner@example.com")
	redeemer := testkit.SeedUser(t, queries, "redeemer@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Test Space")
	inviteID, _ := testkit.SeedInvite(t, queries, spaceID, ownerID, "invitee@example.com")

	redeemedAt := time.Now()
	err := repo.MarkInviteRedeemed(ctx, inviteID, redeemer, redeemedAt)
	if err != nil {
		t.Fatalf("MarkInviteRedeemed() error = %v", err)
	}
}

func TestSpaceRepository_MarkInviteExpired(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	ownerID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Test Space")
	inviteID, _ := testkit.SeedInvite(t, queries, spaceID, ownerID, "invitee@example.com")

	err := repo.MarkInviteExpired(ctx, inviteID)
	if err != nil {
		t.Fatalf("MarkInviteExpired() error = %v", err)
	}
}

func TestSpaceRepository_DeleteInvite(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	ownerID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Test Space")
	inviteID, secret := testkit.SeedInvite(t, queries, spaceID, ownerID, "invitee@example.com")

	err := repo.DeleteInvite(ctx, inviteID, spaceID)
	if err != nil {
		t.Fatalf("DeleteInvite() error = %v", err)
	}

	// Verify deleted
	_, err = repo.GetInviteBySecret(ctx, secret)
	if !errors.Is(err, domain.ErrInviteNotFound) {
		t.Errorf("GetInviteBySecret() after delete: error = %v, want ErrInviteNotFound", err)
	}
}

func TestSpaceRepository_ListInvites(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	ownerID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Test Space")

	// Initially empty
	invites, err := repo.ListInvites(ctx, spaceID)
	if err != nil {
		t.Fatalf("ListInvites() error = %v", err)
	}
	if len(invites) != 0 {
		t.Errorf("ListInvites() returned %d invites, want 0", len(invites))
	}

	// Create invites
	testkit.SeedInvite(t, queries, spaceID, ownerID, "invite1@example.com")
	testkit.SeedInvite(t, queries, spaceID, ownerID, "invite2@example.com")

	invites, err = repo.ListInvites(ctx, spaceID)
	if err != nil {
		t.Fatalf("ListInvites() error = %v", err)
	}
	if len(invites) != 2 {
		t.Errorf("ListInvites() returned %d invites, want 2", len(invites))
	}
}

// Encryption key version tests
func TestSpaceRepository_IncrementEncryptionKeyVersion(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	// Initial version should be 1 (default)
	blob, err := repo.GetBlob(ctx, spaceID)
	if err != nil {
		t.Fatalf("GetBlob() error = %v", err)
	}
	if blob.EncryptionKeyVersion != 1 {
		t.Errorf("Initial EncryptionKeyVersion = %v, want 1", blob.EncryptionKeyVersion)
	}

	// Increment version
	newVersion, err := repo.IncrementEncryptionKeyVersion(ctx, spaceID)
	if err != nil {
		t.Fatalf("IncrementEncryptionKeyVersion() error = %v", err)
	}
	if newVersion != 2 {
		t.Errorf("IncrementEncryptionKeyVersion() = %v, want 2", newVersion)
	}

	// Verify by getting blob again
	blob, err = repo.GetBlob(ctx, spaceID)
	if err != nil {
		t.Fatalf("GetBlob() error = %v", err)
	}
	if blob.EncryptionKeyVersion != 2 {
		t.Errorf("EncryptionKeyVersion after increment = %v, want 2", blob.EncryptionKeyVersion)
	}
}

func TestSpaceRepository_IncrementEncryptionKeyVersion_MultipleIncrements(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	// Increment multiple times
	for i := 2; i <= 5; i++ {
		newVersion, err := repo.IncrementEncryptionKeyVersion(ctx, spaceID)
		if err != nil {
			t.Fatalf("IncrementEncryptionKeyVersion() iteration %d error = %v", i, err)
		}
		if newVersion != int64(i) {
			t.Errorf("IncrementEncryptionKeyVersion() iteration %d = %v, want %d", i, newVersion, i)
		}
	}

	// Verify final version
	blob, err := repo.GetBlob(ctx, spaceID)
	if err != nil {
		t.Fatalf("GetBlob() error = %v", err)
	}
	if blob.EncryptionKeyVersion != 5 {
		t.Errorf("Final EncryptionKeyVersion = %v, want 5", blob.EncryptionKeyVersion)
	}
}

func TestSpaceRepository_IncrementEncryptionKeyVersion_NotFound(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	_, err := repo.IncrementEncryptionKeyVersion(ctx, "nonexistent")
	if !errors.Is(err, domain.ErrSpaceNotFound) {
		t.Errorf("IncrementEncryptionKeyVersion() error = %v, want ErrSpaceNotFound", err)
	}
}

func TestSpaceRepository_GetBlob_IncludesEncryptionKeyVersion(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSpaceRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	// Get blob and verify encryption key version is present
	blob, err := repo.GetBlob(ctx, spaceID)
	if err != nil {
		t.Fatalf("GetBlob() error = %v", err)
	}

	// Default encryption key version should be 1
	if blob.EncryptionKeyVersion != 1 {
		t.Errorf("EncryptionKeyVersion = %v, want 1", blob.EncryptionKeyVersion)
	}

	// Increment and verify
	_, _ = repo.IncrementEncryptionKeyVersion(ctx, spaceID)
	blob, _ = repo.GetBlob(ctx, spaceID)
	if blob.EncryptionKeyVersion != 2 {
		t.Errorf("EncryptionKeyVersion after increment = %v, want 2", blob.EncryptionKeyVersion)
	}
}
