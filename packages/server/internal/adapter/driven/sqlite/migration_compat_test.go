package sqlite

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

// TestMigrationFromOldSchema verifies that migrations work when upgrading
// from an older database schema (e.g., v1.0.9) that's missing columns.
func TestMigrationFromOldSchema(t *testing.T) {
	// Create temp database
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "old_schema.db")

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer func() { _ = db.Close() }()

	// Create old-style users table (missing SaaS columns like subscription_status)
	_, err = db.Exec(`
		CREATE TABLE users (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT '',
			email TEXT UNIQUE NOT NULL,
			db_path TEXT NOT NULL DEFAULT '',
			is_master_password_set BOOLEAN NOT NULL DEFAULT 0,
			current_db_hash TEXT NOT NULL DEFAULT '',
			sync_version INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			last_user_db_backup DATETIME DEFAULT NULL,
			backup_reminder_frequency_days INTEGER NOT NULL DEFAULT 7,
			is_blocked BOOLEAN NOT NULL DEFAULT 0
		)
	`)
	if err != nil {
		t.Fatalf("failed to create old schema: %v", err)
	}

	// Insert a test user
	_, err = db.Exec(`INSERT INTO users (id, name, email) VALUES ('user1', 'Test User', 'test@example.com')`)
	if err != nil {
		t.Fatalf("failed to insert test user: %v", err)
	}

	t.Log("Created old-style database without subscription_status column")

	// Run migrations - this should add missing columns and succeed
	err = Migrate(db)
	if err != nil {
		t.Fatalf("Migration failed: %v", err)
	}

	t.Log("Migration completed successfully")

	// Verify subscription_status column was added
	var colCount int
	err = db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='subscription_status'`).Scan(&colCount)
	if err != nil {
		t.Fatalf("failed to check column: %v", err)
	}
	if colCount == 0 {
		t.Fatal("subscription_status column was not added")
	}

	// Verify the test user still exists and has default value
	var status sql.NullString
	err = db.QueryRow(`SELECT subscription_status FROM users WHERE id='user1'`).Scan(&status)
	if err != nil {
		t.Fatalf("failed to query user: %v", err)
	}
	if !status.Valid || status.String != "inactive" {
		t.Errorf("expected subscription_status='inactive', got %v", status)
	}

	t.Log("Verified subscription_status column exists with default value")
}

// TestMigrationFreshDatabase verifies migrations work on a fresh database.
func TestMigrationFreshDatabase(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "fresh.db")

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer func() { _ = db.Close() }()

	// Run migrations on fresh database
	err = Migrate(db)
	if err != nil {
		t.Fatalf("Migration failed on fresh db: %v", err)
	}

	// Verify tables exist
	var tableCount int
	err = db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='users'`).Scan(&tableCount)
	if err != nil || tableCount == 0 {
		t.Fatal("users table was not created")
	}

	t.Log("Fresh database migration successful")
}
