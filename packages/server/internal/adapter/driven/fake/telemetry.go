package fake

import (
	"context"
	"sync"
	"time"

	"budgero-server/internal/port/driven/external"
)

// HTTPPoint is one HTTPRequest call recorded by Telemetry.
type HTTPPoint struct {
	Route          string
	Method         string
	Status         int
	RecordDuration bool
}

// TelemetrySnapshot is a copy of what Telemetry has recorded.
type TelemetrySnapshot struct {
	HTTP        []HTTPPoint
	WSAttempts  []external.WSOutcome
	Received    int
	Processed   []external.MutationOutcome
	CatchUps    int
	Blobs       []external.BlobUploadOutcome
	BlobBytes   []int64
	SentEvents  int
	SendErrors  int
	ShutdownHit bool
}

// Telemetry records every call for assertions. Safe for concurrent use.
type Telemetry struct {
	mu         sync.Mutex
	rec        TelemetrySnapshot
	wsCount    func() int64
	queueDepth func() int64
	queueDrops func() int64
}

var _ external.Telemetry = (*Telemetry)(nil)

// Enabled reports true.
func (t *Telemetry) Enabled() bool { return true }

// Shutdown records the call.
func (t *Telemetry) Shutdown(context.Context) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.rec.ShutdownHit = true
	return nil
}

// HTTPRequest records the call.
func (t *Telemetry) HTTPRequest(route, method string, status int, _ time.Duration, recordDuration bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.rec.HTTP = append(t.rec.HTTP, HTTPPoint{Route: route, Method: method, Status: status, RecordDuration: recordDuration})
}

// WSConnectAttempt records the call.
func (t *Telemetry) WSConnectAttempt(o external.WSOutcome) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.rec.WSAttempts = append(t.rec.WSAttempts, o)
}

// MutationReceived records the call.
func (t *Telemetry) MutationReceived() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.rec.Received++
}

// MutationProcessed records the call.
func (t *Telemetry) MutationProcessed(o external.MutationOutcome) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.rec.Processed = append(t.rec.Processed, o)
}

// CatchUpRequested records the call.
func (t *Telemetry) CatchUpRequested() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.rec.CatchUps++
}

// BlobUpload records the call.
func (t *Telemetry) BlobUpload(o external.BlobUploadOutcome, bytes int64, _ time.Duration) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.rec.Blobs = append(t.rec.Blobs, o)
	t.rec.BlobBytes = append(t.rec.BlobBytes, bytes)
}

// ObserveWSConnections stores the callback.
func (t *Telemetry) ObserveWSConnections(count func() int64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.wsCount = count
}

// ObserveAnalyticsQueue stores the callbacks.
func (t *Telemetry) ObserveAnalyticsQueue(depth, dropped func() int64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.queueDepth, t.queueDrops = depth, dropped
}

// AnalyticsBatchSent records the call.
func (t *Telemetry) AnalyticsBatchSent(n int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.rec.SentEvents += n
}

// AnalyticsSendError records the call.
func (t *Telemetry) AnalyticsSendError() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.rec.SendErrors++
}

// WSConnections calls the registered gauge callback (-1 when none).
func (t *Telemetry) WSConnections() int64 {
	t.mu.Lock()
	f := t.wsCount
	t.mu.Unlock()
	if f == nil {
		return -1
	}
	return f()
}

// AnalyticsQueue calls the registered queue callbacks (-1, -1 when none).
func (t *Telemetry) AnalyticsQueue() (depth, dropped int64) {
	t.mu.Lock()
	d, x := t.queueDepth, t.queueDrops
	t.mu.Unlock()
	if d == nil || x == nil {
		return -1, -1
	}
	return d(), x()
}

// Snapshot returns a copy of everything recorded so far.
func (t *Telemetry) Snapshot() TelemetrySnapshot {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := t.rec
	out.HTTP = append([]HTTPPoint(nil), t.rec.HTTP...)
	out.WSAttempts = append([]external.WSOutcome(nil), t.rec.WSAttempts...)
	out.Processed = append([]external.MutationOutcome(nil), t.rec.Processed...)
	out.Blobs = append([]external.BlobUploadOutcome(nil), t.rec.Blobs...)
	out.BlobBytes = append([]int64(nil), t.rec.BlobBytes...)
	return out
}
