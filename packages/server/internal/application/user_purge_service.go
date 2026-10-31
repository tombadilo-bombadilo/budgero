package application

import (
	"context"
	"errors"
	"os"

	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
	"budgero-server/internal/port/driving"

	"github.com/rs/zerolog/log"
)

// UserPurgeService permanently deletes users and all of their data.
type UserPurgeService struct {
	repo repository.UserPurgeRepository
}

// NewUserPurgeService creates a new UserPurgeService.
func NewUserPurgeService(repo repository.UserPurgeRepository) *UserPurgeService {
	return &UserPurgeService{repo: repo}
}

var _ driving.UserPurgeService = (*UserPurgeService)(nil)

// Purge deletes the user and everything tied to them, then their files.
// Database rows go in one transaction; files are removed only after it commits.
// The list holds snapshot history files before their (by then empty) folders.
func (s *UserPurgeService) Purge(ctx context.Context, userID string) (*domain.UserPurgeReport, error) {
	report, files, err := s.repo.Purge(ctx, userID)
	if err != nil {
		return nil, err
	}
	for _, path := range files {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			log.Warn().Err(err).Str("path", path).Msg("failed to remove file during user purge")
			continue
		}
		report.FilesRemoved++
	}
	return report, nil
}

// ListActivity returns every user with activity data for inactivity checks.
func (s *UserPurgeService) ListActivity(ctx context.Context) ([]domain.UserActivitySummary, error) {
	return s.repo.ListActivity(ctx)
}
