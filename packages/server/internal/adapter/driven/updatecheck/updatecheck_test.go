package updatecheck_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/updatecheck"
)

func TestBucketProvider_FetchesAndCaches(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		_, _ = w.Write([]byte("v1.6.1\n"))
	}))
	defer srv.Close()

	p := updatecheck.NewBucketProvider(srv.URL, time.Hour, time.Hour)

	v, ok := p.Latest(context.Background())
	if !ok || v != "1.6.1" {
		t.Fatalf("Latest() = (%q, %v), want (1.6.1, true)", v, ok)
	}

	// Second call within TTL must be served from cache.
	v, ok = p.Latest(context.Background())
	if !ok || v != "1.6.1" {
		t.Fatalf("cached Latest() = (%q, %v), want (1.6.1, true)", v, ok)
	}
	if got := hits.Load(); got != 1 {
		t.Errorf("source hit %d times, want 1 (cache miss on second call)", got)
	}
}

func TestBucketProvider_NegativeCachesFailures(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	p := updatecheck.NewBucketProvider(srv.URL, time.Hour, time.Hour)

	if _, ok := p.Latest(context.Background()); ok {
		t.Fatal("Latest() ok = true on failing source, want false")
	}
	// Failure must be cached too — no immediate retry.
	if _, ok := p.Latest(context.Background()); ok {
		t.Fatal("Latest() ok = true from negative cache, want false")
	}
	if got := hits.Load(); got != 1 {
		t.Errorf("source hit %d times, want 1 (failure not negative-cached)", got)
	}
}

func TestServerProvider_SendsIdentityAndParsesJSON(t *testing.T) {
	var gotQuery, gotUA atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery.Store(r.URL.Query().Encode())
		gotUA.Store(r.Header.Get("User-Agent"))
		_, _ = w.Write([]byte(`{"latest_version":"v2.0.0","build_version":"2.0.0"}`))
	}))
	defer srv.Close()

	p := updatecheck.NewServerProvider(srv.URL, "1.6.0", "abc123", "selfhost", time.Hour, time.Hour)

	v, ok := p.Latest(context.Background())
	if !ok || v != "2.0.0" {
		t.Fatalf("Latest() = (%q, %v), want (2.0.0, true)", v, ok)
	}
	wantQuery := "build=abc123&type=selfhost&version=1.6.0"
	if q := gotQuery.Load(); q != wantQuery {
		t.Errorf("query = %q, want %q", q, wantQuery)
	}
	if ua := gotUA.Load(); ua != "budgero/1.6.0 (selfhost)" {
		t.Errorf("user-agent = %q, want budgero/1.6.0 (selfhost)", ua)
	}
}
