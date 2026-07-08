package application

import (
	"context"

	"budgero-server/internal/port/driven/repository"
	"budgero-server/internal/port/driving"
)

// SyncService implements driving.SyncService.
type SyncService struct {
	syncRepo repository.SyncRepository
}

// NewSyncService creates a new SyncService.
func NewSyncService(syncRepo repository.SyncRepository) *SyncService {
	return &SyncService{syncRepo: syncRepo}
}

var _ driving.SyncService = (*SyncService)(nil)

// GetLatestVersion returns the latest mutation version for a space.
func (s *SyncService) GetLatestVersion(ctx context.Context, spaceID string) (int64, error) {
	return s.syncRepo.GetLatestVersion(ctx, spaceID)
}
