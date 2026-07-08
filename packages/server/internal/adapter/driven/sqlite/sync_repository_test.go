package sqlite_test

import (
	"context"
	"testing"

	"budgero-server/internal/adapter/driven/sqlite"
	"budgero-server/internal/testkit"
)

func TestSyncRepository_GetLatestVersion(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewSyncRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "sync@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	// Initially should be 0
	version, err := repo.GetLatestVersion(ctx, spaceID)
	if err != nil {
		t.Fatalf("GetLatestVersion() error = %v", err)
	}
	if version != 0 {
		t.Errorf("GetLatestVersion() = %v, want 0", version)
	}

	// Add mutation
	testkit.SeedMutation(t, queries, spaceID, userID, 1, "encrypted_payload")

	version, err = repo.GetLatestVersion(ctx, spaceID)
	if err != nil {
		t.Fatalf("GetLatestVersion() after mutation error = %v", err)
	}
	if version != 1 {
		t.Errorf("GetLatestVersion() = %v, want 1", version)
	}
}
