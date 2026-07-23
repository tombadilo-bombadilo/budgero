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
