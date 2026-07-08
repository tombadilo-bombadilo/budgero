package application

import (
	"context"
	"time"

	"budgero-server/internal/port/driven/repository"
	"budgero-server/internal/port/driving"
)

const heartbeatDedupeThreshold = 45 * time.Second

// ActivityService implements driving.ActivityService.
type ActivityService struct {
	activityRepo repository.ActivityRepository
}

// NewActivityService creates a new ActivityService.
func NewActivityService(activityRepo repository.ActivityRepository) *ActivityService {
	return &ActivityService{activityRepo: activityRepo}
}

var _ driving.ActivityService = (*ActivityService)(nil)

// RecordHeartbeat marks a user active for the current UTC day.
func (s *ActivityService) RecordHeartbeat(ctx context.Context, userID string) error {
	return s.activityRepo.UpsertHeartbeat(ctx, userID, time.Now().UTC(), heartbeatDedupeThreshold)
}
