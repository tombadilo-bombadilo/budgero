package application_test

import (
	"context"
	"database/sql"
	"testing"

	"budgero-server/internal/application"
	"budgero-server/internal/domain"
	"budgero-server/internal/testkit"
)

func setSpaceCreatedAt(t *testing.T, sqlDB *sql.DB, spaceID, createdAt string) {
	t.Helper()
	if _, err := sqlDB.Exec(`UPDATE budget_spaces SET created_at = ? WHERE space_id = ?`, createdAt, spaceID); err != nil {
		t.Fatalf("failed to set created_at: %v", err)
	}
}

func primaryOf(t *testing.T, services *application.Services, userID string) string {
	t.Helper()
	u, err := services.User.GetByID(context.Background(), userID)
	if err != nil {
		t.Fatalf("failed to reload user: %v", err)
	}
	return u.PrimarySpaceID
}

// Deleting the primary space (e.g. leaving the onboarding demo) moves the
// primary onto the oldest remaining space the user owns, never one they only
// belong to.
func TestSpaceServiceDelete_ReassignsPrimaryToOldestOwnedSpace(t *testing.T) {
	ctx := context.Background()
	sqlDB, queries, services, _ := testkit.NewTestServices(t, false)

	ownerID := testkit.SeedUser(t, queries, "owner-reassign@example.com")
	otherID := testkit.SeedUser(t, queries, "other-reassign@example.com")
	demoID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Demo budget")
	newerID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Second")
	olderID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "First real")
	sharedID := testkit.SeedSpace(t, sqlDB, queries, otherID, "Shared with owner")
	testkit.SeedMembership(t, queries, sharedID, ownerID, domain.RoleMember)
	setSpaceCreatedAt(t, sqlDB, sharedID, "2020-01-01 00:00:00")
	setSpaceCreatedAt(t, sqlDB, demoID, "2026-01-01 00:00:00")
	setSpaceCreatedAt(t, sqlDB, olderID, "2026-01-02 00:00:00")
	setSpaceCreatedAt(t, sqlDB, newerID, "2026-01-03 00:00:00")

	if err := services.User.SetPrimarySpace(ctx, ownerID, demoID); err != nil {
		t.Fatalf("SetPrimarySpace: %v", err)
	}
	if err := services.User.SetPrimarySpace(ctx, otherID, sharedID); err != nil {
		t.Fatalf("SetPrimarySpace: %v", err)
	}

	if err := services.Space.Delete(ctx, ownerID, demoID); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	if got := primaryOf(t, services, ownerID); got != olderID {
		t.Fatalf("owner primary = %q, want oldest owned %q", got, olderID)
	}
	if got := primaryOf(t, services, otherID); got != sharedID {
		t.Fatalf("unrelated user's primary changed to %q", got)
	}
}

func TestGeneratePushToken_AssignsPrimaryLazily(t *testing.T) {
	ctx := context.Background()
	sqlDB, queries, services, _ := testkit.NewTestServices(t, false)

	ownerID := testkit.SeedUser(t, queries, "lazy-primary@example.com")
	firstID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "First")
	secondID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Second")
	setSpaceCreatedAt(t, sqlDB, secondID, "2026-01-01 00:00:00")
	setSpaceCreatedAt(t, sqlDB, firstID, "2025-12-31 00:00:00")
	// e.g. a user from before the delete fix, left with NULL after deleting their primary.
	if _, err := sqlDB.Exec(`UPDATE users SET primary_space_id = NULL WHERE id = ?`, ownerID); err != nil {
		t.Fatalf("failed to clear primary: %v", err)
	}

	if got := primaryOf(t, services, ownerID); got != "" {
		t.Fatalf("precondition: primary = %q, want empty", got)
	}

	info := application.NewGetPushEncryptionInfoUsecase(services.User, services.Push)
	if spaceID, _, err := info.Execute(ctx, ownerID); err != nil || spaceID != firstID {
		t.Fatalf("GetPushEncryptionInfo = %q, %v; want %q", spaceID, err, firstID)
	}

	uc := application.NewGeneratePushTokenUsecase(services.User, services.Push)
	token, spaceID, err := uc.Execute(ctx, ownerID)
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if token == "" || spaceID != firstID {
		t.Fatalf("Execute() = %q, %q; want token for %q", token, spaceID, firstID)
	}
	if got := primaryOf(t, services, ownerID); got != firstID {
		t.Fatalf("primary not persisted: %q", got)
	}
}

func TestGeneratePushToken_MemberOnlySpaceIsNotPrimary(t *testing.T) {
	ctx := context.Background()
	sqlDB, queries, services, _ := testkit.NewTestServices(t, false)

	ownerID := testkit.SeedUser(t, queries, "owner-only@example.com")
	memberID := testkit.SeedUser(t, queries, "member-only@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Owner's")
	testkit.SeedMembership(t, queries, spaceID, memberID, domain.RoleMember)

	uc := application.NewGeneratePushTokenUsecase(services.User, services.Push)
	if _, _, err := uc.Execute(ctx, memberID); err == nil {
		t.Fatal("expected error for a user who owns no space")
	}
	if got := primaryOf(t, services, memberID); got != "" {
		t.Fatalf("member primary = %q, want empty", got)
	}
}
