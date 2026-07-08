package application

import (
	"testing"
	"time"

	clerk "github.com/clerk/clerk-sdk-go/v2"
)

func TestActivityWindowForSession_SpansExpiredSessionLifetime(t *testing.T) {
	createdAt := time.Date(2026, time.March, 1, 10, 0, 0, 0, time.UTC)
	lastActiveAt := time.Date(2026, time.March, 3, 12, 0, 0, 0, time.UTC)
	expireAt := time.Date(2026, time.March, 5, 9, 0, 0, 0, time.UTC)

	startAt, endAt, ok := activityWindowForSession(&clerk.Session{
		Status:       "expired",
		CreatedAt:    createdAt.Unix(),
		LastActiveAt: lastActiveAt.Unix(),
		ExpireAt:     expireAt.Unix(),
	})
	if !ok {
		t.Fatal("expected activity window for expired session")
	}
	if !startAt.Equal(createdAt) {
		t.Fatalf("startAt = %s, want %s", startAt, createdAt)
	}
	if !endAt.Equal(expireAt) {
		t.Fatalf("endAt = %s, want %s", endAt, expireAt)
	}
}

func TestMergeSessionDayBuckets_SpansEachDayInWindow(t *testing.T) {
	startDay := time.Date(2026, time.March, 1, 0, 0, 0, 0, time.UTC)
	endExclusive := startDay.AddDate(0, 0, 7)
	buckets := make(map[string]int64)

	mergeSessionDayBuckets(
		buckets,
		startDay,
		endExclusive,
		time.Date(2026, time.March, 2, 9, 0, 0, 0, time.UTC),
		time.Date(2026, time.March, 4, 21, 0, 0, 0, time.UTC),
	)

	for _, day := range []string{"2026-03-02", "2026-03-03", "2026-03-04"} {
		if buckets[day] != 1 {
			t.Fatalf("bucket[%s] = %d, want 1", day, buckets[day])
		}
	}
	if buckets["2026-03-01"] != 0 || buckets["2026-03-05"] != 0 {
		t.Fatalf("unexpected buckets outside session range: %+v", buckets)
	}
}
