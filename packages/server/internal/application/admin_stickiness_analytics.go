package application

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"time"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/domain"
)

// GetStickinessAnalytics computes a DAU/MAU stickiness time series and a
// signup-cohort retention matrix.
//
// Day series: for each day d in [params.From, params.To], DAU(d) is distinct
// users active on d, MAU(d) is distinct users active in [d-29, d], and
// stickiness(d) = DAU(d)/MAU(d). MAU is computed via one cheap COUNT(DISTINCT)
// per day rather than a giant CTE because the admin window is bounded
// (~90 days) and SQLite struggles with rolling distinct counts.
//
// Cohort matrix: each user is bucketed by `strftime(<fmt>, created_at)` and
// then for each day_n (0..MaxDayN) we count the distinct cohort members
// active on that day-since-signup. Retention = active/cohort_size.
func (s *AdminService) GetStickinessAnalytics(ctx context.Context, p domain.StickinessAnalyticsParams) (*domain.StickinessAnalytics, error) {
	if !p.CohortGranularity.IsValid() {
		return nil, fmt.Errorf("invalid cohort granularity: %q", p.CohortGranularity)
	}
	if !p.From.Before(p.To) {
		return nil, fmt.Errorf("from must be before to")
	}
	if p.MaxDayN <= 0 {
		return nil, fmt.Errorf("max day_n must be positive")
	}
	if s.queries == nil {
		return nil, fmt.Errorf("stickiness analytics requires *sqlc.Queries; not wired")
	}

	from := truncateToDay(p.From)
	to := truncateToDay(p.To)

	// DAU per day in [from, to]. Result is sparse — days with zero activity
	// don't appear; we densify below.
	dauRows, err := s.queries.AnalyticsDAUByDayInRange(ctx, sqlc.AnalyticsDAUByDayInRangeParams{
		Day:   formatDay(from),
		Day_2: formatDay(to),
	})
	if err != nil {
		return nil, fmt.Errorf("dau: %w", err)
	}
	dauByDay := make(map[string]int64, len(dauRows))
	for _, r := range dauRows {
		dauByDay[r.Day] = r.Dau
	}

	// MAU rolling 30-day per day. One small query per day; cheap on 90-day
	// windows and avoids fragile recursive CTEs.
	series := make([]domain.StickinessSeriesPoint, 0)
	for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
		mauStart := d.AddDate(0, 0, -29)
		mau, mauErr := s.queries.AnalyticsMAURollingForDay(ctx, sqlc.AnalyticsMAURollingForDayParams{
			FromDay: formatDay(mauStart),
			ToDay:   formatDay(d),
		})
		if mauErr != nil {
			return nil, fmt.Errorf("mau on %s: %w", formatDay(d), mauErr)
		}
		dau := dauByDay[formatDay(d)]
		stickiness := 0.0
		if mau > 0 {
			stickiness = float64(dau) / float64(mau)
		}
		series = append(series, domain.StickinessSeriesPoint{
			Day:        formatDay(d),
			DAU:        dau,
			MAU:        mau,
			Stickiness: stickiness,
		})
	}

	// Cohort matrix. Sizes first so we know the denominator for every cell.
	fmtStr := strftimeFormatFor(p.CohortGranularity)
	createdAt := sql.NullTime{Time: from, Valid: true}

	sizeRows, err := s.queries.AnalyticsCohortSizes(ctx, sqlc.AnalyticsCohortSizesParams{
		Strftime:  fmtStr,
		CreatedAt: createdAt,
	})
	if err != nil {
		return nil, fmt.Errorf("cohort sizes: %w", err)
	}
	cohortSize := make(map[string]int64, len(sizeRows))
	cohorts := make([]domain.CohortMeta, 0, len(sizeRows))
	for _, r := range sizeRows {
		label := anyToPeriodString(r.Cohort)
		if label == "" {
			continue
		}
		cohortSize[label] = r.Size
		cohorts = append(cohorts, domain.CohortMeta{Cohort: label, Size: r.Size})
	}
	sort.Slice(cohorts, func(i, j int) bool { return cohorts[i].Cohort < cohorts[j].Cohort })

	retentionRows, err := s.queries.AnalyticsCohortRetention(ctx, sqlc.AnalyticsCohortRetentionParams{
		Strftime:  fmtStr,
		CreatedAt: createdAt,
		Column3:   int64(p.MaxDayN),
	})
	if err != nil {
		return nil, fmt.Errorf("cohort retention: %w", err)
	}
	cells := make([]domain.CohortRetentionCell, 0, len(retentionRows))
	for _, r := range retentionRows {
		label := anyToPeriodString(r.Cohort)
		size := cohortSize[label]
		if size <= 0 {
			continue
		}
		cells = append(cells, domain.CohortRetentionCell{
			Cohort:     label,
			DayN:       int(r.DayN),
			Active:     r.Active,
			CohortSize: size,
			Retention:  float64(r.Active) / float64(size),
		})
	}

	current := domain.StickinessSeriesPoint{Day: formatDay(to)}
	if len(series) > 0 {
		current = series[len(series)-1]
	}

	return &domain.StickinessAnalytics{
		From:              from,
		To:                to,
		CohortGranularity: p.CohortGranularity,
		Current:           current,
		Series:            series,
		Cohorts: domain.CohortRetentionMatrix{
			Cells:   cells,
			Cohorts: cohorts,
			MaxDayN: p.MaxDayN,
		},
	}, nil
}

// truncateToDay drops the time-of-day so day-string lookups line up with
// the YYYY-MM-DD strings stored in user_daily_activity.day.
func truncateToDay(t time.Time) time.Time {
	utc := t.UTC()
	return time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC)
}

func formatDay(t time.Time) string {
	return t.Format("2006-01-02")
}
