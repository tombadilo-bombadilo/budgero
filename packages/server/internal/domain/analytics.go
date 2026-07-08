package domain

import "time"

// RewardsAnalyticsGranularity controls how the analytics endpoint buckets
// timestamps. Valid: "daily", "weekly", "monthly".
type RewardsAnalyticsGranularity string

// Granularity values accepted by the analytics endpoint.
const (
	RewardsGranularityDaily   RewardsAnalyticsGranularity = "daily"
	RewardsGranularityWeekly  RewardsAnalyticsGranularity = "weekly"
	RewardsGranularityMonthly RewardsAnalyticsGranularity = "monthly"
)

// IsValid reports whether g is a known granularity.
func (g RewardsAnalyticsGranularity) IsValid() bool {
	switch g {
	case RewardsGranularityDaily, RewardsGranularityWeekly, RewardsGranularityMonthly:
		return true
	}
	return false
}

// RewardsAnalyticsParams scopes the analytics query.
type RewardsAnalyticsParams struct {
	From        time.Time
	To          time.Time
	Granularity RewardsAnalyticsGranularity
}

// TimeSeriesPoint is one bucketed metric value.
type TimeSeriesPoint struct {
	Period string `json:"period"`
	Count  int64  `json:"count"`
}

// RewardsAnalyticsSeries holds the per-metric time series.
type RewardsAnalyticsSeries struct {
	Signups       []TimeSeriesPoint `json:"signups"`
	Subscriptions []TimeSeriesPoint `json:"subscriptions"`
	Tier1Unlocks  []TimeSeriesPoint `json:"tier1_unlocks"`
	Tier2Unlocks  []TimeSeriesPoint `json:"tier2_unlocks"`
	Tier3Unlocks  []TimeSeriesPoint `json:"tier3_unlocks"`
	Redemptions   []TimeSeriesPoint `json:"redemptions"`
}

// FunnelCohort is one signup-cohort bucket.
type FunnelCohort struct {
	Cohort     string `json:"cohort"`
	Signups    int64  `json:"signups"`
	Tier1      int64  `json:"tier1"`
	Tier2      int64  `json:"tier2"`
	Tier3      int64  `json:"tier3"`
	Subscribed int64  `json:"subscribed"`
}

// RewardsAnalytics is the aggregated analytics response.
type RewardsAnalytics struct {
	Granularity RewardsAnalyticsGranularity `json:"granularity"`
	From        time.Time                   `json:"from"`
	To          time.Time                   `json:"to"`
	Series      RewardsAnalyticsSeries      `json:"series"`
	Funnel      []FunnelCohort              `json:"funnel"`
}
