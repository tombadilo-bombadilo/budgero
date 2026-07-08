package sqlite_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/sqlite"
	"budgero-server/internal/testkit"
)

func TestActivityRepository_MigrationCreatesTable(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	_ = sqlite.NewActivityRepository(sqlDB, queries)

	var tableName string
	err := sqlDB.QueryRowContext(
		context.Background(),
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_daily_activity'",
	).Scan(&tableName)
	if err != nil {
		t.Fatalf("failed to query sqlite_master: %v", err)
	}
	if tableName != "user_daily_activity" {
		t.Fatalf("table name = %q, want user_daily_activity", tableName)
	}
}

func TestActivityRepository_UpsertHeartbeatAndAggregate(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewActivityRepository(sqlDB, queries)
	ctx := context.Background()

	userID := "user_activity_repo"
	first := time.Date(2026, 3, 12, 12, 0, 0, 0, time.UTC)
	second := first.Add(50 * time.Second)
	nextDay := time.Date(2026, 3, 13, 9, 0, 0, 0, time.UTC)

	if err := repo.UpsertHeartbeat(ctx, userID, first, 45*time.Second); err != nil {
		t.Fatalf("UpsertHeartbeat(first) error = %v", err)
	}
	if err := repo.UpsertHeartbeat(ctx, userID, second, 45*time.Second); err != nil {
		t.Fatalf("UpsertHeartbeat(second) error = %v", err)
	}
	if err := repo.UpsertHeartbeat(ctx, userID, nextDay, 45*time.Second); err != nil {
		t.Fatalf("UpsertHeartbeat(nextDay) error = %v", err)
	}

	rows, err := repo.ListUserDailyActivity(
		ctx,
		userID,
		time.Date(2026, 3, 12, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 3, 14, 0, 0, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("ListUserDailyActivity() error = %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("ListUserDailyActivity() returned %d rows, want 2", len(rows))
	}
	if rows[0].Day != "2026-03-12" || rows[0].HitCount != 2 {
		t.Fatalf("day[0] = %+v, want day 2026-03-12 with hitCount 2", rows[0])
	}
	if rows[1].Day != "2026-03-13" || rows[1].HitCount != 1 {
		t.Fatalf("day[1] = %+v, want day 2026-03-13 with hitCount 1", rows[1])
	}

	lastSeenAt, err := repo.GetLastUserActivityAt(ctx, userID)
	if err != nil {
		t.Fatalf("GetLastUserActivityAt() error = %v", err)
	}
	if lastSeenAt == nil || !lastSeenAt.Equal(nextDay) {
		t.Fatalf("lastSeenAt = %v, want %v", lastSeenAt, nextDay)
	}
}

func TestActivityRepository_DedupeThresholdSkipsRapidResend(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewActivityRepository(sqlDB, queries)
	ctx := context.Background()

	userID := "user_activity_dedupe"
	first := time.Date(2026, 3, 12, 12, 0, 0, 0, time.UTC)
	second := first.Add(20 * time.Second)

	if err := repo.UpsertHeartbeat(ctx, userID, first, 45*time.Second); err != nil {
		t.Fatalf("UpsertHeartbeat(first) error = %v", err)
	}
	if err := repo.UpsertHeartbeat(ctx, userID, second, 45*time.Second); err != nil {
		t.Fatalf("UpsertHeartbeat(second) error = %v", err)
	}

	rows, err := repo.ListUserDailyActivity(
		ctx,
		userID,
		time.Date(2026, 3, 12, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 3, 13, 0, 0, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("ListUserDailyActivity() error = %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("ListUserDailyActivity() returned %d rows, want 1", len(rows))
	}
	if rows[0].HitCount != 1 {
		t.Fatalf("hitCount = %d, want 1", rows[0].HitCount)
	}
	if !rows[0].LastSeenAt.Equal(second) {
		t.Fatalf("lastSeenAt = %v, want %v", rows[0].LastSeenAt, second)
	}
}

func TestActivityRepository_GetLastUserActivityAtEmpty(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewActivityRepository(sqlDB, queries)

	lastSeenAt, err := repo.GetLastUserActivityAt(context.Background(), "missing")
	if err != nil {
		t.Fatalf("GetLastUserActivityAt() error = %v", err)
	}
	if lastSeenAt != nil {
		t.Fatalf("lastSeenAt = %v, want nil", lastSeenAt)
	}
}

var _ = sql.ErrNoRows
