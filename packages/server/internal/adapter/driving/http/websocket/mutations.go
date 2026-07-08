package websocket

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

// MutationEntry represents a single mutation in the log
type MutationEntry struct {
	ID               string          `json:"id"`
	SpaceID          string          `json:"spaceId"`
	UserID           string          `json:"userId"`
	Version          int64           `json:"version"`
	Op               string          `json:"op,omitempty"`               // Legacy: unencrypted op
	Args             json.RawMessage `json:"args,omitempty"`             // Legacy: unencrypted args
	EncryptedPayload string          `json:"encryptedPayload,omitempty"` // New: encrypted op + args
	Timestamp        time.Time       `json:"timestamp"`
	BaseVersion      int64           `json:"baseVersion"`
}

// MutationMessage represents an incoming mutation from client
type MutationMessage struct {
	ID               string          `json:"id"`
	SpaceID          string          `json:"spaceId"`
	BaseVersion      int64           `json:"baseVersion"`
	Op               string          `json:"op,omitempty"`               // Legacy: unencrypted op
	Args             json.RawMessage `json:"args,omitempty"`             // Legacy: unencrypted args
	EncryptedPayload string          `json:"encryptedPayload,omitempty"` // New: encrypted op + args
	Timestamp        time.Time       `json:"timestamp"`
}

// MutationLog handles mutation sequencing and storage
type MutationLog struct {
	db *sql.DB
}

const (
	createMutationLogTableSQL = `
	CREATE TABLE IF NOT EXISTS mutation_log (
		id TEXT PRIMARY KEY,
		space_id TEXT NOT NULL,
		user_id TEXT NOT NULL,
		version INTEGER NOT NULL,
		op TEXT,
		args TEXT,
		encrypted_payload TEXT,
		timestamp DATETIME NOT NULL,
		base_version INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(space_id, version),
		UNIQUE(space_id, id)
	);`
)

const mutationAppendMaxAttempts = 3

var mutationLogIndexStatements = []string{
	`CREATE INDEX IF NOT EXISTS idx_mutation_log_space_version ON mutation_log(space_id, version);`,
	`CREATE INDEX IF NOT EXISTS idx_mutation_log_space_timestamp ON mutation_log(space_id, timestamp);`,
	`CREATE INDEX IF NOT EXISTS idx_mutation_log_space_user ON mutation_log(space_id, user_id);`,
}

// NewMutationLog creates a new mutation log.
func NewMutationLog(db *sql.DB) (*MutationLog, error) {
	ml := &MutationLog{db: db}
	if err := ml.initTables(); err != nil {
		return nil, err
	}
	return ml, nil
}

// initTables creates the mutation log tables if they don't exist
func (ml *MutationLog) initTables() error {
	if _, err := ml.db.Exec(createMutationLogTableSQL); err != nil {
		return fmt.Errorf("failed to create mutation_log table: %w", err)
	}
	if err := ml.migrateLegacyMutationTables(); err != nil {
		return fmt.Errorf("failed to migrate mutation log tables to space-aware schema: %w", err)
	}

	if err := ml.ensureMutationIndexes(); err != nil {
		return fmt.Errorf("failed to ensure mutation log indexes: %w", err)
	}
	return nil
}

// AppendMutation adds a mutation to the log and returns the assigned version
func (ml *MutationLog) AppendMutation(spaceID, userID string, mutation *MutationMessage) (int64, error) {
	var lastErr error
	for attempt := 1; attempt <= mutationAppendMaxAttempts; attempt++ {
		version, err := ml.appendMutationOnce(spaceID, userID, mutation)
		if err == nil {
			return version, nil
		}
		lastErr = err
		if !isRetryableMutationAppendError(err) || attempt == mutationAppendMaxAttempts {
			break
		}
		time.Sleep(time.Duration(attempt) * 50 * time.Millisecond)
	}
	return 0, lastErr
}

func (ml *MutationLog) appendMutationOnce(spaceID, userID string, mutation *MutationMessage) (int64, error) {
	ctx := context.Background()
	tx, err := ml.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("failed to begin mutation transaction: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	// Check for duplicate mutation ID scoped to the space
	var existingVersion int64
	err = tx.QueryRowContext(
		ctx,
		"SELECT version FROM mutation_log WHERE id = ? AND space_id = ?",
		mutation.ID, spaceID,
	).Scan(&existingVersion)
	if err == nil {
		log.Info().
			Str("mutation_id", mutation.ID).
			Str("space_id", spaceID).
			Int64("existing_version", existingVersion).
			Msg("Mutation already exists for space, returning existing version")
		return existingVersion, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("failed to check for duplicate mutation: %w", err)
	}

	var nextVersion int64 = 1
	err = tx.QueryRowContext(
		ctx,
		"SELECT COALESCE(MAX(version), 0) + 1 FROM mutation_log WHERE space_id = ?",
		spaceID,
	).Scan(&nextVersion)
	if err != nil {
		return 0, fmt.Errorf("failed to get next version: %w", err)
	}

	var argsJSON []byte
	var op string
	var encryptedPayload string

	if mutation.EncryptedPayload != "" {
		encryptedPayload = mutation.EncryptedPayload
	} else {
		op = mutation.Op
		var marshalErr error
		argsJSON, marshalErr = json.Marshal(mutation.Args)
		if marshalErr != nil {
			return 0, fmt.Errorf("failed to marshal mutation args: %w", marshalErr)
		}
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO mutation_log (id, space_id, user_id, version, op, args, encrypted_payload, timestamp, base_version)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		mutation.ID, spaceID, userID, nextVersion, op, argsJSON, encryptedPayload,
		mutation.Timestamp, mutation.BaseVersion,
	)
	if err != nil {
		if isDuplicateMutationIDError(err) {
			_ = tx.Rollback()
			committed = true
			existing, lookupErr := ml.lookupMutationVersion(spaceID, mutation.ID)
			if lookupErr == nil {
				return existing, nil
			}
		}
		return 0, fmt.Errorf("failed to insert mutation: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("failed to commit mutation insert: %w", err)
	}
	committed = true

	log.Info().
		Str("mutation_id", mutation.ID).
		Str("space_id", spaceID).
		Str("user_id", userID).
		Int64("version", nextVersion).
		Str("op", mutation.Op).
		Int64("base_version", mutation.BaseVersion).
		Msg("Mutation appended to log")

	return nextVersion, nil
}

func (ml *MutationLog) lookupMutationVersion(spaceID, mutationID string) (int64, error) {
	var existingVersion int64
	err := ml.db.QueryRow(
		"SELECT version FROM mutation_log WHERE id = ? AND space_id = ?",
		mutationID, spaceID,
	).Scan(&existingVersion)
	if err != nil {
		return 0, err
	}
	return existingVersion, nil
}

func isRetryableMutationAppendError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "database is locked") || strings.Contains(msg, "database is busy") {
		return true
	}
	if strings.Contains(msg, "unique constraint failed: mutation_log.space_id, mutation_log.version") {
		return true
	}
	return false
}

func isDuplicateMutationIDError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique constraint failed: mutation_log.space_id, mutation_log.id")
}

func (ml *MutationLog) ensureMutationIndexes() error {
	for _, stmt := range mutationLogIndexStatements {
		if _, err := ml.db.Exec(stmt); err != nil {
			return fmt.Errorf("failed to ensure mutation_log index: %w", err)
		}
	}
	return nil
}

func (ml *MutationLog) migrateLegacyMutationTables() error {
	hasSpaceID, err := ml.tableHasColumn("mutation_log", "space_id")
	if err != nil {
		return fmt.Errorf("failed to inspect mutation_log schema: %w", err)
	}
	if !hasSpaceID {
		if rebuildErr := ml.rebuildMutationLogTable(); rebuildErr != nil {
			return rebuildErr
		}
	}

	return nil
}

func (ml *MutationLog) tableHasColumn(table, column string) (bool, error) {
	rows, err := ml.db.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return false, err
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var (
			cid          int
			name         string
			typeName     string
			notNull      int
			defaultValue sql.NullString
			pk           int
		)
		if err := rows.Scan(&cid, &name, &typeName, &notNull, &defaultValue, &pk); err != nil {
			return false, err
		}
		if strings.EqualFold(name, column) {
			return true, nil
		}
	}

	return false, rows.Err()
}

func (ml *MutationLog) rebuildMutationLogTable() error {
	tx, err := ml.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin mutation_log migration: %w", err)
	}

	if _, err := tx.Exec(`ALTER TABLE mutation_log RENAME TO mutation_log_legacy`); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("failed to rename legacy mutation_log: %w", err)
	}

	if _, err := tx.Exec(createMutationLogTableSQL); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("failed to create new mutation_log table: %w", err)
	}

	insertSQL := `
	INSERT INTO mutation_log (
		id,
		space_id,
		user_id,
		version,
		op,
		args,
		encrypted_payload,
		timestamp,
		base_version,
		created_at
	)
	SELECT
		legacy.id,
		COALESCE(NULLIF(users.primary_space_id, ''), legacy.user_id),
		legacy.user_id,
		legacy.version,
		legacy.op,
		legacy.args,
		legacy.encrypted_payload,
		legacy.timestamp,
		legacy.base_version,
		legacy.created_at
	FROM mutation_log_legacy AS legacy
	LEFT JOIN users ON users.id = legacy.user_id;
	`

	if _, err := tx.Exec(insertSQL); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("failed to backfill mutation_log rows: %w", err)
	}

	if _, err := tx.Exec(`DROP TABLE mutation_log_legacy`); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("failed to drop legacy mutation_log table: %w", err)
	}

	if err := tx.Commit(); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("failed to commit mutation_log migration: %w", err)
	}

	log.Info().Msg("Migrated mutation_log table to space-aware schema")
	return nil
}

// GetMutationsSince retrieves mutations since a given version
func (ml *MutationLog) GetMutationsSince(spaceID string, sinceVersion int64, limit int) ([]*MutationEntry, error) {
	if limit <= 0 {
		limit = 100 // Default limit
	}

	rows, err := ml.db.Query(`
		SELECT id, space_id, user_id, version, op, args, encrypted_payload, timestamp, base_version
		FROM mutation_log 
		WHERE space_id = ? AND version > ?
		ORDER BY version ASC
		LIMIT ?`,
		spaceID, sinceVersion, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query mutations: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var mutations []*MutationEntry
	for rows.Next() {
		entry := &MutationEntry{}
		var argsJSON sql.NullString
		var op sql.NullString
		var encryptedPayload sql.NullString

		err = rows.Scan(
			&entry.ID, &entry.SpaceID, &entry.UserID, &entry.Version, &op,
			&argsJSON, &encryptedPayload, &entry.Timestamp, &entry.BaseVersion,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan mutation row: %w", err)
		}

		// Handle both encrypted and legacy formats
		if encryptedPayload.Valid && encryptedPayload.String != "" {
			entry.EncryptedPayload = encryptedPayload.String
		} else {
			// Legacy format
			if op.Valid {
				entry.Op = op.String
			}
			if argsJSON.Valid {
				entry.Args = json.RawMessage(argsJSON.String)
			}
		}

		mutations = append(mutations, entry)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating mutations: %w", err)
	}

	return mutations, nil
}

// GetLatestVersion returns the latest version for a space
func (ml *MutationLog) GetLatestVersion(spaceID string) (int64, error) {
	var version int64
	err := ml.db.QueryRow(
		"SELECT COALESCE(MAX(version), 0) FROM mutation_log WHERE space_id = ?",
		spaceID,
	).Scan(&version)
	return version, err
}

// ResetSpace removes all mutation history and snapshots for a given space.
func (ml *MutationLog) ResetSpace(spaceID string) error {
	if ml == nil || ml.db == nil {
		return nil
	}

	if _, err := ml.db.Exec(`DELETE FROM mutation_log WHERE space_id = ?`, spaceID); err != nil {
		return fmt.Errorf("failed to delete mutation log entries: %w", err)
	}

	log.Info().Str("space_id", spaceID).Msg("Cleared mutation history for space")
	return nil
}
