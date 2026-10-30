package posthog_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/posthog"
	"budgero-server/internal/port/driven/external"
)

type capturedRequest struct {
	path, contentType string
	body              map[string]any
}

func newCaptureServer(t *testing.T, status int) (srv *httptest.Server, requests func() []capturedRequest) {
	t.Helper()
	var mu sync.Mutex
	var reqs []capturedRequest
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Errorf("body is not JSON: %v", err)
		}
		mu.Lock()
		reqs = append(reqs, capturedRequest{path: r.URL.Path, contentType: r.Header.Get("Content-Type"), body: body})
		mu.Unlock()
		w.WriteHeader(status)
	}))
	t.Cleanup(srv.Close)
	return srv, func() []capturedRequest {
		mu.Lock()
		defer mu.Unlock()
		return append([]capturedRequest(nil), reqs...)
	}
}

func TestSender_PostsOneBatchWithOnlyGivenProps(t *testing.T) {
	srv, requests := newCaptureServer(t, http.StatusOK)
	sender := posthog.NewSender(srv.URL+"/", "phc_test", time.Second)
	at := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)

	err := sender.Send(context.Background(), []external.AnalyticsEvent{
		{Name: "subscription_started", DistinctID: "user_a", Properties: map[string]string{"plan": "yearly"}, Timestamp: at},
		{Name: "member_left", DistinctID: "user_b", Timestamp: at},
		{Name: "push_received", DistinctID: "user_a", Properties: map[string]string{"outcome": "rejected", "error_code": "duplicate"}, Timestamp: at},
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	reqs := requests()
	if len(reqs) != 1 {
		t.Fatalf("requests = %d, want 1 batch", len(reqs))
	}
	req := reqs[0]
	if req.path != "/batch/" || req.contentType != "application/json" {
		t.Fatalf("path=%q content-type=%q", req.path, req.contentType)
	}
	if req.body["api_key"] != "phc_test" {
		t.Fatalf("api_key = %v", req.body["api_key"])
	}
	batch, _ := req.body["batch"].([]any)
	if len(batch) != 3 {
		t.Fatalf("batch has %d events, want 3", len(batch))
	}
	wantKeys := []string{
		"$geoip_disable,$lib,distinct_id,plan",
		"$geoip_disable,$lib,distinct_id",
		"$geoip_disable,$lib,distinct_id,error_code,outcome",
	}
	for i, raw := range batch {
		ev, _ := raw.(map[string]any)
		props, _ := ev["properties"].(map[string]any)
		keys := make([]string, 0, len(props))
		for k := range props {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		if got := strings.Join(keys, ","); got != wantKeys[i] {
			t.Errorf("event %d props = %s, want %s", i, got, wantKeys[i])
		}
		if ev["timestamp"] != "2026-10-23T12:00:00Z" {
			t.Errorf("event %d timestamp = %v", i, ev["timestamp"])
		}
		for k := range ev {
			if k != "event" && k != "properties" && k != "timestamp" {
				t.Errorf("event %d has unexpected top-level key %q", i, k)
			}
		}
	}
	first, _ := batch[0].(map[string]any)
	props, _ := first["properties"].(map[string]any)
	if first["event"] != "subscription_started" || props["distinct_id"] != "user_a" || props["$geoip_disable"] != true {
		t.Errorf("first event = %+v", first)
	}
}

func TestSender_TimesOut(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(func() {
		close(release)
		srv.Close()
	})

	sender := posthog.NewSender(srv.URL, "phc_test", 100*time.Millisecond)
	start := time.Now()
	err := sender.Send(context.Background(), []external.AnalyticsEvent{{Name: "member_left", DistinctID: "u", Timestamp: time.Now()}})
	if err == nil {
		t.Fatal("Send against a hung server must fail")
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("Send took %v; the timeout is not applied", elapsed)
	}
}

func TestSender_RejectsNon2xxAndSkipsEmptyBatches(t *testing.T) {
	srv, requests := newCaptureServer(t, http.StatusBadRequest)
	sender := posthog.NewSender(srv.URL, "phc_test", time.Second)
	if err := sender.Send(context.Background(), nil); err != nil {
		t.Fatalf("empty Send: %v", err)
	}
	if len(requests()) != 0 {
		t.Fatal("empty batch must not hit the network")
	}
	if err := sender.Send(context.Background(), []external.AnalyticsEvent{{Name: "member_left", DistinctID: "u", Timestamp: time.Now()}}); err == nil {
		t.Fatal("400 must be reported as an error")
	}
}

func TestNoop(t *testing.T) {
	var n posthog.Noop
	if n.Enabled() {
		t.Fatal("Noop must report disabled")
	}
	if err := n.Send(context.Background(), []external.AnalyticsEvent{{Name: "x"}}); err != nil {
		t.Fatal(err)
	}
}

func TestSender_MergesStructuredPayload(t *testing.T) {
	srv, requests := newCaptureServer(t, http.StatusOK)
	sender := posthog.NewSender(srv.URL, "phc_test", time.Second)

	err := sender.Send(context.Background(), []external.AnalyticsEvent{{
		Name:       "$exception",
		DistinctID: "server",
		Properties: map[string]string{"error_code": "panic"},
		Payload:    map[string]any{"$exception_list": []map[string]any{{"type": "panic"}}},
		Timestamp:  time.Now(),
	}})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	batch, _ := requests()[0].body["batch"].([]any)
	props, _ := batch[0].(map[string]any)["properties"].(map[string]any)
	list, _ := props["$exception_list"].([]any)
	if props["error_code"] != "panic" || len(list) != 1 {
		t.Fatalf("properties = %v", props)
	}
}
