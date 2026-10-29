package application

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/sqlite"
)

func newPingService(t *testing.T, now *time.Time) (svc *UpdatePingService, count func(q string, args ...any) int) {
	t.Helper()
	// testkit imports this package, so open and migrate the DB directly.
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "pings.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := sqlite.Migrate(db); err != nil {
		t.Fatal(err)
	}
	svc = NewUpdatePingService(sqlite.NewUpdatePingRepository(db))
	svc.now = func() time.Time { return *now }
	count = func(q string, args ...any) int {
		t.Helper()
		var n int
		if err := db.QueryRowContext(context.Background(), q, args...).Scan(&n); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		return n
	}
	return svc, count
}

func TestUpdatePing_CountsDistinctSelfHostSendersPerWeek(t *testing.T) {
	now := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC) // Thursday
	svc, count := newPingService(t, &now)
	ctx := context.Background()

	for _, ip := range []string{"203.0.113.7", "203.0.113.7", "2001:db8::1", "198.51.100.2"} {
		if err := svc.Record(ctx, "1.19.5", "abc", "selfhost", ip); err != nil {
			t.Fatal(err)
		}
	}
	// SaaS polling and unparseable addresses are not senders.
	_ = svc.Record(ctx, "1.19.5", "", "saas", "192.0.2.9")
	_ = svc.Record(ctx, "1.19.5", "abc", "selfhost", "not-an-ip")

	got, err := svc.SelfHostSummary(ctx, 12, 14)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Weeks) != 1 || got.Weeks[0].Week != "2026-10-26" || got.Weeks[0].Installs != 3 || !got.Weeks[0].Partial {
		t.Fatalf("weeks = %+v, want one partial week 2026-10-26 with 3 installs", got.Weeks)
	}
	if len(got.Versions) != 1 || got.Versions[0].Pings != 5 {
		t.Fatalf("versions = %+v, want 1.19.5 with 5 self-host pings", got.Versions)
	}
	// Only hashes are stored, never the address.
	if n := count(`SELECT COUNT(*) FROM update_ping_week_senders WHERE sender LIKE '%203.0.113%'`); n != 0 {
		t.Fatalf("found %d raw IPs in senders", n)
	}
}

func TestUpdatePing_WeekRolloverKeepsTotalAndDeletesKeyAndHashes(t *testing.T) {
	now := time.Date(2026, 10, 25, 23, 0, 0, 0, time.UTC) // Sunday, week of 2026-10-19
	svc, count := newPingService(t, &now)
	ctx := context.Background()

	_ = svc.Record(ctx, "1.19.3", "", "selfhost", "203.0.113.7")
	_ = svc.Record(ctx, "1.19.3", "", "selfhost", "198.51.100.2")

	now = now.Add(2 * time.Hour) // Monday 01:00, new week
	_ = svc.Record(ctx, "1.19.3", "", "selfhost", "203.0.113.7")

	if n := count(`SELECT COUNT(*) FROM update_ping_week_key WHERE week < '2026-10-26'`); n != 0 {
		t.Fatalf("old week key not deleted")
	}
	if n := count(`SELECT COUNT(*) FROM update_ping_week_senders WHERE week < '2026-10-26'`); n != 0 {
		t.Fatalf("old week hashes not deleted")
	}
	if n := count(`SELECT installs FROM selfhost_weekly_installs WHERE week = '2026-10-19'`); n != 2 {
		t.Fatalf("kept total = %d, want 2", n)
	}

	got, err := svc.SelfHostSummary(ctx, 12, 14)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Weeks) != 2 || got.Weeks[0].Installs != 2 || got.Weeks[0].Partial ||
		got.Weeks[1].Installs != 1 || !got.Weeks[1].Partial {
		t.Fatalf("weeks = %+v", got.Weeks)
	}
}

func TestUpdatePing_SummaryRollsOverWithoutNewPings(t *testing.T) {
	now := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	svc, count := newPingService(t, &now)
	ctx := context.Background()
	_ = svc.Record(ctx, "1.19.0", "", "selfhost", "203.0.113.7")

	now = now.AddDate(0, 0, 9) // a later week, no ping since
	if _, err := svc.SelfHostSummary(ctx, 12, 14); err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT COUNT(*) FROM update_ping_week_senders`); n != 0 {
		t.Fatalf("hashes from a finished week survived a summary read")
	}
	if n := count(`SELECT COUNT(*) FROM update_ping_week_key WHERE week < '2026-10-26'`); n != 0 {
		t.Fatalf("key from a finished week survived a summary read")
	}
}

func TestWeekStart(t *testing.T) {
	for in, want := range map[string]string{
		"2026-10-26T00:00:00Z": "2026-10-26", // Monday
		"2026-11-01T23:59:59Z": "2026-10-26", // Sunday
		"2026-11-02T00:00:00Z": "2026-11-02",
		"2027-01-01T12:00:00Z": "2026-12-28", // across a year
	} {
		ts, _ := time.Parse(time.RFC3339, in)
		if got := weekStart(ts); got != want {
			t.Errorf("weekStart(%s) = %s, want %s", in, got, want)
		}
	}
}
