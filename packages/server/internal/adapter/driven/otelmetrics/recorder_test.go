package otelmetrics_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/otelmetrics"
	"budgero-server/internal/port/driven/external"

	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	collectorpb "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	"google.golang.org/protobuf/proto"
)

type sink struct {
	hits   atomic.Int64
	mu     sync.Mutex
	auth   string
	ctype  string
	bodies []*collectorpb.ExportMetricsServiceRequest
}

func newSink(t *testing.T) (*sink, *httptest.Server) {
	t.Helper()
	s := &sink{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.hits.Add(1)
		raw, _ := io.ReadAll(r.Body)
		req := &collectorpb.ExportMetricsServiceRequest{}
		_ = proto.Unmarshal(raw, req)
		s.mu.Lock()
		s.auth, s.ctype = r.Header.Get("Authorization"), r.Header.Get("Content-Type")
		s.bodies = append(s.bodies, req)
		s.mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	return s, srv
}

func TestNew_DisabledBuildsNothing(t *testing.T) {
	s, srv := newSink(t)
	endpoint := srv.URL + "/i/v1/metrics"
	cases := map[string]otelmetrics.Options{
		"flag off":  {Enabled: false, Endpoint: endpoint, Token: "phc_x"},
		"self-host": {Enabled: true, SelfHost: true, Endpoint: endpoint, Token: "phc_x"},
		"no token":  {Enabled: true, Endpoint: endpoint, Token: "  "},
		"no url":    {Enabled: true, Token: "phc_x"},
		"zero":      {},
	}
	before := runtime.NumGoroutine()
	for name, opts := range cases {
		t.Run(name, func(t *testing.T) {
			tel, err := otelmetrics.New(context.Background(), opts)
			if err != nil {
				t.Fatalf("New: %v", err)
			}
			if _, ok := tel.(external.NoopTelemetry); !ok || tel.Enabled() {
				t.Fatalf("got %T (enabled=%v), want NoopTelemetry", tel, tel.Enabled())
			}
			tel.HTTPRequest("/api/v1/health", "GET", 200, time.Millisecond, true)
			tel.WSConnectAttempt(external.WSOutcomeOK)
			if err := tel.Shutdown(context.Background()); err != nil {
				t.Fatalf("Shutdown: %v", err)
			}
		})
	}
	if after := runtime.NumGoroutine(); after > before {
		t.Errorf("goroutines grew from %d to %d with metrics disabled", before, after)
	}
	if n := s.hits.Load(); n != 0 {
		t.Errorf("disabled telemetry made %d requests", n)
	}
}

func TestNew_RejectsBadEndpoint(t *testing.T) {
	tel, err := otelmetrics.New(context.Background(), otelmetrics.Options{Enabled: true, Endpoint: "ftp://x", Token: "phc_x"})
	if err == nil || tel.Enabled() {
		t.Fatalf("want error and no-op for a non-http endpoint, got %v enabled=%v", err, tel.Enabled())
	}
}

func TestNew_ExportsOTLPOnShutdown(t *testing.T) {
	s, srv := newSink(t)
	tel, err := otelmetrics.New(context.Background(), otelmetrics.Options{
		Enabled: true, Endpoint: srv.URL + "/i/v1/metrics", Token: "phc_test",
		ServiceVersion: "9.9.9", Interval: time.Hour,
	})
	if err != nil || !tel.Enabled() {
		t.Fatalf("New: %v enabled=%v", err, tel.Enabled())
	}
	tel.HTTPRequest("/api/v1/budget-spaces/:spaceID", "GET", 200, 20*time.Millisecond, true)
	if err := tel.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
	if s.hits.Load() == 0 {
		t.Fatal("shutdown did not flush")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.auth != "Bearer phc_test" || s.ctype != "application/x-protobuf" {
		t.Errorf("auth=%q content-type=%q", s.auth, s.ctype)
	}
	res := map[string]string{}
	names := map[string]bool{}
	for _, body := range s.bodies {
		for _, rm := range body.GetResourceMetrics() {
			for _, kv := range rm.GetResource().GetAttributes() {
				res[kv.GetKey()] = kv.GetValue().GetStringValue()
			}
			for _, sm := range rm.GetScopeMetrics() {
				for _, m := range sm.GetMetrics() {
					names[m.GetName()] = true
				}
			}
		}
	}
	if res["service.name"] != "budgero-server" || res["service.version"] != "9.9.9" {
		t.Errorf("resource = %v", res)
	}
	for _, want := range []string{"budgero.http.server.requests", "http.server.request.duration", "go.goroutine.count", "go.memory.used"} {
		if !names[want] {
			t.Errorf("metric %s not exported; got %v", want, names)
		}
	}
}

// collect builds a recorder on a manual reader, runs record, and returns
// every data point's attributes per metric name.
func collect(t *testing.T, record func(r *otelmetrics.Recorder)) (map[string][]attribute.Set, metricdata.ResourceMetrics) {
	t.Helper()
	reader := sdkmetric.NewManualReader()
	r, err := otelmetrics.NewWithReader(reader, "1.2.3")
	if err != nil {
		t.Fatalf("NewWithReader: %v", err)
	}
	t.Cleanup(func() { _ = r.Shutdown(context.Background()) })
	record(r)
	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatalf("Collect: %v", err)
	}
	out := map[string][]attribute.Set{}
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			switch d := m.Data.(type) {
			case metricdata.Sum[int64]:
				for _, p := range d.DataPoints {
					out[m.Name] = append(out[m.Name], p.Attributes)
				}
			case metricdata.Gauge[int64]:
				for _, p := range d.DataPoints {
					out[m.Name] = append(out[m.Name], p.Attributes)
				}
			case metricdata.Histogram[float64]:
				for _, p := range d.DataPoints {
					out[m.Name] = append(out[m.Name], p.Attributes)
				}
			case metricdata.Histogram[int64]:
				for _, p := range d.DataPoints {
					out[m.Name] = append(out[m.Name], p.Attributes)
				}
			default:
				t.Fatalf("unexpected data type %T for %s", d, m.Name)
			}
		}
	}
	return out, rm
}

func TestRecorder_RecordsExpectedMetrics(t *testing.T) {
	got, rm := collect(t, func(r *otelmetrics.Recorder) {
		r.HTTPRequest("/api/v1/budget-spaces/:spaceID", "GET", 204, 5*time.Millisecond, true)
		r.HTTPRequest("/api/v1/health", "GET", 200, time.Millisecond, false)
		r.WSConnectAttempt(external.WSOutcomeUnauthenticated)
		r.WSConnectAttempt(external.WSOutcomeOK)
		r.MutationReceived()
		r.MutationProcessed(external.MutationAppended)
		r.CatchUpRequested()
		r.BlobUpload(external.BlobUploadCASConflict, 2048, 30*time.Millisecond)
		r.BlobUpload(external.BlobUploadOK, 0, time.Millisecond)
		r.ObserveWSConnections(func() int64 { return 3 })
		r.ObserveAnalyticsQueue(func() int64 { return 7 }, func() int64 { return 2 })
		r.AnalyticsBatchSent(5)
		r.AnalyticsSendError()
	})
	if v, _ := rm.Resource.Set().Value("service.name"); v.AsString() != "budgero-server" {
		t.Errorf("service.name = %q", v.AsString())
	}
	want := map[string]int{
		"budgero.http.server.requests":        2,
		"http.server.request.duration":        1, // health excluded
		"budgero.sync.ws.connection_attempts": 2,
		"budgero.sync.ws.connections.active":  1,
		"budgero.sync.mutations.received":     1,
		"budgero.sync.mutations.processed":    1,
		"budgero.sync.catch_up.requests":      1,
		"budgero.sync.blob_uploads":           2,
		"budgero.sync.blob_upload.size":       1, // size only when known
		"budgero.sync.blob_upload.duration":   2,
		"budgero.analytics.queue.depth":       1,
		"budgero.analytics.events.dropped":    1,
		"budgero.analytics.events.sent":       1,
		"budgero.analytics.send.errors":       1,
	}
	for name, n := range want {
		if len(got[name]) != n {
			t.Errorf("%s: %d series, want %d", name, len(got[name]), n)
		}
	}
	req := got["budgero.http.server.requests"][0]
	for k, v := range map[string]string{"http.route": "/api/v1/budget-spaces/:spaceID", "http.request.method": "GET", "http.response.status_class": "2xx"} {
		if val, _ := req.Value(attribute.Key(k)); val.AsString() != v {
			t.Errorf("%s = %q, want %q", k, val.AsString(), v)
		}
	}
}

func TestRecorder_AttributesStayBounded(t *testing.T) {
	const userID, spaceID, email = "user_2abcXYZ", "sp_9f8e7d", "leak@example.com"
	got, _ := collect(t, func(r *otelmetrics.Recorder) {
		// Raw paths, query strings and junk must never become a route.
		r.HTTPRequest("/api/v1/budget-spaces/"+spaceID+"?email="+email, "GET", 200, time.Millisecond, true)
		r.HTTPRequest("/api/v1/users/"+email, "BREW", 999, time.Millisecond, true)
		r.HTTPRequest("api/v1/"+userID, "GET", 200, time.Millisecond, true)
		r.HTTPRequest("/"+strings.Repeat("a", 200), "GET", 200, time.Millisecond, true)
		r.WSConnectAttempt(external.WSOutcome(userID))
		r.MutationProcessed(external.MutationOutcome(spaceID))
		r.BlobUpload(external.BlobUploadOutcome(email), 10, time.Millisecond)
	})
	allowed := map[string]bool{"other": true, "_OTHER": true, "2xx": true, "GET": true}
	for name, sets := range got {
		for _, set := range sets {
			for _, kv := range set.ToSlice() {
				v := kv.Value.String()
				if strings.Contains(v, userID) || strings.Contains(v, spaceID) || strings.Contains(v, email) {
					t.Errorf("%s leaks an id: %s=%s", name, kv.Key, v)
				}
				if !allowed[v] {
					t.Errorf("%s: unexpected attribute %s=%q", name, kv.Key, v)
				}
			}
		}
	}
}
