package application

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/sqlite"
	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/domain"
)

func signupTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "signups.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := sqlite.Migrate(db); err != nil {
		t.Fatal(err)
	}
	return db
}

// Zero-filled buckets must carry the same labels SQLite produces, or a
// bucket with signups would show up twice (once zero, once counted).
func TestPeriodLabelMatchesSQLiteStrftime(t *testing.T) {
	db := signupTestDB(t)
	day := time.Date(2025, 12, 20, 0, 0, 0, 0, time.UTC)
	for i := 0; i < 800; i++ {
		d := day.AddDate(0, 0, i)
		for _, g := range []domain.AnalyticsGranularity{
			domain.AnalyticsGranularityDaily, domain.AnalyticsGranularityWeekly, domain.AnalyticsGranularityMonthly,
		} {
			var want string
			if err := db.QueryRow(`SELECT strftime(?, ?)`, strftimeFormatFor(g), d.Format("2006-01-02 15:04:05")).Scan(&want); err != nil {
				t.Fatal(err)
			}
			if got := periodLabel(d, g); got != want {
				t.Fatalf("%s %s: got %s, SQLite %s", d.Format("2006-01-02"), g, got, want)
			}
		}
	}
}

func TestGetSignupSeries(t *testing.T) {
	db := signupTestDB(t)
	for i, at := range []string{
		"2026-10-05 09:00:00", "2026-10-05 22:00:00", // Mon
		"2026-10-07 10:00:00",                       // Wed
		"2026-10-13 08:00:00",                       // next week
		"2026-10-31 23:59:00.1234 +0000 UTC m=+5.1", // last day of range (Go time string, as in prod)
		"2026-11-01 00:00:00.5 +0000 UTC m=+1.2",    // after the range
	} {
		if _, err := db.Exec(`INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`,
			"u"+string(rune('a'+i)), "u"+string(rune('a'+i))+"@example.com", at); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO users (id, email, created_at) VALUES ('c', 'x@clerk.user', '2026-10-06 10:00:00')`); err != nil {
		t.Fatal(err)
	}
	svc := &AdminService{queries: sqlc.New(db)}
	from := time.Date(2026, 10, 1, 15, 0, 0, 0, time.UTC) // time of day ignored
	to := time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC)

	daily, err := svc.GetSignupSeries(context.Background(), from, to, domain.AnalyticsGranularityDaily)
	if err != nil {
		t.Fatal(err)
	}
	if len(daily.Points) != 31 || daily.Total != 5 {
		t.Fatalf("daily: %d points, total %d; want 31, 5", len(daily.Points), daily.Total)
	}
	if p := daily.Points[4]; p.Start != "2026-10-05" || p.Signups != 2 {
		t.Fatalf("Oct 5 = %+v", p)
	}

	weekly, err := svc.GetSignupSeries(context.Background(), from, to, domain.AnalyticsGranularityWeekly)
	if err != nil {
		t.Fatal(err)
	}
	got := make([]int64, 0, len(weekly.Points))
	for _, p := range weekly.Points {
		got = append(got, p.Signups)
	}
	// Oct 1–4 (partial), 5–11, 12–18, 19–25, 26–31.
	want := []int64{0, 3, 1, 0, 1}
	if len(got) != len(want) || weekly.Points[0].Start != "2026-10-01" || weekly.Points[1].Start != "2026-10-05" {
		t.Fatalf("weekly = %+v", weekly.Points)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("weekly counts = %v, want %v", got, want)
		}
	}

	monthly, err := svc.GetSignupSeries(context.Background(), from, to, domain.AnalyticsGranularityMonthly)
	if err != nil {
		t.Fatal(err)
	}
	if len(monthly.Points) != 1 || monthly.Points[0].Signups != 5 {
		t.Fatalf("monthly = %+v", monthly.Points)
	}
}
