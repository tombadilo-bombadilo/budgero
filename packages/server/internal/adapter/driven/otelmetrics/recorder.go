// Package otelmetrics implements external.Telemetry with the OpenTelemetry
// metrics SDK, exporting OTLP/HTTP to PostHog Metrics (cloud only).
//
// Only aggregate, bounded attributes are recorded: route templates, methods,
// status classes and fixed outcome enums. Nothing user-identifying is ever
// attached, and unknown values collapse to "other".
package otelmetrics

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"budgero-server/internal/port/driven/external"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/contrib/instrumentation/runtime"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
)

// ServiceName is the service.name resource attribute.
const ServiceName = "budgero-server"

// Defaults for the periodic export.
const (
	DefaultInterval = 60 * time.Second
	DefaultTimeout  = 10 * time.Second
	// cardinalityLimit caps series per instrument; overflow lands in one
	// otel.metric.overflow series instead of growing without bound.
	cardinalityLimit = 300
	meterName        = "budgero-server"
	otherValue       = "other"
)

// Options configures New. The exporter is only built when Enabled is true,
// SelfHost is false and both Endpoint and Token are set; otherwise New returns
// a no-op that starts nothing.
type Options struct {
	Enabled        bool
	SelfHost       bool
	Endpoint       string // full OTLP/HTTP metrics URL, e.g. https://eu.i.posthog.com/i/v1/metrics
	Token          string // PostHog project token (phc_…)
	ServiceVersion string
	Interval       time.Duration // default DefaultInterval
	Timeout        time.Duration // default DefaultTimeout
}

// Active reports whether o turns exporting on.
func (o Options) Active() bool {
	return o.Enabled && !o.SelfHost &&
		strings.TrimSpace(o.Endpoint) != "" && strings.TrimSpace(o.Token) != ""
}

// New returns the OTLP recorder, or external.NoopTelemetry when o is not
// Active. A disabled config never builds an exporter, a reader or a goroutine.
func New(ctx context.Context, o Options) (external.Telemetry, error) {
	if !o.Active() {
		return external.NoopTelemetry{}, nil
	}
	endpoint := strings.TrimSpace(o.Endpoint)
	u, err := url.Parse(endpoint)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return external.NoopTelemetry{}, fmt.Errorf("otelmetrics: invalid endpoint %q", endpoint)
	}
	if o.Interval <= 0 {
		o.Interval = DefaultInterval
	}
	if o.Timeout <= 0 {
		o.Timeout = DefaultTimeout
	}
	exp, err := otlpmetrichttp.New(ctx,
		otlpmetrichttp.WithEndpointURL(endpoint),
		otlpmetrichttp.WithHeaders(map[string]string{"Authorization": "Bearer " + strings.TrimSpace(o.Token)}),
		otlpmetrichttp.WithTimeout(o.Timeout),
		otlpmetrichttp.WithTemporalitySelector(deltaTemporality),
		otlpmetrichttp.WithHTTPClient(&http.Client{Timeout: o.Timeout}),
		otlpmetrichttp.WithRetry(otlpmetrichttp.RetryConfig{
			Enabled:         true,
			InitialInterval: 2 * time.Second,
			MaxInterval:     10 * time.Second,
			MaxElapsedTime:  30 * time.Second,
		}),
	)
	if err != nil {
		return external.NoopTelemetry{}, fmt.Errorf("otelmetrics: build exporter: %w", err)
	}
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(err error) {
		log.Warn().Err(err).Msg("metrics export failed")
	}))
	reader := sdkmetric.NewPeriodicReader(exp, sdkmetric.WithInterval(o.Interval), sdkmetric.WithTimeout(o.Timeout))
	return newRecorder(ctx, reader, o.ServiceVersion, true)
}

// deltaTemporality matches what PostHog's own SDKs send: counters and
// histograms as deltas, up-down counters cumulative.
func deltaTemporality(kind sdkmetric.InstrumentKind) metricdata.Temporality {
	switch kind {
	case sdkmetric.InstrumentKindUpDownCounter, sdkmetric.InstrumentKindObservableUpDownCounter:
		return metricdata.CumulativeTemporality
	default:
		return metricdata.DeltaTemporality
	}
}

// Recorder records server metrics on an OpenTelemetry meter provider.
type Recorder struct {
	provider *sdkmetric.MeterProvider
	meter    metric.Meter

	httpRequests metric.Int64Counter
	httpDuration metric.Float64Histogram

	wsAttempts       metric.Int64Counter
	wsActive         metric.Int64ObservableGauge
	mutationsIn      metric.Int64Counter
	mutationsOut     metric.Int64Counter
	catchUps         metric.Int64Counter
	blobUploads      metric.Int64Counter
	blobSize         metric.Int64Histogram
	blobDuration     metric.Float64Histogram
	analyticsDepth   metric.Int64ObservableGauge
	analyticsDropped metric.Int64ObservableCounter
	analyticsSent    metric.Int64Counter
	analyticsErrors  metric.Int64Counter
}

var _ external.Telemetry = (*Recorder)(nil)

// NewWithReader builds a recorder on reader (e.g. sdkmetric.NewManualReader)
// without any exporter. Used by tests to inspect what would be exported.
func NewWithReader(reader sdkmetric.Reader, serviceVersion string) (*Recorder, error) {
	return newRecorder(context.Background(), reader, serviceVersion, false)
}

func newRecorder(ctx context.Context, reader sdkmetric.Reader, serviceVersion string, withRuntime bool) (*Recorder, error) {
	if serviceVersion == "" {
		serviceVersion = "unknown"
	}
	res := resource.NewWithAttributes(semconv.SchemaURL,
		semconv.ServiceName(ServiceName),
		semconv.ServiceVersion(serviceVersion),
	)
	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithResource(res),
		sdkmetric.WithReader(reader),
		sdkmetric.WithCardinalityLimit(cardinalityLimit),
	)
	r := &Recorder{provider: mp, meter: mp.Meter(meterName)}
	if err := r.initInstruments(); err != nil {
		_ = mp.Shutdown(ctx)
		return nil, err
	}
	if withRuntime {
		// Callback-based Go runtime metrics (go.memory.*, go.goroutine.count,
		// go.processor.limit, go.config.gogc); read at collection time only.
		if err := runtime.Start(runtime.WithMeterProvider(mp)); err != nil {
			_ = mp.Shutdown(ctx)
			return nil, fmt.Errorf("otelmetrics: runtime metrics: %w", err)
		}
	}
	return r, nil
}

var (
	durationBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10}
	blobSizeBuckets = []float64{
		16 << 10, 64 << 10, 256 << 10, 1 << 20, 4 << 20, 16 << 20, 64 << 20, 256 << 20,
	}
	blobDurationBuckets = []float64{0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60}
)

func (r *Recorder) initInstruments() error {
	m := r.meter
	var errs []error
	keep := func(err error) {
		if err != nil {
			errs = append(errs, err)
		}
	}
	var err error
	r.httpRequests, err = m.Int64Counter("budgero.http.server.requests",
		metric.WithDescription("API requests by route template, method and status class."),
		metric.WithUnit("{request}"))
	keep(err)
	r.httpDuration, err = m.Float64Histogram("http.server.request.duration",
		metric.WithDescription("API request duration (health checks and WebSockets excluded)."),
		metric.WithUnit("s"), metric.WithExplicitBucketBoundaries(durationBuckets...))
	keep(err)
	r.wsAttempts, err = m.Int64Counter("budgero.sync.ws.connection_attempts",
		metric.WithDescription("Sync WebSocket connection attempts by outcome."),
		metric.WithUnit("{attempt}"))
	keep(err)
	r.wsActive, err = m.Int64ObservableGauge("budgero.sync.ws.connections.active",
		metric.WithDescription("Open sync WebSocket connections."),
		metric.WithUnit("{connection}"))
	keep(err)
	r.mutationsIn, err = m.Int64Counter("budgero.sync.mutations.received",
		metric.WithDescription("Mutations received over sync WebSockets."),
		metric.WithUnit("{mutation}"))
	keep(err)
	r.mutationsOut, err = m.Int64Counter("budgero.sync.mutations.processed",
		metric.WithDescription("Received mutations by outcome (appended or rejected)."),
		metric.WithUnit("{mutation}"))
	keep(err)
	r.catchUps, err = m.Int64Counter("budgero.sync.catch_up.requests",
		metric.WithDescription("Catch-up requests received over sync WebSockets."),
		metric.WithUnit("{request}"))
	keep(err)
	r.blobUploads, err = m.Int64Counter("budgero.sync.blob_uploads",
		metric.WithDescription("Snapshot blob uploads by outcome."),
		metric.WithUnit("{upload}"))
	keep(err)
	r.blobSize, err = m.Int64Histogram("budgero.sync.blob_upload.size",
		metric.WithDescription("Snapshot blob upload body size."),
		metric.WithUnit("By"), metric.WithExplicitBucketBoundaries(blobSizeBuckets...))
	keep(err)
	r.blobDuration, err = m.Float64Histogram("budgero.sync.blob_upload.duration",
		metric.WithDescription("Snapshot blob upload handling time."),
		metric.WithUnit("s"), metric.WithExplicitBucketBoundaries(blobDurationBuckets...))
	keep(err)
	r.analyticsDepth, err = m.Int64ObservableGauge("budgero.analytics.queue.depth",
		metric.WithDescription("Product analytics events waiting to be sent."),
		metric.WithUnit("{event}"))
	keep(err)
	r.analyticsDropped, err = m.Int64ObservableCounter("budgero.analytics.events.dropped",
		metric.WithDescription("Product analytics events dropped because the queue was full."),
		metric.WithUnit("{event}"))
	keep(err)
	r.analyticsSent, err = m.Int64Counter("budgero.analytics.events.sent",
		metric.WithDescription("Product analytics events delivered to PostHog."),
		metric.WithUnit("{event}"))
	keep(err)
	r.analyticsErrors, err = m.Int64Counter("budgero.analytics.send.errors",
		metric.WithDescription("Failed product analytics batch sends."),
		metric.WithUnit("{batch}"))
	keep(err)
	if len(errs) > 0 {
		return fmt.Errorf("otelmetrics: create instruments: %w", errors.Join(errs...))
	}
	return nil
}

// Enabled reports true.
func (r *Recorder) Enabled() bool { return true }

// Shutdown flushes the last interval and stops the reader.
func (r *Recorder) Shutdown(ctx context.Context) error { return r.provider.Shutdown(ctx) }

// HTTPRequest implements external.HTTPTelemetry.
func (r *Recorder) HTTPRequest(route, method string, status int, d time.Duration, recordDuration bool) {
	opt := metric.WithAttributeSet(attribute.NewSet(
		attribute.String("http.route", safeRoute(route)),
		attribute.String("http.request.method", safeMethod(method)),
		attribute.String("http.response.status_class", statusClass(status)),
	))
	ctx := context.Background()
	r.httpRequests.Add(ctx, 1, opt)
	if recordDuration {
		r.httpDuration.Record(ctx, d.Seconds(), opt)
	}
}

// WSConnectAttempt implements external.SyncTelemetry.
func (r *Recorder) WSConnectAttempt(outcome external.WSOutcome) {
	r.wsAttempts.Add(context.Background(), 1, outcomeOpt(string(outcome), wsOutcomes))
}

// MutationReceived implements external.SyncTelemetry.
func (r *Recorder) MutationReceived() { r.mutationsIn.Add(context.Background(), 1) }

// MutationProcessed implements external.SyncTelemetry.
func (r *Recorder) MutationProcessed(outcome external.MutationOutcome) {
	r.mutationsOut.Add(context.Background(), 1, outcomeOpt(string(outcome), mutationOutcomes))
}

// CatchUpRequested implements external.SyncTelemetry.
func (r *Recorder) CatchUpRequested() { r.catchUps.Add(context.Background(), 1) }

// BlobUpload implements external.SyncTelemetry.
func (r *Recorder) BlobUpload(outcome external.BlobUploadOutcome, bytes int64, d time.Duration) {
	ctx := context.Background()
	opt := outcomeOpt(string(outcome), blobOutcomes)
	r.blobUploads.Add(ctx, 1, opt)
	if bytes > 0 {
		r.blobSize.Record(ctx, bytes, opt)
	}
	r.blobDuration.Record(ctx, d.Seconds(), opt)
}

// ObserveWSConnections implements external.SyncTelemetry.
func (r *Recorder) ObserveWSConnections(count func() int64) {
	if count == nil {
		return
	}
	_, err := r.meter.RegisterCallback(func(_ context.Context, o metric.Observer) error {
		o.ObserveInt64(r.wsActive, count())
		return nil
	}, r.wsActive)
	if err != nil {
		log.Warn().Err(err).Msg("metrics: register ws connection gauge")
	}
}

// ObserveAnalyticsQueue implements external.AnalyticsTelemetry.
func (r *Recorder) ObserveAnalyticsQueue(depth, dropped func() int64) {
	if depth == nil || dropped == nil {
		return
	}
	_, err := r.meter.RegisterCallback(func(_ context.Context, o metric.Observer) error {
		o.ObserveInt64(r.analyticsDepth, depth())
		o.ObserveInt64(r.analyticsDropped, dropped())
		return nil
	}, r.analyticsDepth, r.analyticsDropped)
	if err != nil {
		log.Warn().Err(err).Msg("metrics: register analytics queue gauges")
	}
}

// AnalyticsBatchSent implements external.AnalyticsTelemetry.
func (r *Recorder) AnalyticsBatchSent(events int) {
	if events > 0 {
		r.analyticsSent.Add(context.Background(), int64(events))
	}
}

// AnalyticsSendError implements external.AnalyticsTelemetry.
func (r *Recorder) AnalyticsSendError() { r.analyticsErrors.Add(context.Background(), 1) }

// ---------------------------------------------------------------------------
// Attribute guards: everything is mapped onto a small fixed vocabulary.
// ---------------------------------------------------------------------------

var (
	wsOutcomes = set(
		string(external.WSOutcomeOK), string(external.WSOutcomeUnauthenticated),
		string(external.WSOutcomeForbidden), string(external.WSOutcomeBlocked),
		string(external.WSOutcomeUpgradeRequired), string(external.WSOutcomeError),
	)
	mutationOutcomes = set(
		string(external.MutationAppended), string(external.MutationRejectedInvalid),
		string(external.MutationRejectedError),
	)
	blobOutcomes = set(
		string(external.BlobUploadOK), string(external.BlobUploadCASConflict),
		string(external.BlobUploadRejected), string(external.BlobUploadError),
	)
	methods = set(
		http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut,
		http.MethodPatch, http.MethodDelete, http.MethodOptions,
	)
)

func set(values ...string) map[string]struct{} {
	m := make(map[string]struct{}, len(values))
	for _, v := range values {
		m[v] = struct{}{}
	}
	return m
}

func outcomeOpt(v string, allowed map[string]struct{}) metric.MeasurementOption {
	if _, ok := allowed[v]; !ok {
		v = otherValue
	}
	return metric.WithAttributeSet(attribute.NewSet(attribute.String("outcome", v)))
}

func safeMethod(m string) string {
	if _, ok := methods[m]; ok {
		return m
	}
	return "_OTHER"
}

// maxRouteLen bounds a route template; real ones are far shorter.
const maxRouteLen = 96

// safeRoute accepts router templates and the middleware's fixed buckets only.
// Anything that does not look like a template (too long, query string, odd
// characters) becomes "other" rather than risk exporting a raw path.
func safeRoute(route string) string {
	if route == "" || len(route) > maxRouteLen {
		return otherValue
	}
	if route == external.RouteStatic || route == external.RouteUnmatched {
		return route
	}
	if route[0] != '/' {
		return otherValue
	}
	for _, ch := range route {
		switch {
		case ch >= 'a' && ch <= 'z', ch >= 'A' && ch <= 'Z', ch >= '0' && ch <= '9':
		case strings.ContainsRune("/:-_.*", ch):
		default:
			return otherValue
		}
	}
	return route
}

func statusClass(status int) string {
	switch {
	case status >= 100 && status < 200:
		return "1xx"
	case status >= 200 && status < 300:
		return "2xx"
	case status >= 300 && status < 400:
		return "3xx"
	case status >= 400 && status < 500:
		return "4xx"
	case status >= 500 && status < 600:
		return "5xx"
	default:
		return otherValue
	}
}
