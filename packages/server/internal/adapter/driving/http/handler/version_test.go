package handler_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"budgero-server/internal/adapter/driving/http/handler"
	"budgero-server/internal/appmeta"
	"budgero-server/internal/testkit"

	"github.com/labstack/echo/v4"
)

// fakeLatestSource is a canned LatestVersionSource for handler tests.
type fakeLatestSource struct {
	version string
	ok      bool
}

func (f *fakeLatestSource) Latest(_ context.Context) (string, bool) {
	return f.version, f.ok
}

func setupVersionHandler(t *testing.T, selfHost bool, src handler.LatestVersionSource) (*handler.Handlers, *echo.Echo, *testkit.TestContext) {
	t.Helper()
	sqlDB, queries, services, cfg := testkit.NewTestServices(t, selfHost)

	h := handler.NewHandlers(services, nil, handler.Options{
		SelfHost:      selfHost,
		Config:        cfg,
		LatestVersion: src,
	})

	e := echo.New()
	return h, e, &testkit.TestContext{DB: sqlDB, Queries: queries}
}

func getVersion(t *testing.T, h *handler.Handlers, e *echo.Echo, target string) (code int, body map[string]string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := h.GetLatestVersion(c); err != nil {
		t.Fatalf("GetLatestVersion() error = %v", err)
	}

	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	return rec.Code, body
}

func countPings(t *testing.T, tc *testkit.TestContext, clientType string) (rows, total int) {
	t.Helper()
	err := tc.DB.QueryRowContext(context.Background(),
		"SELECT COUNT(*), COALESCE(SUM(count), 0) FROM update_pings WHERE client_type = ?", clientType,
	).Scan(&rows, &total)
	if err != nil {
		t.Fatalf("failed to count pings: %v", err)
	}
	return rows, total
}

func TestGetLatestVersion_SelfHost_FallsBackToBuildVersion(t *testing.T) {
	h, e, tc := setupVersionHandler(t, true, nil)

	code, body := getVersion(t, h, e, "/api/v1/version/latest?version=1.0.0&build=abc&type=selfhost")
	if code != http.StatusOK {
		t.Fatalf("status = %d, want %d", code, http.StatusOK)
	}
	if body["latest_version"] != appmeta.LatestVersion() {
		t.Errorf("latest_version = %q, want appmeta fallback %q", body["latest_version"], appmeta.LatestVersion())
	}

	// Self-host never records pings, even when params are present.
	if rows, _ := countPings(t, tc, "selfhost"); rows != 0 {
		t.Errorf("self-host recorded %d ping rows, want 0", rows)
	}
}

func TestGetLatestVersion_UsesSourceWhenAvailable(t *testing.T) {
	h, e, _ := setupVersionHandler(t, true, &fakeLatestSource{version: "9.9.9", ok: true})

	_, body := getVersion(t, h, e, "/api/v1/version/latest")
	if body["latest_version"] != "9.9.9" {
		t.Errorf("latest_version = %q, want 9.9.9", body["latest_version"])
	}
	if body["build_version"] != appmeta.BuildVersion() {
		t.Errorf("build_version = %q, want %q", body["build_version"], appmeta.BuildVersion())
	}
}

func TestGetLatestVersion_SaaS_RecordsSelfHostPing(t *testing.T) {
	h, e, tc := setupVersionHandler(t, false, &fakeLatestSource{version: "2.0.0", ok: true})

	target := "/api/v1/version/latest?version=1.6.0&build=abc123&type=selfhost"
	getVersion(t, h, e, target)
	getVersion(t, h, e, target)

	rows, total := countPings(t, tc, "selfhost")
	if rows != 1 || total != 2 {
		t.Errorf("selfhost pings: rows=%d total=%d, want rows=1 total=2 (upsert should aggregate)", rows, total)
	}

	var version, build string
	err := tc.DB.QueryRowContext(context.Background(),
		"SELECT version, build FROM update_pings WHERE client_type = 'selfhost'",
	).Scan(&version, &build)
	if err != nil {
		t.Fatalf("failed to read ping row: %v", err)
	}
	if version != "1.6.0" || build != "abc123" {
		t.Errorf("ping row = (%q, %q), want (1.6.0, abc123)", version, build)
	}
}

func TestGetLatestVersion_SaaS_ParamlessCountsAsSaas(t *testing.T) {
	h, e, tc := setupVersionHandler(t, false, nil)

	getVersion(t, h, e, "/api/v1/version/latest")

	if rows, total := countPings(t, tc, "saas"); rows != 1 || total != 1 {
		t.Errorf("saas pings: rows=%d total=%d, want 1/1", rows, total)
	}
}

func TestGetLatestVersion_SaaS_DropsUnknownClientType(t *testing.T) {
	h, e, tc := setupVersionHandler(t, false, nil)

	getVersion(t, h, e, "/api/v1/version/latest?version=1.0.0&type=totally-bogus")

	var rows int
	if err := tc.DB.QueryRowContext(context.Background(),
		"SELECT COUNT(*) FROM update_pings").Scan(&rows); err != nil {
		t.Fatalf("failed to count pings: %v", err)
	}
	if rows != 0 {
		t.Errorf("unknown client type recorded %d rows, want 0", rows)
	}
}

func countSenders(t *testing.T, tc *testkit.TestContext) int {
	t.Helper()
	var n int
	if err := tc.DB.QueryRowContext(context.Background(),
		"SELECT COUNT(*) FROM update_ping_week_senders").Scan(&n); err != nil {
		t.Fatalf("failed to count senders: %v", err)
	}
	return n
}

func pingFrom(t *testing.T, h *handler.Handlers, e *echo.Echo, cfIP, remote string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/version/latest?version=1.19.5&build=abc&type=selfhost", http.NoBody)
	if cfIP != "" {
		req.Header.Set("CF-Connecting-IP", cfIP)
	}
	req.RemoteAddr = remote + ":443"
	if err := h.GetLatestVersion(e.NewContext(req, httptest.NewRecorder())); err != nil {
		t.Fatalf("GetLatestVersion() error = %v", err)
	}
}

func TestGetLatestVersion_SaaS_CountsSelfHostSendersByCloudflareIP(t *testing.T) {
	h, e, tc := setupVersionHandler(t, false, nil)

	// Same Cloudflare edge, two real clients: two senders.
	pingFrom(t, h, e, "203.0.113.7", "172.70.1.1")
	pingFrom(t, h, e, "198.51.100.2", "172.70.1.1")
	pingFrom(t, h, e, "203.0.113.7", "172.70.1.2")
	if n := countSenders(t, tc); n != 2 {
		t.Fatalf("senders = %d, want 2", n)
	}
}

func TestGetLatestVersion_SelfHost_RecordsNoSenders(t *testing.T) {
	h, e, tc := setupVersionHandler(t, true, nil)
	pingFrom(t, h, e, "203.0.113.7", "203.0.113.7")
	if n := countSenders(t, tc); n != 0 {
		t.Fatalf("self-host recorded %d senders", n)
	}
}

func TestGetAdminSelfHostInstalls(t *testing.T) {
	h, e, _ := setupVersionHandler(t, false, nil)
	pingFrom(t, h, e, "203.0.113.7", "172.70.1.1")

	rec := httptest.NewRecorder()
	if err := h.GetAdminSelfHostInstalls(e.NewContext(httptest.NewRequest(http.MethodGet, "/", http.NoBody), rec)); err != nil {
		t.Fatalf("GetAdminSelfHostInstalls() error = %v", err)
	}
	var body struct {
		Weeks []struct {
			Installs int  `json:"installs"`
			Partial  bool `json:"partial"`
		} `json:"weeks"`
		Versions []struct {
			Version string `json:"version"`
			Pings   int    `json:"pings"`
		} `json:"versions"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Weeks) != 1 || body.Weeks[0].Installs != 1 || !body.Weeks[0].Partial {
		t.Fatalf("weeks = %+v", body.Weeks)
	}
	if len(body.Versions) != 1 || body.Versions[0].Version != "1.19.5" || body.Versions[0].Pings != 1 {
		t.Fatalf("versions = %+v", body.Versions)
	}

	hs, es, _ := setupVersionHandler(t, true, nil)
	err := hs.GetAdminSelfHostInstalls(es.NewContext(httptest.NewRequest(http.MethodGet, "/", http.NoBody), httptest.NewRecorder()))
	var he *echo.HTTPError
	if !errors.As(err, &he) || he.Code != http.StatusNotFound {
		t.Fatalf("self-host err = %v, want 404", err)
	}
}
