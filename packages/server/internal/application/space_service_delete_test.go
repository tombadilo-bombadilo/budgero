package application_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/domain"
	"budgero-server/internal/testkit"
)

func TestSpaceServiceDelete_RemovesWorkspaceDataAndClearsPrimarySpace(t *testing.T) {
	ctx := context.Background()
	sqlDB, queries, services, _ := testkit.NewTestServices(t, false)

	ownerID := testkit.SeedUser(t, queries, "owner-delete@example.com")
	memberID := testkit.SeedUser(t, queries, "member-delete@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Delete Me")
	testkit.SeedMembership(t, queries, spaceID, memberID, domain.RoleMember)
	testkit.SeedInvite(t, queries, spaceID, ownerID, "invitee@example.com")

	blobPath := filepath.Join(t.TempDir(), "space-delete.db")
	if err := os.WriteFile(blobPath, []byte("blob"), 0o600); err != nil {
		t.Fatalf("failed to create blob file: %v", err)
	}
	if _, err := queries.GetSpaceBlob(ctx, spaceID); err == nil {
		if err := queries.DeleteSpaceBlob(ctx, spaceID); err != nil {
			t.Fatalf("failed to delete seeded blob metadata: %v", err)
		}
	}
	if err := queries.CreateSpaceBlob(ctx, sqlc.CreateSpaceBlobParams{
		SpaceID:   spaceID,
		BlobPath:  blobPath,
		UpdatedAt: time.Now(),
	}); err != nil {
		t.Fatalf("failed to create blob metadata: %v", err)
	}
	if err := services.User.SetPrimarySpace(ctx, ownerID, spaceID); err != nil {
		t.Fatalf("failed to set primary space: %v", err)
	}

	if err := services.Space.Delete(ctx, ownerID, spaceID); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	if _, err := queries.GetSpaceByID(ctx, spaceID); err == nil {
		t.Fatal("expected workspace row to be deleted")
	}
	if _, err := queries.GetSpaceBlob(ctx, spaceID); err == nil {
		t.Fatal("expected blob metadata to be deleted")
	}
	members, err := queries.ListSpaceMembers(ctx, spaceID)
	if err != nil {
		t.Fatalf("failed to list members: %v", err)
	}
	if len(members) != 0 {
		t.Fatalf("members still present after delete: %d", len(members))
	}
	invites, err := queries.ListSpaceInvites(ctx, spaceID)
	if err != nil {
		t.Fatalf("failed to list invites: %v", err)
	}
	if len(invites) != 0 {
		t.Fatalf("invites still present after delete: %d", len(invites))
	}
	owner, err := services.User.GetByID(ctx, ownerID)
	if err != nil {
		t.Fatalf("failed to reload owner: %v", err)
	}
	if owner.PrimarySpaceID != "" {
		t.Fatalf("primary space id = %q, want empty", owner.PrimarySpaceID)
	}
	if _, err := os.Stat(blobPath); !os.IsNotExist(err) {
		t.Fatalf("expected blob file to be removed, stat err = %v", err)
	}
}

func TestSpaceServiceDelete_DeniesNonOwners(t *testing.T) {
	ctx := context.Background()
	sqlDB, queries, services, _ := testkit.NewTestServices(t, false)

	ownerID := testkit.SeedUser(t, queries, "owner-non-delete@example.com")
	memberID := testkit.SeedUser(t, queries, "member-non-delete@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Delete Guard")
	testkit.SeedMembership(t, queries, spaceID, memberID, domain.RoleMember)

	if err := services.Space.Delete(ctx, memberID, spaceID); err == nil {
		t.Fatal("expected non-owner delete to fail")
	}
}
