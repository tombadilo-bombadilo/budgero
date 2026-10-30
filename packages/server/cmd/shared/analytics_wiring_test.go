package shared //nolint:revive // var-naming: tests access unexported helpers in the shared command package

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"budgero-server/internal/adapter/driven/fake"
	"budgero-server/internal/application"
	"budgero-server/internal/config"
	"budgero-server/internal/domain"
	"budgero-server/internal/domain/analytics"
)

// Self-host must never send analytics, even when POSTHOG_KEY is set.
func TestAnalyticsWiring_SelfHostSendsNothing(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
	}))
	defer srv.Close()

	run := func(cfg *config.Config, selfHost bool) (enabled bool) {
		users := fake.NewUserRepository()
		if _, err := users.Create(context.Background(), &domain.User{ID: "u1", Email: "u1@example.com"}); err != nil {
			t.Fatal(err)
		}
		tracker := application.NewAnalyticsService(newAnalyticsSender(cfg, selfHost), users, application.AnalyticsOptions{})
		tracker.Track("u1", analytics.UserSignedUp())
		// Server exceptions ride the same pipeline: a self-host build must
		// not report them either, with or without a user.
		exc := analytics.ServerException{Type: "panic", Code: analytics.ErrCodePanic, Route: "/api/v1/profile", Method: "GET", Status: 500}
		tracker.CaptureException("u1", exc)
		tracker.CaptureException("", exc)
		tracker.Close()
		return tracker.Enabled()
	}

	withKey := func(selfHostable bool) *config.Config {
		cfg := &config.Config{}
		cfg.Auth.SelfHostable = selfHostable
		cfg.Analytics.PostHogKey = "phc_test"
		cfg.Analytics.PostHogHost = srv.URL
		return cfg
	}

	if run(withKey(false), true) || run(withKey(true), false) {
		t.Fatal("self-host tracker must be disabled")
	}
	if run(&config.Config{}, false) {
		t.Fatal("tracker must be disabled without POSTHOG_KEY")
	}
	if hits.Load() != 0 {
		t.Fatalf("self-host / keyless builds sent %d requests", hits.Load())
	}

	// Control: a cloud build with a key does send.
	if !run(withKey(false), false) {
		t.Fatal("cloud tracker with a key must be enabled")
	}
	if hits.Load() != 1 {
		t.Fatalf("cloud build sent %d requests, want 1", hits.Load())
	}
}
