package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/config"

	"github.com/labstack/echo/v4"
)

func cspDirectives(t *testing.T) map[string]string {
	t.Helper()
	e := echo.New()
	rec := httptest.NewRecorder()
	c := e.NewContext(httptest.NewRequest(http.MethodGet, "/", http.NoBody), rec)
	h := middleware.SecurityHeaders(&config.Config{})(func(c echo.Context) error { return nil })
	if err := h(c); err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, d := range strings.Split(rec.Header().Get("Content-Security-Policy"), ";") {
		d = strings.TrimSpace(d)
		name, rest, _ := strings.Cut(d, " ")
		out[name] = rest
	}
	return out
}

// PostHog (proxy + EU ingest/assets) stays allowed; no ad or tag-manager hosts.
func TestCSP_AnalyticsHostsOnly(t *testing.T) {
	csp := cspDirectives(t)
	for _, host := range []string{"https://s.budgero.app", "https://eu-assets.i.posthog.com"} {
		if !strings.Contains(csp["script-src"], host) {
			t.Errorf("script-src lacks %s", host)
		}
	}
	for _, host := range []string{"https://s.budgero.app", "https://eu.i.posthog.com"} {
		if !strings.Contains(csp["connect-src"], host) {
			t.Errorf("connect-src lacks %s", host)
		}
	}
	all := strings.ToLower(strings.Join([]string{csp["script-src"], csp["connect-src"], csp["frame-src"], csp["img-src"]}, " "))
	for _, banned := range []string{"google", "doubleclick", "gstatic", "klaro"} {
		if strings.Contains(all, banned) {
			t.Errorf("CSP mentions %q", banned)
		}
	}
}
