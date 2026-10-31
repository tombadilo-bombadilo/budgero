package middleware_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	appmw "budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/domain/analytics"

	"github.com/labstack/echo/v4"
)

const testSession = "page-load_0123456789"

func doWithSession(e *echo.Echo, method, path, session string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, http.NoBody)
	if session != "" {
		req.Header.Set(appmw.HeaderClientSession, session)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func TestClientSession_AcceptedOrIgnoredByFormat(t *testing.T) {
	e := echo.New()
	e.Use(appmw.RequestIDMiddleware())
	var seen string
	e.GET("/x", func(c echo.Context) error {
		seen = appmw.ClientSession(c)
		return c.NoContent(http.StatusNoContent)
	})

	cases := []struct {
		name, header, want string
	}{
		{"none", "", ""},
		{"valid", testSession, testSession},
		{"min length", "abcdefgh", "abcdefgh"},
		{"max length", strings.Repeat("a", 64), strings.Repeat("a", 64)},
		{"too short", "abc1234", ""},
		{"too long", strings.Repeat("a", 65), ""},
		{"bad chars", "abcd efgh", ""},
		{"injection", "abcdefgh\n\"x", ""},
		{"email-like", "someone@example.com", ""},
	}
	for _, tc := range cases {
		seen = "unset"
		doWithSession(e, http.MethodGet, "/x", tc.header)
		if seen != tc.want {
			t.Errorf("%s: ClientSession = %q, want %q", tc.name, seen, tc.want)
		}
	}
}

func TestSetClientSession_IgnoresMalformedAndKeepsValid(t *testing.T) {
	e := echo.New()
	c := e.NewContext(httptest.NewRequest(http.MethodGet, "/", http.NoBody), httptest.NewRecorder())
	appmw.SetClientSession(c, "bad id")
	if got := appmw.ClientSession(c); got != "" {
		t.Fatalf("malformed id stored: %q", got)
	}
	appmw.SetClientSession(c, testSession)
	appmw.SetClientSession(c, "x")
	if got := appmw.ClientSession(c); got != testSession {
		t.Fatalf("ClientSession = %q, want %q", got, testSession)
	}
}

func TestLogger_CarriesClientSession(t *testing.T) {
	logs := captureLogs(t)
	e := echo.New()
	e.Use(appmw.RequestIDMiddleware())
	e.GET("/x", func(c echo.Context) error {
		logger := appmw.Logger(c)
		logger.Info().Msg("hello")
		return c.NoContent(http.StatusNoContent)
	})

	doWithSession(e, http.MethodGet, "/x", testSession)
	doWithSession(e, http.MethodGet, "/x", "")

	lines := logs()
	if len(lines) != 2 {
		t.Fatalf("lines = %v", lines)
	}
	if lines[0]["client_session"] != testSession {
		t.Errorf("line with session = %v", lines[0])
	}
	if _, ok := lines[1]["client_session"]; ok {
		t.Errorf("line without session must not carry the field: %v", lines[1])
	}
}

func TestRequestLogger_FailedRequestCarriesClientSession(t *testing.T) {
	logs := captureLogs(t)
	e := newApp(&recordingSink{})
	e.GET("/api/v1/spaces/:id", func(echo.Context) error {
		return echo.NewHTTPError(http.StatusNotFound, "space not found")
	})

	rec := doWithSession(e, http.MethodGet, "/api/v1/spaces/abc", testSession)

	lines := logs()
	if countLevel(lines, "warn") != 1 {
		t.Fatalf("lines = %v", lines)
	}
	if lines[0]["client_session"] != testSession || lines[0]["request_id"] != rec.Header().Get(appmw.HeaderRequestID) {
		t.Errorf("warn line = %v", lines[0])
	}
}

func TestErrorHandler_ExceptionCarriesClientSession(t *testing.T) {
	captureLogs(t)
	sink := &recordingSink{}
	e := newApp(sink)
	e.GET("/boom", func(echo.Context) error { return errors.New("db exploded") })

	doWithSession(e, http.MethodGet, "/boom", testSession)
	doWithSession(e, http.MethodGet, "/boom", "not a session")

	excs := sink.all()
	if len(excs) != 2 {
		t.Fatalf("exceptions = %d", len(excs))
	}
	if excs[0].exc.ClientSession != testSession {
		t.Errorf("exception session = %q", excs[0].exc.ClientSession)
	}
	if got := excs[0].exc.Event().Properties()["client_session"]; got != testSession {
		t.Errorf("client_session prop = %q", got)
	}
	if _, ok := excs[1].exc.Event().Properties()["client_session"]; ok {
		t.Errorf("malformed session must not reach the event: %+v", excs[1].exc)
	}
	if excs[0].exc.Level != (analytics.ExceptionLevel{}) || excs[0].exc.Event().Properties()["$exception_level"] != "error" || excs[0].exc.Handled {
		t.Errorf("5xx must stay an unhandled error: %+v", excs[0].exc)
	}
}

var testRefusal = appmw.Refusal{Type: "SnapshotRegression", Code: analytics.ErrCodeSnapshotRegression, Status: http.StatusConflict}

func TestReportRefusal_OneHandledWarningPerRequest(t *testing.T) {
	captureLogs(t)
	sink := &recordingSink{}
	e := newApp(sink)
	e.POST("/api/v1/database/blob", func(c echo.Context) error {
		appmw.ReportRefusal(c, sink, "1.2.3", testRefusal)
		// A second report, and a failure surfacing afterwards, add nothing.
		appmw.ReportRefusal(c, sink, "1.2.3", testRefusal)
		return errors.New("write failed after refusal")
	}, withUser("user-9"))

	rec := doWithSession(e, http.MethodPost, "/api/v1/database/blob", testSession)

	excs := sink.all()
	if len(excs) != 1 {
		t.Fatalf("exceptions = %d, want 1: %+v", len(excs), excs)
	}
	got := excs[0]
	if got.distinctID != "user-9" {
		t.Errorf("distinct id = %q", got.distinctID)
	}
	exc := got.exc
	if exc.Type != "SnapshotRegression" || exc.Code != analytics.ErrCodeSnapshotRegression || exc.Mechanism != analytics.MechanismRefusal ||
		exc.Level != analytics.LevelWarning || !exc.Handled || exc.Status != http.StatusConflict ||
		exc.Route != "/api/v1/database/blob" || exc.Method != http.MethodPost ||
		exc.RequestID != rec.Header().Get(appmw.HeaderRequestID) || exc.ClientSession != testSession || exc.ServerVersion != "1.2.3" {
		t.Errorf("exception = %+v", exc)
	}
	if len(exc.Frames) == 0 || exc.Frames[len(exc.Frames)-1].Filename != "internal/adapter/driving/http/middleware/clientsession_test.go" {
		t.Errorf("frames should end at the capture point: %+v", exc.Frames)
	}

	ev := exc.Event()
	props := ev.Properties()
	if props["$exception_level"] != "warning" || props["error_code"] != "snapshot_regression" || props["status"] != "409" ||
		props["client_session"] != testSession || props["request_id"] != exc.RequestID {
		t.Errorf("props = %v", props)
	}
	list, _ := ev.Payload()["$exception_list"].([]map[string]any)
	mech, _ := list[0]["mechanism"].(map[string]any)
	if mech["handled"] != true || mech["type"] != "refusal" {
		t.Errorf("mechanism = %v", mech)
	}
}

func TestReportRefusal_NilSinkIsSafe(t *testing.T) {
	e := echo.New()
	c := e.NewContext(httptest.NewRequest(http.MethodPost, "/", http.NoBody), httptest.NewRecorder())
	appmw.ReportRefusal(c, nil, "", testRefusal)
}
