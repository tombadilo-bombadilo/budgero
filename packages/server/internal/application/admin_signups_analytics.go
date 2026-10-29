package application

import (
	"context"
	"fmt"
	"time"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/domain"
)

// GetSignupSeries counts signups per day, week or month for the UTC days
// from..to (both inclusive, time of day ignored). Every bucket in the range
// is present, zero-filled, oldest first.
func (s *AdminService) GetSignupSeries(ctx context.Context, from, to time.Time, g domain.AnalyticsGranularity) (*domain.SignupSeries, error) {
	if !g.IsValid() {
		return nil, fmt.Errorf("invalid granularity: %q", g)
	}
	if s.queries == nil {
		return nil, fmt.Errorf("analytics queries not configured")
	}
	from = utcDay(from)
	to = utcDay(to)
	if to.Before(from) {
		return nil, fmt.Errorf("to is before from")
	}
	end := to.AddDate(0, 0, 1)

	rows, err := s.queries.AnalyticsSignupsByPeriod(ctx, sqlc.AnalyticsSignupsByPeriodParams{
		PeriodFormat: strftimeFormatFor(g),
		FromAt:       from.Format(time.DateTime),
		ToAt:         end.Format(time.DateTime),
	})
	if err != nil {
		return nil, fmt.Errorf("signups by period: %w", err)
	}
	counts := make(map[string]int64, len(rows))
	for _, r := range rows {
		counts[anyToPeriodString(r.Period)] = r.Signups
	}

	out := &domain.SignupSeries{
		From:        from.Format("2006-01-02"),
		To:          to.Format("2006-01-02"),
		Granularity: g,
		Points:      []domain.SignupPoint{},
	}
	for d := from; d.Before(end); d = d.AddDate(0, 0, 1) {
		label := periodLabel(d, g)
		if n := len(out.Points); n > 0 && out.Points[n-1].Period == label {
			continue
		}
		out.Points = append(out.Points, domain.SignupPoint{
			Period: label, Start: d.Format("2006-01-02"), Signups: counts[label],
		})
		out.Total += counts[label]
	}
	return out, nil
}

func utcDay(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// periodLabel mirrors strftimeFormatFor in Go so zero-filled buckets match
// the labels SQLite returns. %W: week of the year, Monday first, days before
// the year's first Monday are week 00.
func periodLabel(d time.Time, g domain.AnalyticsGranularity) string {
	switch g {
	case domain.AnalyticsGranularityWeekly:
		mondayIndex := (int(d.Weekday()) + 6) % 7
		week := (d.YearDay() - 1 + 7 - mondayIndex) / 7
		return fmt.Sprintf("%04d-W%02d", d.Year(), week)
	case domain.AnalyticsGranularityMonthly:
		return d.Format("2006-01")
	default:
		return d.Format("2006-01-02")
	}
}
