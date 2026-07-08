// Package sqlite provides SQLite database connection and path management.
package sqlite

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/pressly/goose/v3"
	"github.com/rs/zerolog/log"

	_ "modernc.org/sqlite" // SQLite driver registration
)

// Directory paths for data storage.
const (
	SpaceBlobSubdir   = "budget_spaces"
	LegacyUserDBDir   = "data/user_db"
	DefaultUserDBPath = "data/budgero.db"
)

func init() {
	// Silence goose logging by default
	goose.SetLogger(goose.NopLogger())
}

// Open opens and initializes the database connection.
func Open() (*sql.DB, error) {
	// Open database
	dbPath := ResolvePath()
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o750); err != nil {
		return nil, fmt.Errorf("failed to create database directory: %w", err)
	}
	if err := os.MkdirAll(ResolveSpaceBlobDir(), 0o750); err != nil {
		return nil, fmt.Errorf("failed to create budget space directory: %w", err)
	}
	if err := os.MkdirAll(LegacyUserDBDir, 0o750); err != nil {
		return nil, fmt.Errorf("failed to create legacy user directory: %w", err)
	}

	// PRAGMAs in the DSN apply to every connection the pool opens, not just
	// the first one. busy_timeout(5000) tells SQLite to wait up to 5s for a
	// write lock instead of erroring immediately with SQLITE_BUSY — critical
	// when concurrent signal-recording POSTs land within milliseconds of
	// each other. journal_mode(WAL) is also set here for belt-and-suspenders
	// (PRAGMA exec below covers older driver paths).
	dsn := dbPath + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Run migrations
	if err := Migrate(db); err != nil {
		if cerr := db.Close(); cerr != nil {
			log.Error().Err(cerr).Msg("Failed to close database after migration failure")
		}
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	// Belt-and-suspenders WAL exec — the DSN above already sets it but
	// some test helpers open the DB directly without the DSN sugar.
	if _, err := db.Exec("PRAGMA journal_mode = WAL;"); err != nil {
		if cerr := db.Close(); cerr != nil {
			log.Error().Err(cerr).Msg("Failed to close database after WAL failure")
		}
		return nil, fmt.Errorf("failed to enable WAL mode: %w", err)
	}

	return db, nil
}

// Close properly closes the database with WAL checkpoint.
func Close(db *sql.DB) error {
	if _, err := db.Exec("PRAGMA wal_checkpoint(TRUNCATE);"); err != nil {
		log.Warn().Err(err).Msg("Failed to checkpoint WAL")
	}
	return db.Close()
}

// IsSelfHostMode returns true if running in self-host mode.
func IsSelfHostMode() bool {
	return strings.EqualFold(os.Getenv("SELF_HOSTABLE"), "true")
}

// ResolvePath determines the database path based on environment.
func ResolvePath() string {
	if custom := strings.TrimSpace(os.Getenv("DB_PATH")); custom != "" {
		return custom
	}
	if IsSelfHostMode() {
		return "data/budgero_self_host.db"
	}
	return DefaultUserDBPath
}

// ResolveSpaceBlobDir determines the blob directory based on DB_PATH.
func ResolveSpaceBlobDir() string {
	return filepath.Join(filepath.Dir(ResolvePath()), SpaceBlobSubdir)
}

// SpaceBlobPath builds the canonical filesystem path for a space blob.
func SpaceBlobPath(spaceID string) string {
	return filepath.Join(ResolveSpaceBlobDir(), fmt.Sprintf("space_%s.db", spaceID))
}
