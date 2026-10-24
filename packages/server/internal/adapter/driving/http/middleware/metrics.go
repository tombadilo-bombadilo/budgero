package middleware

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"budgero-server/internal/port/driven/external"

	"github.com/labstack/echo/v4"
)

// Metrics records one data point per request: the route template (never the
// raw path, so no ids leak), method and status. Register it first so it sees
// the final status of everything below it, including recovered panics and
// rate-limit rejections. A nil or disabled telemetry adds no work.
func Metrics(t external.HTTPTelemetry) echo.MiddlewareFunc {
	if t == nil {
		return passthrough
	}
	if e, ok := t.(interface{ Enabled() bool }); ok && !e.Enabled() {
		return passthrough
	}
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			start := time.Now()
			err := next(c)
			route := metricsRoute(c)
			t.HTTPRequest(route, c.Request().Method, responseStatus(c, err), time.Since(start), recordsDuration(route))
			return err
		}
	}
}

func passthrough(next echo.HandlerFunc) echo.HandlerFunc { return next }

// metricsRoute maps a request onto a bounded route value.
func metricsRoute(c echo.Context) string {
	if !strings.HasPrefix(c.Request().URL.Path, "/api/") {
		return external.RouteStatic
	}
	route := c.Path()
	if route == "" || route == "/*" || !strings.HasPrefix(route, "/api/") {
		return external.RouteUnmatched
	}
	return route
}

// recordsDuration skips health checks (polled by the orchestrator) and
// long-lived sockets, whose "duration" is the connection lifetime.
func recordsDuration(route string) bool {
	switch {
	case strings.HasPrefix(route, "/api/v1/health"),
		route == "/api/v1/ws/sync",
		strings.HasPrefix(route, "/api/v1/bank-relay/"):
		return false
	}
	return true
}

// responseStatus is the status the client gets: the written one, or the one
// Echo's error handler will write for err.
func responseStatus(c echo.Context, err error) int {
	if err == nil || c.Response().Committed {
		return c.Response().Status
	}
	var he *echo.HTTPError
	if errors.As(err, &he) {
		return he.Code
	}
	return http.StatusInternalServerError
}
