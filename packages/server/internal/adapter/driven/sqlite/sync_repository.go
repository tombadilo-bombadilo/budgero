package sqlite

import (
	"context"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/port/driven/repository"
)

// SyncRepository implements repository.SyncRepository using SQLite.
type SyncRepository struct {
	queries *sqlc.Queries
}

// NewSyncRepository creates a new SyncRepository.
func NewSyncRepository(queries *sqlc.Queries) *SyncRepository {
	return &SyncRepository{queries: queries}
}

var _ repository.SyncRepository = (*SyncRepository)(nil)

// GetLatestVersion returns the latest mutation version for a space.
func (r *SyncRepository) GetLatestVersion(ctx context.Context, spaceID string) (int64, error) {
	result, err := r.queries.GetLatestMutationVersion(ctx, spaceID)
	if err != nil {
		return 0, err
	}
	return ToInt64(result), nil
}
