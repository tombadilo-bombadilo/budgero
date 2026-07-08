package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/port/driven/repository"
)

// ActivityRepository implements repository.ActivityRepository using SQLite.
type ActivityRepository struct {
	db      *sql.DB
	queries *sqlc.Queries
}

// NewActivityRepository creates a new ActivityRepository.
func NewActivityRepository(db *sql.DB, queries *sqlc.Queries) *ActivityRepository {
	return &ActivityRepository{db: db, queries: queries}
}

var _ repository.ActivityRepository = (*ActivityRepository)(nil)

// UpsertHeartbeat records a heartbeat into the user's daily bucket.
func (r *ActivityRepository) UpsertHeartbeat(ctx context.Context, userID string, now time.Time, dedupeThreshold time.Duration) error {
	now = now.UTC()
	day := now.Format("2006-01-02")
	dedupeCutoff := now.Add(-dedupeThreshold)

	const stmt = `
INSERT INTO user_daily_activity (
	user_id,
	day,
	first_seen_at,
	last_seen_at,
	hit_count
) VALUES (?, ?, ?, ?, 1)
ON CONFLICT(user_id, day) DO UPDATE SET
	first_seen_at = MIN(user_daily_activity.first_seen_at, excluded.first_seen_at),
	last_seen_at = MAX(user_daily_activity.last_seen_at, excluded.last_seen_at),
	hit_count = CASE
		WHEN user_daily_activity.last_seen_at < ? THEN user_daily_activity.hit_count + 1
		ELSE user_daily_activity.hit_count
	END
`
	_, err := r.db.ExecContext(ctx, stmt, userID, day, now, now, dedupeCutoff)
	return err
}

// ListUserDailyActivity returns daily activity rows for a UTC window.
func (r *ActivityRepository) ListUserDailyActivity(ctx context.Context, userID string, startInclusive, endExclusive time.Time) ([]repository.UserDailyActivityDay, error) {
	rows, err := r.queries.ListUserDailyActivity(ctx, sqlc.ListUserDailyActivityParams{
		UserID: userID,
		Day:    startInclusive.UTC().Format("2006-01-02"),
		Day_2:  endExclusive.UTC().Format("2006-01-02"),
	})
	if err != nil {
		return nil, err
	}

	result := make([]repository.UserDailyActivityDay, 0, len(rows))
	for i := range rows {
		result = append(result, repository.UserDailyActivityDay{
			Day:        rows[i].Day,
			HitCount:   rows[i].HitCount,
			LastSeenAt: rows[i].LastSeenAt,
		})
	}
	return result, nil
}

// GetLastUserActivityAt returns the latest accepted heartbeat for a user.
func (r *ActivityRepository) GetLastUserActivityAt(ctx context.Context, userID string) (*time.Time, error) {
	lastSeenAt, err := r.queries.GetLastUserActivityAt(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	ts := lastSeenAt.UTC()
	return &ts, nil
}
