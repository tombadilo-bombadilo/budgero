package sqlite

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"

	_ "modernc.org/sqlite"
)

// A request that read the row before a concurrent upload advanced it must not
// rewind sync_version or the hash when it moves a legacy blob path.
func TestReconcileBlobPath_DoesNotRewindConcurrentUpload(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if _, err := db.Exec(`PRAGMA foreign_keys = OFF`); err != nil {
		t.Fatalf("pragma: %v", err)
	}
	ctx := context.Background()
	queries := sqlc.New(db)
	repo := NewSpaceRepository(queries)

	const spaceID = "space-reconcile-race"
	legacyPath := filepath.Join(t.TempDir(), "missing-legacy.db")
	if _, err := db.Exec(
		`INSERT INTO budget_space_blobs (space_id, blob_path, current_hash, sync_version, size_bytes, encryption_key_version, updated_at)
		 VALUES (?, ?, '', 0, 0, 1, datetime('now'))`,
		spaceID, legacyPath,
	); err != nil {
		t.Fatalf("seed blob: %v", err)
	}

	stale, err := queries.GetSpaceBlob(ctx, spaceID)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	won, err := repo.UpdateSyncStateCAS(ctx, spaceID, "winner-hash", 42, 0, 0)
	if err != nil || won != 1 {
		t.Fatalf("CAS = %d, %v; want 1, nil", won, err)
	}

	if got := repo.reconcileBlobPath(ctx, &stale); got != SpaceBlobPath(spaceID) {
		t.Fatalf("reconciled path = %q, want canonical", got)
	}

	after, err := queries.GetSpaceBlob(ctx, spaceID)
	if err != nil {
		t.Fatalf("read after: %v", err)
	}
	if after.SyncVersion != 1 || after.CurrentHash != "winner-hash" || after.SizeBytes != 42 {
		t.Fatalf("sync state = (v%d, %q, %d), want (v1, winner-hash, 42)", after.SyncVersion, after.CurrentHash, after.SizeBytes)
	}
	if _, err := repo.UpdateSyncStateCAS(ctx, spaceID, "late-hash", 1, 0, 0); err == nil {
		t.Fatalf("second CAS against version 0 succeeded after reconcile")
	}
}
