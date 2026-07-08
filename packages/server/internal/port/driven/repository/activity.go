package repository

import (
	"context"
	"time"
)

// UserDailyActivityDay stores one UTC day bucket and its accepted heartbeat count.
type UserDailyActivityDay struct {
	Day        string    `json:"day"`
	HitCount   int64     `json:"hitCount"`
	LastSeenAt time.Time `json:"lastSeenAt"`
}

// ActivityRepository defines persistence for app heartbeat activity.
type ActivityRepository interface {
	// UpsertHeartbeat records a heartbeat into the current UTC day bucket.
	UpsertHeartbeat(ctx context.Context, userID string, now time.Time, dedupeThreshold time.Duration) error

	// ListUserDailyActivity returns daily heartbeat buckets for a user within a UTC window.
	ListUserDailyActivity(ctx context.Context, userID string, startInclusive, endExclusive time.Time) ([]UserDailyActivityDay, error)

	// GetLastUserActivityAt returns the most recent accepted heartbeat time for a user.
	GetLastUserActivityAt(ctx context.Context, userID string) (*time.Time, error)
}
