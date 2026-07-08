package application

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/domain"
)

// strftimeFormatFor returns the SQLite strftime format string for a
// granularity. Output strings sort lexicographically — e.g. "2026-W17"
// sorts before "2026-W18".
func strftimeFormatFor(g domain.RewardsAnalyticsGranularity) string {
	switch g {
	case domain.RewardsGranularityWeekly:
		return "%Y-W%W"
	case domain.RewardsGranularityMonthly:
		return "%Y-%m"
	default:
		return "%Y-%m-%d"
	}
}

// GetRewardsAnalytics runs the per-metric time-series queries plus the
// signup-cohort funnel query and assembles the result. SaaS-only at the
// route layer; the queries themselves are harmless on self-host but the
// data won't be meaningful there.
func (s *AdminService) GetRewardsAnalytics(ctx context.Context, p domain.RewardsAnalyticsParams) (*domain.RewardsAnalytics, error) {
	if !p.Granularity.IsValid() {
		return nil, fmt.Errorf("invalid granularity: %q", p.Granularity)
	}
	if !p.From.Before(p.To) {
		return nil, fmt.Errorf("from must be before to")
	}
	if s.queries == nil {
		return nil, fmt.Errorf("admin analytics requires *sqlc.Queries; not wired")
	}

	fmtStr := strftimeFormatFor(p.Granularity)
	from := sql.NullTime{Time: p.From, Valid: true}
	to := sql.NullTime{Time: p.To, Valid: true}

	signups, err := s.queries.AnalyticsSignupsByPeriod(ctx, sqlc.AnalyticsSignupsByPeriodParams{
		Strftime: fmtStr, CreatedAt: from, CreatedAt_2: to,
	})
	if err != nil {
		return nil, fmt.Errorf("signups: %w", err)
	}
	subs, err := s.queries.AnalyticsSubscriptionsByPeriod(ctx, sqlc.AnalyticsSubscriptionsByPeriodParams{
		Strftime: fmtStr, SubscribedAt: from, SubscribedAt_2: to,
	})
	if err != nil {
		return nil, fmt.Errorf("subscriptions: %w", err)
	}
	t1, err := s.queries.AnalyticsTier1UnlocksByPeriod(ctx, sqlc.AnalyticsTier1UnlocksByPeriodParams{
		Strftime: fmtStr, Tier1UnlockedAt: from, Tier1UnlockedAt_2: to,
	})
	if err != nil {
		return nil, fmt.Errorf("tier1 unlocks: %w", err)
	}
	t2, err := s.queries.AnalyticsTier2UnlocksByPeriod(ctx, sqlc.AnalyticsTier2UnlocksByPeriodParams{
		Strftime: fmtStr, Tier2UnlockedAt: from, Tier2UnlockedAt_2: to,
	})
	if err != nil {
		return nil, fmt.Errorf("tier2 unlocks: %w", err)
	}
	t3, err := s.queries.AnalyticsTier3UnlocksByPeriod(ctx, sqlc.AnalyticsTier3UnlocksByPeriodParams{
		Strftime: fmtStr, Tier3UnlockedAt: from, Tier3UnlockedAt_2: to,
	})
	if err != nil {
		return nil, fmt.Errorf("tier3 unlocks: %w", err)
	}
	redemptions, err := s.queries.AnalyticsRedemptionsByPeriod(ctx, sqlc.AnalyticsRedemptionsByPeriodParams{
		Strftime: fmtStr, RedeemedAt: from, RedeemedAt_2: to,
	})
	if err != nil {
		return nil, fmt.Errorf("redemptions: %w", err)
	}
	funnelRows, err := s.queries.AnalyticsFunnelByCohort(ctx, sqlc.AnalyticsFunnelByCohortParams{
		Strftime: fmtStr, CreatedAt: from, CreatedAt_2: to,
	})
	if err != nil {
		return nil, fmt.Errorf("funnel: %w", err)
	}

	out := &domain.RewardsAnalytics{
		Granularity: p.Granularity,
		From:        p.From,
		To:          p.To,
		Series: domain.RewardsAnalyticsSeries{
			Signups: toPoints(signups, func(r sqlc.AnalyticsSignupsByPeriodRow) (interface{}, int64) {
				return r.Period, r.Count
			}),
			Subscriptions: toPoints(subs, func(r sqlc.AnalyticsSubscriptionsByPeriodRow) (interface{}, int64) {
				return r.Period, r.Count
			}),
			Tier1Unlocks: toPoints(t1, func(r sqlc.AnalyticsTier1UnlocksByPeriodRow) (interface{}, int64) {
				return r.Period, r.Count
			}),
			Tier2Unlocks: toPoints(t2, func(r sqlc.AnalyticsTier2UnlocksByPeriodRow) (interface{}, int64) {
				return r.Period, r.Count
			}),
			Tier3Unlocks: toPoints(t3, func(r sqlc.AnalyticsTier3UnlocksByPeriodRow) (interface{}, int64) {
				return r.Period, r.Count
			}),
			Redemptions: toPoints(redemptions, func(r sqlc.AnalyticsRedemptionsByPeriodRow) (interface{}, int64) {
				return r.Period, r.Count
			}),
		},
		Funnel: make([]domain.FunnelCohort, 0, len(funnelRows)),
	}
	for _, r := range funnelRows {
		out.Funnel = append(out.Funnel, domain.FunnelCohort{
			Cohort:     anyToPeriodString(r.Cohort),
			Signups:    r.Signups,
			Tier1:      r.Tier1,
			Tier2:      r.Tier2,
			Tier3:      r.Tier3,
			Subscribed: r.Subscribed,
		})
	}
	return out, nil
}

// toPoints normalizes sqlc's per-query (period, count) row structs into the
// shared TimeSeriesPoint shape. sqlc generates a distinct row struct per
// query (each has a different table-named "period" alias), so the extractor
// pulls the (period, count) pair out of whatever concrete row type T is.
func toPoints[T any](rows []T, extract func(T) (interface{}, int64)) []domain.TimeSeriesPoint {
	out := make([]domain.TimeSeriesPoint, 0, len(rows))
	for _, r := range rows {
		period, count := extract(r)
		out = append(out, domain.TimeSeriesPoint{Period: anyToPeriodString(period), Count: count})
	}
	return out
}

// anyToPeriodString safely converts the interface{} period column (sqlc
// can't infer a concrete type for strftime output) into a clean string.
func anyToPeriodString(v interface{}) string {
	switch s := v.(type) {
	case string:
		return s
	case []byte:
		return strings.TrimSpace(string(s))
	case nil:
		return ""
	default:
		return fmt.Sprintf("%v", s)
	}
}
