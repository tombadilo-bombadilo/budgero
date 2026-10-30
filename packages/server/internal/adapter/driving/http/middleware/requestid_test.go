package middleware_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"

	appmw "budgero-server/internal/adapter/driving/http/middleware"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

var hex32 = regexp.MustCompile(`^[0-9a-f]{32}$`)

func TestRequestID_MintsOrKeepsClientID(t *testing.T) {
	e := echo.New()
	e.Use(appmw.RequestIDMiddleware())
	var seen string
	e.GET("/x", func(c echo.Context) error {
		seen = appmw.RequestID(c)
		return c.NoContent(http.StatusNoContent)
	})

	cases := []struct {
		name, header string
		kept         bool
	}{
		{"none", "", false},
		{"valid", "client-req_0123456789", true},
		{"too short", "abc1234", false},
		{"too long", string(bytes.Repeat([]byte("a"), 65)), false},
		{"bad chars", "abcd efgh ijkl", false},
		{"injection", "abcdefgh\n\"x", false},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(http.MethodGet, "/x", http.NoBody)
		if tc.header != "" {
			req.Header.Set(appmw.HeaderRequestID, tc.header)
		}
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)

		got := rec.Header().Get(appmw.HeaderRequestID)
		if got != seen {
			t.Errorf("%s: header %q != context %q", tc.name, got, seen)
		}
		if tc.kept && got != tc.header {
			t.Errorf("%s: client id %q replaced by %q", tc.name, tc.header, got)
		}
		if !tc.kept && !hex32.MatchString(got) {
			t.Errorf("%s: minted id %q is not 32 hex chars", tc.name, got)
		}
	}
}

func TestRequestID_TwoRequestsDiffer(t *testing.T) {
	e := echo.New()
	e.Use(appmw.RequestIDMiddleware())
	e.GET("/x", func(c echo.Context) error { return c.NoContent(http.StatusNoContent) })
	ids := map[string]bool{}
	for range 5 {
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", http.NoBody))
		ids[rec.Header().Get(appmw.HeaderRequestID)] = true
	}
	if len(ids) != 5 {
		t.Fatalf("got %d distinct ids out of 5", len(ids))
	}
}

func TestLogger_CarriesRequestRouteAndUser(t *testing.T) {
	var buf bytes.Buffer
	prev := log.Logger
	log.Logger = zerolog.New(&buf)
	t.Cleanup(func() { log.Logger = prev })

	e := echo.New()
	e.Use(appmw.RequestIDMiddleware())
	e.GET("/api/v1/spaces/:id", func(c echo.Context) error {
		c.Set("user_id", "user-1")
		logger := appmw.Logger(c)
		logger.Info().Msg("hello")
		return c.NoContent(http.StatusNoContent)
	})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/spaces/abc", http.NoBody)
	req.Header.Set(appmw.HeaderRequestID, "fixed-request-id")
	e.ServeHTTP(httptest.NewRecorder(), req)

	var line map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &line); err != nil {
		t.Fatalf("log line: %v (%q)", err, buf.String())
	}
	if line["request_id"] != "fixed-request-id" || line["route"] != "/api/v1/spaces/:id" || line["user_id"] != "user-1" || line["message"] != "hello" {
		t.Errorf("line = %v", line)
	}

	// Outside a request (no middleware, no user) the fields are simply absent.
	buf.Reset()
	c := e.NewContext(httptest.NewRequest(http.MethodGet, "/", http.NoBody), httptest.NewRecorder())
	logger := appmw.Logger(c)
	logger.Info().Msg("bare")
	var bare map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &bare); err != nil {
		t.Fatal(err)
	}
	if _, ok := bare["request_id"]; ok {
		t.Errorf("bare context should have no request_id: %v", bare)
	}
	if _, ok := bare["user_id"]; ok {
		t.Errorf("bare context should have no user_id: %v", bare)
	}
}
