package domain

// AnalyticsGranularity controls how the analytics endpoints bucket
// timestamps. Valid: "daily", "weekly", "monthly".
type AnalyticsGranularity string

// Granularity values accepted by the analytics endpoints.
const (
	AnalyticsGranularityDaily   AnalyticsGranularity = "daily"
	AnalyticsGranularityWeekly  AnalyticsGranularity = "weekly"
	AnalyticsGranularityMonthly AnalyticsGranularity = "monthly"
)

// IsValid reports whether g is a known granularity.
func (g AnalyticsGranularity) IsValid() bool {
	switch g {
	case AnalyticsGranularityDaily, AnalyticsGranularityWeekly, AnalyticsGranularityMonthly:
		return true
	}
	return false
}

// TimeSeriesPoint is one bucketed metric value.
type TimeSeriesPoint struct {
	Period string `json:"period"`
	Count  int64  `json:"count"`
}

// SignupSeries is signups per period over an inclusive UTC date range.
type SignupSeries struct {
	From        string               `json:"from"` // YYYY-MM-DD, inclusive
	To          string               `json:"to"`   // YYYY-MM-DD, inclusive
	Granularity AnalyticsGranularity `json:"granularity"`
	Total       int64                `json:"total"`
	Points      []SignupPoint        `json:"points"`
}

// SignupPoint is one bucket. Start is the bucket's first day inside the
// range, so a week or month cut by the range edge starts at the edge.
type SignupPoint struct {
	Period  string `json:"period"`
	Start   string `json:"start"`
	Signups int64  `json:"signups"`
}
