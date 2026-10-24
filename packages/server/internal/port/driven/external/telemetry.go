package external

import (
	"context"
	"time"
)

// Telemetry records aggregate server metrics (e.g. OpenTelemetry → PostHog
// Metrics). Every method takes bounded enums and numbers only: no user ids,
// space ids, emails, IPs or raw paths can reach an exporter through it.
//
// Implementations must be safe for concurrent use and cheap when disabled.
type Telemetry interface {
	HTTPTelemetry
	SyncTelemetry
	AnalyticsTelemetry

	// Enabled reports whether metrics leave the server.
	Enabled() bool

	// Shutdown flushes pending data points and stops exporting.
	Shutdown(ctx context.Context) error
}

// HTTPTelemetry records API requests.
type HTTPTelemetry interface {
	// HTTPRequest records one finished request. route is the router's route
	// template (e.g. /api/v1/budget-spaces/:spaceID), never the raw path.
	// recordDuration is false for health checks and long-lived (WebSocket)
	// routes, which would only add noise to the latency histogram.
	HTTPRequest(route, method string, status int, d time.Duration, recordDuration bool)
}

// Fixed HTTPRequest route values for requests without an API route template.
const (
	RouteStatic    = "static"    // embedded PWA assets and the SPA shell
	RouteUnmatched = "unmatched" // /api/ paths with no registered route
)

// WSOutcome is the result of one sync WebSocket connection attempt.
type WSOutcome string

// WebSocket connection attempt outcomes.
const (
	WSOutcomeOK              WSOutcome = "ok"
	WSOutcomeUnauthenticated WSOutcome = "unauthenticated"
	WSOutcomeForbidden       WSOutcome = "forbidden"
	WSOutcomeBlocked         WSOutcome = "blocked"
	WSOutcomeUpgradeRequired WSOutcome = "upgrade_required"
	WSOutcomeError           WSOutcome = "error"
)

// MutationOutcome is what happened to one mutation received over the socket.
type MutationOutcome string

// Mutation outcomes.
const (
	MutationAppended        MutationOutcome = "appended"
	MutationRejectedInvalid MutationOutcome = "rejected_invalid"
	MutationRejectedError   MutationOutcome = "rejected_error"
)

// BlobUploadOutcome is the result of one snapshot blob upload.
type BlobUploadOutcome string

// Snapshot blob upload outcomes.
const (
	BlobUploadOK          BlobUploadOutcome = "ok"
	BlobUploadCASConflict BlobUploadOutcome = "cas_conflict"
	// BlobUploadRejected covers client-side refusals: empty or oversized body,
	// stale encryption key, outdated data format.
	BlobUploadRejected BlobUploadOutcome = "rejected"
	BlobUploadError    BlobUploadOutcome = "error"
)

// SyncTelemetry records WebSocket sync and snapshot blob activity.
type SyncTelemetry interface {
	WSConnectAttempt(outcome WSOutcome)
	MutationReceived()
	MutationProcessed(outcome MutationOutcome)
	CatchUpRequested()
	// BlobUpload records one upload; bytes is the body size (0 when unread).
	BlobUpload(outcome BlobUploadOutcome, bytes int64, d time.Duration)
	// ObserveWSConnections registers a callback that reports the number of
	// open sync sockets whenever metrics are collected.
	ObserveWSConnections(count func() int64)
}

// AnalyticsTelemetry records the health of the product analytics pipeline.
type AnalyticsTelemetry interface {
	// ObserveAnalyticsQueue registers callbacks for the current queue depth
	// and the running total of events dropped because the queue was full.
	ObserveAnalyticsQueue(depth, dropped func() int64)
	AnalyticsBatchSent(events int)
	AnalyticsSendError()
}

// NoopTelemetry drops everything. Used for self-host, unset config and tests.
type NoopTelemetry struct{}

var _ Telemetry = NoopTelemetry{}

// Enabled reports false.
func (NoopTelemetry) Enabled() bool { return false }

// Shutdown does nothing.
func (NoopTelemetry) Shutdown(context.Context) error { return nil }

// HTTPRequest does nothing.
func (NoopTelemetry) HTTPRequest(string, string, int, time.Duration, bool) {}

// WSConnectAttempt does nothing.
func (NoopTelemetry) WSConnectAttempt(WSOutcome) {}

// MutationReceived does nothing.
func (NoopTelemetry) MutationReceived() {}

// MutationProcessed does nothing.
func (NoopTelemetry) MutationProcessed(MutationOutcome) {}

// CatchUpRequested does nothing.
func (NoopTelemetry) CatchUpRequested() {}

// BlobUpload does nothing.
func (NoopTelemetry) BlobUpload(BlobUploadOutcome, int64, time.Duration) {}

// ObserveWSConnections does nothing.
func (NoopTelemetry) ObserveWSConnections(func() int64) {}

// ObserveAnalyticsQueue does nothing.
func (NoopTelemetry) ObserveAnalyticsQueue(func() int64, func() int64) {}

// AnalyticsBatchSent does nothing.
func (NoopTelemetry) AnalyticsBatchSent(int) {}

// AnalyticsSendError does nothing.
func (NoopTelemetry) AnalyticsSendError() {}
