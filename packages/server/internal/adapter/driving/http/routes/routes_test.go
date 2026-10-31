package routes_test

import (
	"testing"

	"budgero-server/internal/adapter/driving/http/handler"
	"budgero-server/internal/adapter/driving/http/routes"
	"budgero-server/internal/testkit"

	"github.com/labstack/echo/v4"
)

func TestSetupRoutes_HeartbeatRouteIsSaaSOnly(t *testing.T) {
	{
		_, _, services, cfg := testkit.NewTestServices(t, false)
		e := echo.New()
		h := handler.NewHandlers(services, nil, handler.Options{SelfHost: false, Config: cfg})

		routes.SetupRoutes(e, h, services, routes.Options{SelfHost: false, Config: cfg})

		if !hasRoute(e, "POST", "/api/v1/profile/activity/heartbeat") {
			t.Fatalf("expected SaaS heartbeat route to be registered")
		}
	}

	{
		_, _, services, cfg := testkit.NewTestServices(t, true)
		e := echo.New()
		h := handler.NewHandlers(services, nil, handler.Options{SelfHost: true, Config: cfg})

		routes.SetupRoutes(e, h, services, routes.Options{SelfHost: true, Config: cfg})

		if hasRoute(e, "POST", "/api/v1/profile/activity/heartbeat") {
			t.Fatalf("expected self-host heartbeat route to be absent")
		}
	}
}

func TestSetupRoutes_SnapshotHistoryRoutesInBothModes(t *testing.T) {
	for _, selfHost := range []bool{false, true} {
		_, _, services, cfg := testkit.NewTestServices(t, selfHost)
		e := echo.New()
		h := handler.NewHandlers(services, nil, handler.Options{SelfHost: selfHost, Config: cfg})
		routes.SetupRoutes(e, h, services, routes.Options{SelfHost: selfHost, Config: cfg})

		for _, r := range []struct{ method, path string }{
			{"GET", "/api/v1/database/blob/history"},
			{"GET", "/api/v1/database/blob/history/:id"},
			{"POST", "/api/v1/database/blob/history/:id/restore"},
			{"GET", "/api/v1/admin/spaces/:space_id/blob-history"},
			{"POST", "/api/v1/admin/spaces/:space_id/blob-history/:id/restore"},
		} {
			if !hasRoute(e, r.method, r.path) {
				t.Errorf("self-host=%v: %s %s not registered", selfHost, r.method, r.path)
			}
		}
	}
}

func hasRoute(e *echo.Echo, method, path string) bool {
	for _, route := range e.Routes() {
		if route.Method == method && route.Path == path {
			return true
		}
	}
	return false
}
