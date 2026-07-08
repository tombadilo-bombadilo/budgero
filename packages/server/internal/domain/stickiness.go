package domain

import "time"

// StickinessAnalyticsParams scopes the stickiness analytics query.
//
// CohortGranularity controls the bucketing of signup cohorts (daily/weekly/
// monthly). MaxDayN caps how many post-signup days are included in the
// retention matrix; reasonable values are 30, 60, 90.
type StickinessAnalyticsParams struct {
	From              time.Time
	To                time.Time
	CohortGranularity RewardsAnalyticsGranularity
	MaxDayN           int
}

// StickinessSeriesPoint is one (day, DAU, MAU) sample.
//
// `Stickiness` is `DAU/MAU` rendered server-side for convenience; clients
// should still treat it as a derived value (it can be NaN when MAU=0,
// serialized here as 0).
type StickinessSeriesPoint struct {
	Day        string  `json:"day"`
	DAU        int64   `json:"dau"`
	MAU        int64   `json:"mau"`
	Stickiness float64 `json:"stickiness"`
}

// CohortRetentionCell is one (cohort, day_n) retention sample.
//
// `Active` is the number of cohort members active on day N after signup.
// `CohortSize` repeats per row for client convenience.
type CohortRetentionCell struct {
	Cohort     string  `json:"cohort"`
	DayN       int     `json:"day_n"`
	Active     int64   `json:"active"`
	CohortSize int64   `json:"cohort_size"`
	Retention  float64 `json:"retention"`
}

// CohortRetentionMatrix is the full per-cohort retention payload.
type CohortRetentionMatrix struct {
	// Cells is the dense grid of (cohort, day_n) → retention.
	// Sparse entries (zero retention) are included so the client can render
	// a heatmap without fill-in logic.
	Cells []CohortRetentionCell `json:"cells"`
	// Cohorts lists every cohort label in chronological order so the
	// client knows the row ordering and which cohorts appear at all.
	Cohorts []CohortMeta `json:"cohorts"`
	// MaxDayN is echoed back so clients know the column extent.
	MaxDayN int `json:"max_day_n"`
}

// CohortMeta describes one signup cohort.
type CohortMeta struct {
	Cohort string `json:"cohort"`
	Size   int64  `json:"size"`
}

// StickinessAnalytics is the aggregated response.
//
// `Current` is the headline DAU/MAU at the latest day in the series,
// duplicated from the last entry of `Series` for ease of display.
type StickinessAnalytics struct {
	From              time.Time                  `json:"from"`
	To                time.Time                  `json:"to"`
	CohortGranularity RewardsAnalyticsGranularity `json:"cohort_granularity"`
	Current           StickinessSeriesPoint      `json:"current"`
	Series            []StickinessSeriesPoint    `json:"series"`
	Cohorts           CohortRetentionMatrix      `json:"cohorts"`
}
