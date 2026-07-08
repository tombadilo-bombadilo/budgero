package repository

import "context"

// SyncRepository defines methods for sync/mutation log persistence.
type SyncRepository interface {
	// GetLatestVersion returns the latest mutation version for a space.
	GetLatestVersion(ctx context.Context, spaceID string) (int64, error)
}
