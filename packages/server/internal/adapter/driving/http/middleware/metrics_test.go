package middleware_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"budgero-server/internal/adapter/driven/fake"
	"budgero-server/internal/adapter/driven/otelmetrics"
	"budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/port/driven/external"

	"github.com/labstack/echo/v4"
	echomw "github.com/labstack/echo/v4/middleware"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func metricsEcho(t external.HTTPTelemetry) *echo.Echo {
	e := echo.New()
	e.Use(middleware.Metrics(t))
	e.Use(echomw.Recover())
	api := e.Group("/api/v1")
	api.GET("/health", func(c echo.Context) error { return c.NoContent(http.StatusOK) })
	api.GET("/budget-spaces/:spaceID", func(c echo.Context) error { return c.String(http.StatusOK, c.Param("spaceID")) })
	api.DELETE("/budget-spaces/:spaceID/members/:memberID", func(echo.Context) error {
		return echo.NewHTTPError(http.StatusForbidden, "nope")
	})
	api.GET("/bank-relay/:ticket", func(echo.Context) error { return errors.New("boom") })
	api.GET("/panic", func(echo.Context) error { panic("x") })
	return e
}

func serve(e *echo.Echo, method, target string) {
	e.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(method, target, http.NoBody))
}

func TestMetrics_RecordsRouteTemplatesNotRawPaths(t *testing.T) {
	tel := &fake.Telemetry{}
	e := metricsEcho(tel)

	serve(e, http.MethodGet, "/api/v1/budget-spaces/sp_SECRET1?token=abc")
	serve(e, http.MethodDelete, "/api/v1/budget-spaces/sp_SECRET2/members/user_SECRET3")
	serve(e, http.MethodGet, "/api/v1/bank-relay/ticket_SECRET4")
	serve(e, http.MethodGet, "/api/v1/no-such/user_SECRET5")
	serve(e, http.MethodGet, "/assets/index-SECRET6.js")
	serve(e, http.MethodGet, "/api/v1/health")
	serve(e, http.MethodGet, "/api/v1/panic")

	want := []fake.HTTPPoint{
		{Route: "/api/v1/budget-spaces/:spaceID", Method: "GET", Status: 200, RecordDuration: true},
		{Route: "/api/v1/budget-spaces/:spaceID/members/:memberID", Method: "DELETE", Status: 403, RecordDuration: true},
		{Route: "/api/v1/bank-relay/:ticket", Method: "GET", Status: 500, RecordDuration: false},
		{Route: external.RouteUnmatched, Method: "GET", Status: 404, RecordDuration: true},
		{Route: external.RouteStatic, Method: "GET", Status: 404, RecordDuration: true},
		{Route: "/api/v1/health", Method: "GET", Status: 200, RecordDuration: false},
		{Route: "/api/v1/panic", Method: "GET", Status: 500, RecordDuration: true},
	}
	got := tel.Snapshot().HTTP
	if len(got) != len(want) {
		t.Fatalf("recorded %d requests, want %d: %+v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("request %d = %+v, want %+v", i, got[i], want[i])
		}
		if strings.Contains(got[i].Route, "SECRET") {
			t.Errorf("request %d leaked a raw path: %q", i, got[i].Route)
		}
	}
}

// End to end through the real OTel recorder: exported attributes carry no ids.
func TestMetrics_ExportedAttributesCarryNoIDs(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	rec, err := otelmetrics.NewWithReader(reader, "test")
	if err != nil {
		t.Fatal(err)
	}
	e := metricsEcho(rec)
	serve(e, http.MethodGet, "/api/v1/budget-spaces/sp_SECRET1")
	serve(e, http.MethodDelete, "/api/v1/budget-spaces/sp_SECRET2/members/user_SECRET3")
	serve(e, http.MethodGet, "/api/v1/no-such/user_SECRET5")

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatal(err)
	}
	points := 0
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			sum, ok := m.Data.(metricdata.Sum[int64])
			if !ok {
				continue
			}
			for _, p := range sum.DataPoints {
				points++
				for _, kv := range p.Attributes.ToSlice() {
					if strings.Contains(kv.Value.String(), "SECRET") {
						t.Errorf("%s exported %s=%s", m.Name, kv.Key, kv.Value.String())
					}
				}
			}
		}
	}
	if points != 3 {
		t.Errorf("got %d request series, want 3", points)
	}
}

func TestMetrics_DisabledIsPassthrough(t *testing.T) {
	for _, tel := range []external.HTTPTelemetry{nil, external.NoopTelemetry{}} {
		e := metricsEcho(tel)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/health", http.NoBody))
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d", rec.Code)
		}
	}
}
