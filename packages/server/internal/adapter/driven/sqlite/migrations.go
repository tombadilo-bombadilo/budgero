package sqlite

import (
	"database/sql"
	"embed"
	"fmt"

	"github.com/pressly/goose/v3"
	"github.com/rs/zerolog/log"
)

//go:embed migrations/*.sql
var embedMigrations embed.FS

func init() {
	goose.SetBaseFS(embedMigrations)
}

// Migrate runs all pending database migrations.
func Migrate(db *sql.DB) error {
	if err := goose.SetDialect("sqlite3"); err != nil {
		return fmt.Errorf("failed to set goose dialect: %w", err)
	}

	// Ensure schema compatibility for upgrades from older versions
	if err := ensureSchemaCompatibility(db); err != nil {
		return fmt.Errorf("failed to ensure schema compatibility: %w", err)
	}

	if err := goose.Up(db, "migrations"); err != nil {
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	return nil
}

// ensureSchemaCompatibility adds any missing columns to existing tables.
// This handles upgrades from older versions where the schema may differ.
func ensureSchemaCompatibility(db *sql.DB) error {
	// Check if users table exists (indicates an existing database)
	var tableExists int
	err := db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='users'").Scan(&tableExists)
	if err != nil || tableExists == 0 {
		return nil // Fresh database, nothing to do
	}

	// Get existing columns
	existingCols := make(map[string]bool)
	rows, err := db.Query("PRAGMA table_info(users)")
	if err != nil {
		return fmt.Errorf("failed to get table info: %w", err)
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var cid int
		var name, colType string
		var notNull, pk int
		var dfltValue interface{}
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dfltValue, &pk); err != nil {
			return fmt.Errorf("failed to scan column info: %w", err)
		}
		existingCols[name] = true
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("failed to iterate columns: %w", err)
	}

	// Columns that may be missing from older self-host or SaaS versions
	columnsToAdd := []struct {
		name string
		def  string
	}{
		{"subscription_status", "TEXT DEFAULT 'inactive'"},
		{"subscription_id", "TEXT DEFAULT NULL"},
		{"customer_id", "TEXT DEFAULT NULL"},
		{"variant_id", "TEXT DEFAULT NULL"},
		{"subscription_ends_at", "DATETIME DEFAULT NULL"},
		{"trial_ends_at", "DATETIME DEFAULT NULL"},
		{"current_period_end", "DATETIME DEFAULT NULL"},
		{"has_beta_access", "BOOLEAN NOT NULL DEFAULT 0"},
		{"beta_expires_at", "DATETIME DEFAULT NULL"},
		{"is_founding_member", "BOOLEAN NOT NULL DEFAULT 0"},
		{"has_collaboration_access", "BOOLEAN NOT NULL DEFAULT 0"},
		{"onboarding_status", "TEXT NOT NULL DEFAULT 'pending'"},
		{"onboarding_completed_at", "DATETIME DEFAULT NULL"},
		{"onboarding_snoozed_until", "DATETIME DEFAULT NULL"},
		{"primary_space_id", "TEXT DEFAULT NULL"},
	}

	for _, col := range columnsToAdd {
		if !existingCols[col.name] {
			query := fmt.Sprintf("ALTER TABLE users ADD COLUMN %s %s", col.name, col.def)
			if _, err := db.Exec(query); err != nil {
				return fmt.Errorf("failed to add column %s: %w", col.name, err)
			}
			log.Info().Str("column", col.name).Msg("Added missing column to users table")
		}
	}

	return nil
}

// MigrateDown rolls back the last migration.
func MigrateDown(db *sql.DB) error {
	if err := goose.SetDialect("sqlite3"); err != nil {
		return fmt.Errorf("failed to set goose dialect: %w", err)
	}

	if err := goose.Down(db, "migrations"); err != nil {
		return fmt.Errorf("failed to rollback migration: %w", err)
	}

	return nil
}

// MigrateStatus prints the migration status.
func MigrateStatus(db *sql.DB) error {
	if err := goose.SetDialect("sqlite3"); err != nil {
		return fmt.Errorf("failed to set goose dialect: %w", err)
	}

	if err := goose.Status(db, "migrations"); err != nil {
		return fmt.Errorf("failed to get migration status: %w", err)
	}

	return nil
}
