package external

import (
	"context"
	"time"
)

// AnalyticsEvent is one event ready to leave the server. Properties are
// already restricted to registered enum values (see domain/analytics).
type AnalyticsEvent struct {
	Name       string
	DistinctID string
	Properties map[string]string
	// Payload holds structured properties (nested JSON, e.g. the
	// $exception_list of a server exception). Merged after Properties.
	Payload   map[string]any
	Timestamp time.Time
}

// AnalyticsSender ships batches of product analytics events (e.g. PostHog).
type AnalyticsSender interface {
	// Enabled reports whether events go anywhere. A disabled sender (self-host,
	// no key) makes the tracker drop events before they are queued.
	Enabled() bool

	// Send delivers one batch. It must honor ctx and never retry forever.
	Send(ctx context.Context, events []AnalyticsEvent) error
}
