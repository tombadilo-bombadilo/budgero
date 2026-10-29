package sqlite

import (
	"context"
	"database/sql"

	"budgero-server/internal/port/driven/repository"
)

// UpdatePingRepository implements repository.UpdatePingRepository using SQLite.
// Uses raw SQL rather than sqlc so schema tweaks don't have to wait for an
// `sqlc generate` step in CI — same pattern feedback_repository.go follows.
type UpdatePingRepository struct {
	db *sql.DB
}

// NewUpdatePingRepository creates a new UpdatePingRepository.
func NewUpdatePingRepository(db *sql.DB) *UpdatePingRepository {
	return &UpdatePingRepository{db: db}
}

var _ repository.UpdatePingRepository = (*UpdatePingRepository)(nil)

// Record increments the daily counter for the given version/build/type tuple.
func (r *UpdatePingRepository) Record(ctx context.Context, day, version, build, clientType string) error {
	const stmt = `
INSERT INTO update_pings (day, version, build, client_type, count)
VALUES (?, ?, ?, ?, 1)
ON CONFLICT (day, version, build, client_type) DO UPDATE SET
    count = count + 1,
    updated_at = CURRENT_TIMESTAMP
`
	_, err := r.db.ExecContext(ctx, stmt, day, version, build, clientType)
	return err
}

// WeekKey implements repository.UpdatePingRepository.
func (r *UpdatePingRepository) WeekKey(ctx context.Context, week string, newKey []byte) ([]byte, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	stmts := []string{
		`INSERT OR REPLACE INTO selfhost_weekly_installs (week, installs)
		 SELECT week, COUNT(*) FROM update_ping_week_senders WHERE week < ? GROUP BY week`,
		`DELETE FROM update_ping_week_senders WHERE week < ?`,
		`DELETE FROM update_ping_week_key WHERE week < ?`,
	}
	for _, stmt := range stmts {
		if _, err := tx.ExecContext(ctx, stmt, week); err != nil {
			return nil, err
		}
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT OR IGNORE INTO update_ping_week_key (week, key) VALUES (?, ?)`, week, newKey,
	); err != nil {
		return nil, err
	}
	var key []byte
	if err := tx.QueryRowContext(ctx,
		`SELECT key FROM update_ping_week_key WHERE week = ?`, week,
	).Scan(&key); err != nil {
		return nil, err
	}
	return key, tx.Commit()
}

// AddSender implements repository.UpdatePingRepository.
func (r *UpdatePingRepository) AddSender(ctx context.Context, week, sender string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO update_ping_week_senders (week, sender) VALUES (?, ?)`, week, sender)
	return err
}

// WeeklyInstalls implements repository.UpdatePingRepository.
func (r *UpdatePingRepository) WeeklyInstalls(ctx context.Context, sinceWeek string) ([]repository.WeeklyInstallCount, error) {
	const q = `
SELECT week, installs FROM selfhost_weekly_installs WHERE week >= ?
UNION ALL
SELECT week, COUNT(*) FROM update_ping_week_senders
WHERE week >= ? AND week NOT IN (SELECT week FROM selfhost_weekly_installs)
GROUP BY week
ORDER BY week`
	rows, err := r.db.QueryContext(ctx, q, sinceWeek, sinceWeek)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []repository.WeeklyInstallCount
	for rows.Next() {
		var w repository.WeeklyInstallCount
		if err := rows.Scan(&w.Week, &w.Installs); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// VersionPings implements repository.UpdatePingRepository.
func (r *UpdatePingRepository) VersionPings(ctx context.Context, sinceDay, clientType string) ([]repository.VersionPingCount, error) {
	const q = `
SELECT version, SUM(count), COUNT(DISTINCT day) FROM update_pings
WHERE client_type = ? AND day >= ?
GROUP BY version
ORDER BY SUM(count) DESC, version DESC`
	rows, err := r.db.QueryContext(ctx, q, clientType, sinceDay)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []repository.VersionPingCount
	for rows.Next() {
		var v repository.VersionPingCount
		if err := rows.Scan(&v.Version, &v.Pings, &v.Days); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
