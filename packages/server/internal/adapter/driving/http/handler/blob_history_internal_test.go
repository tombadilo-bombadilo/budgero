package handler

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"budgero-server/internal/adapter/driven/sqlite"
	"budgero-server/internal/domain"
	"budgero-server/internal/testkit"
)

// A publish whose final rename fails must put the archived snapshot back, so
// the space keeps serving the bytes it had and history gains no row.
func TestPublishLocked_RenameFailureMovesArchivedSnapshotBack(t *testing.T) {
	sqlDB, queries, services, cfg := testkit.NewTestServices(t, false)
	h := NewHandlers(services, nil, Options{Config: cfg})
	ctx := context.Background()
	userID := testkit.SeedUser(t, queries, "publish@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Publish Space")

	blobPath := sqlite.SpaceBlobPath(spaceID)
	if err := os.MkdirAll(filepath.Dir(blobPath), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(blobPath, []byte("current"), 0o600); err != nil {
		t.Fatal(err)
	}
	version, err := services.Space.UpdateSyncState(ctx, userID, spaceID, "hash-1", 7, 3)
	if err != nil || version != 1 {
		t.Fatalf("seed version = %d, %v", version, err)
	}
	prev, err := services.SnapshotHistory.Current(ctx, spaceID)
	if err != nil {
		t.Fatal(err)
	}

	missingTemp := filepath.Join(t.TempDir(), "never-written.upload")
	_, err = h.publishLocked(ctx, prev, missingTemp, domain.SnapshotOriginSync, 0, func() (int64, error) {
		return services.Space.UpdateSyncState(ctx, userID, spaceID, "hash-2", 9, 4)
	})
	if !errors.Is(err, errBlobPublish) {
		t.Fatalf("publish error = %v, want errBlobPublish", err)
	}

	data, readErr := os.ReadFile(blobPath) //nolint:gosec // G304: test-owned temp path
	if readErr != nil || string(data) != "current" {
		t.Fatalf("current blob after failed publish = %q, %v", data, readErr)
	}
	entries, err := services.SnapshotHistory.List(ctx, spaceID)
	if err != nil || len(entries) != 0 {
		t.Fatalf("history after failed publish = %+v, %v", entries, err)
	}
	if files, _ := os.ReadDir(domain.SpaceBlobHistoryDir(blobPath, spaceID)); len(files) != 0 {
		t.Fatalf("history dir after failed publish holds %d files", len(files))
	}
}
