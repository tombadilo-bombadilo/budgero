package shared //nolint:revive // var-naming: tests access unexported helpers in the shared command package

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"budgero-server/internal/config"
)

// Self-host must never export metrics, even with every metrics env var set.
func TestMetricsWiring_SelfHostAndUnsetStayOff(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
	}))
	defer srv.Close()

	full := func(selfHostable bool) *config.Config {
		cfg := &config.Config{}
		cfg.Auth.SelfHostable = selfHostable
		cfg.Analytics.PostHogKey = "phc_test"
		cfg.Metrics.Enabled = true
		cfg.Metrics.Endpoint = srv.URL + "/i/v1/metrics"
		return cfg
	}
	exercise := func(cfg *config.Config, selfHost bool) bool {
		tel := newTelemetry(cfg, selfHost)
		tel.HTTPRequest("/api/v1/health", "GET", 200, time.Millisecond, true)
		_ = tel.Shutdown(context.Background())
		return tel.Enabled()
	}

	noFlag := full(false)
	noFlag.Metrics.Enabled = false
	noKey := full(false)
	noKey.Analytics.PostHogKey = ""
	noURL := full(false)
	noURL.Metrics.Endpoint = ""

	for name, on := range map[string]bool{
		"self-host binary":   exercise(full(false), true),
		"SELF_HOSTABLE=true": exercise(full(true), false),
		"flag off":           exercise(noFlag, false),
		"no key":             exercise(noKey, false),
		"no endpoint":        exercise(noURL, false),
	} {
		if on {
			t.Errorf("%s: metrics enabled", name)
		}
	}
	if hits.Load() != 0 {
		t.Fatalf("disabled configs sent %d requests", hits.Load())
	}

	// Control: a fully configured cloud build exports on shutdown.
	if !exercise(full(false), false) {
		t.Fatal("cloud build with metrics configured must be enabled")
	}
	if hits.Load() == 0 {
		t.Fatal("cloud build did not export on shutdown")
	}
}
