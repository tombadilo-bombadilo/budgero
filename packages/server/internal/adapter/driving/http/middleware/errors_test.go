package middleware_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/fake"
	"budgero-server/internal/adapter/driven/posthog"
	appmw "budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/application"
	"budgero-server/internal/domain"
	"budgero-server/internal/domain/analytics"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

type capturedException struct {
	distinctID string
	exc        analytics.ServerException
}

type recordingSink struct {
	mu   sync.Mutex
	excs []capturedException
}

func (r *recordingSink) CaptureException(distinctID string, exc analytics.ServerException) {
	r.mu.Lock()
	r.excs = append(r.excs, capturedException{distinctID, exc})
	r.mu.Unlock()
}

func (r *recordingSink) all() []capturedException {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]capturedException(nil), r.excs...)
}

// captureLogs routes the global logger into a buffer for the test and
// returns the JSON lines written so far.
func captureLogs(t *testing.T) func() []map[string]any {
	t.Helper()
	var buf bytes.Buffer
	prev := log.Logger
	prevLevel := zerolog.GlobalLevel()
	zerolog.SetGlobalLevel(zerolog.DebugLevel)
	log.Logger = zerolog.New(&buf)
	t.Cleanup(func() {
		log.Logger = prev
		zerolog.SetGlobalLevel(prevLevel)
	})
	return func() []map[string]any {
		var out []map[string]any
		for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
			if line == "" {
				continue
			}
			var m map[string]any
			if err := json.Unmarshal([]byte(line), &m); err != nil {
				t.Fatalf("log line is not JSON: %q", line)
			}
			out = append(out, m)
		}
		return out
	}
}

// newApp mirrors the production chain: request id, recover, request logger,
// then the central error handler.
func newApp(sink appmw.ExceptionSink) *echo.Echo {
	e := echo.New()
	e.Use(appmw.RequestIDMiddleware())
	e.Use(middleware.RecoverWithConfig(appmw.RecoverConfig()))
	e.Use(appmw.RequestLogger(nil))
	e.HTTPErrorHandler = appmw.ErrorHandler(sink, "1.2.3")
	return e
}

func withUser(userID string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Set("user_id", userID)
			return next(c)
		}
	}
}

func do(e *echo.Echo, method, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, http.NoBody)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func countLevel(lines []map[string]any, level string) int {
	n := 0
	for _, l := range lines {
		if l["level"] == level {
			n++
		}
	}
	return n
}

func TestErrorHandler_PanicLogsOnceAndCapturesException(t *testing.T) {
	logs := captureLogs(t)
	sink := &recordingSink{}
	e := newApp(sink)
	e.GET("/api/v1/boom/:id", func(echo.Context) error {
		panic("super-secret-panic-value")
	}, withUser("user-7"))

	rec := do(e, http.MethodGet, "/api/v1/boom/42")

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body: %v", err)
	}
	reqID := rec.Header().Get(appmw.HeaderRequestID)
	if body["message"] != "Internal Server Error" || body["request_id"] != reqID || reqID == "" {
		t.Fatalf("body = %v, header id = %q", body, reqID)
	}

	lines := logs()
	if got := countLevel(lines, "error"); got != 1 {
		t.Fatalf("error log lines = %d, want 1: %v", got, lines)
	}
	errLine := lines[0]
	if errLine["request_id"] != reqID || errLine["route"] != "/api/v1/boom/:id" || errLine["user_id"] != "user-7" || errLine["status"] != float64(500) {
		t.Errorf("error line = %v", errLine)
	}
	if stack, _ := errLine["stack"].(string); !strings.Contains(stack, "errors_test.go") {
		t.Errorf("stack missing from log line: %v", errLine)
	}

	excs := sink.all()
	if len(excs) != 1 {
		t.Fatalf("exceptions = %d, want 1", len(excs))
	}
	got := excs[0]
	if got.distinctID != "user-7" {
		t.Errorf("distinct id = %q", got.distinctID)
	}
	exc := got.exc
	if exc.Type != "panic" || exc.Code != analytics.ErrCodePanic || exc.Mechanism != analytics.MechanismPanic ||
		exc.Route != "/api/v1/boom/:id" || exc.Method != "GET" || exc.Status != 500 || exc.RequestID != reqID || exc.ServerVersion != "1.2.3" {
		t.Errorf("exception = %+v", exc)
	}
	if len(exc.Frames) == 0 {
		t.Fatal("no frames")
	}
	last := exc.Frames[len(exc.Frames)-1]
	if last.Filename != "internal/adapter/driving/http/middleware/errors_test.go" || !strings.Contains(last.Function, "TestErrorHandler_PanicLogsOnceAndCapturesException") || last.Line == 0 {
		t.Errorf("crashing frame = %+v (frames %+v)", last, exc.Frames)
	}
	for _, f := range exc.Frames {
		if strings.HasPrefix(f.Filename, "/") || strings.Contains(f.Function, "/") {
			t.Errorf("frame leaks a path: %+v", f)
		}
		if strings.Contains(f.Function, "runtime.") || strings.Contains(f.Filename, "echo") {
			t.Errorf("non-module frame: %+v", f)
		}
	}
}

func TestErrorHandler_InternalErrorCarriesCauseFramesAndCode(t *testing.T) {
	logs := captureLogs(t)
	sink := &recordingSink{}
	e := newApp(sink)
	cause := &fs.PathError{Op: "open", Path: "/data/user_db/secret-user.db", Err: fs.ErrPermission}
	e.PUT("/api/v1/sync/blob", func(echo.Context) error {
		return appmw.InternalError(http.StatusInternalServerError, "failed to store blob", fmt.Errorf("write snapshot: %w", cause))
	})

	rec := do(e, http.MethodPut, "/api/v1/sync/blob")

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", rec.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["message"] != "failed to store blob" || body["request_id"] == "" {
		t.Fatalf("body = %v", body)
	}
	if strings.Contains(rec.Body.String(), "secret-user") {
		t.Fatal("cause leaked into the response body")
	}

	lines := logs()
	if countLevel(lines, "error") != 1 || countLevel(lines, "warn") != 0 {
		t.Fatalf("log lines = %v", lines)
	}
	if errText, _ := lines[0]["error"].(string); !strings.Contains(errText, "write snapshot") || !strings.Contains(errText, "secret-user.db") {
		t.Errorf("server log should carry the cause chain: %v", lines[0])
	}

	excs := sink.all()
	if len(excs) != 1 {
		t.Fatalf("exceptions = %d", len(excs))
	}
	exc := excs[0].exc
	if excs[0].distinctID != "" {
		t.Errorf("unauthenticated request must have no distinct id, got %q", excs[0].distinctID)
	}
	if exc.Type != "*fs.PathError" || exc.Code != analytics.ErrCodeStorage || exc.Mechanism != analytics.MechanismHTTP5xx || exc.Method != "PUT" || exc.Route != "/api/v1/sync/blob" {
		t.Errorf("exception = %+v", exc)
	}
	if len(exc.Frames) == 0 {
		t.Fatal("no frames")
	}
	last := exc.Frames[len(exc.Frames)-1]
	if last.Filename != "internal/adapter/driving/http/middleware/errors_test.go" || !strings.Contains(last.Function, "TestErrorHandler_InternalErrorCarriesCauseFramesAndCode") {
		t.Errorf("capture frame = %+v", last)
	}
}

func TestErrorHandler_PlainErrorAndNonHTTPError(t *testing.T) {
	logs := captureLogs(t)
	sink := &recordingSink{}
	e := newApp(sink)
	e.GET("/plain", func(echo.Context) error { return errors.New("db exploded") })
	e.GET("/httperr", func(echo.Context) error { return echo.NewHTTPError(http.StatusBadGateway, "upstream down") })

	rec := do(e, http.MethodGet, "/plain")
	if rec.Code != 500 || !strings.Contains(rec.Body.String(), `"message":"Internal Server Error"`) || strings.Contains(rec.Body.String(), "exploded") {
		t.Fatalf("plain error response = %d %s", rec.Code, rec.Body.String())
	}
	rec = do(e, http.MethodGet, "/httperr")
	if rec.Code != 502 || !strings.Contains(rec.Body.String(), `"message":"upstream down"`) {
		t.Fatalf("http error response = %d %s", rec.Code, rec.Body.String())
	}

	excs := sink.all()
	if len(excs) != 2 || excs[0].exc.Type != "*errors.errorString" || excs[0].exc.Code != analytics.ErrCodeInternal || excs[1].exc.Type != "*echo.HTTPError" || excs[1].exc.Status != 502 {
		t.Fatalf("exceptions = %+v", excs)
	}
	if countLevel(logs(), "error") != 2 {
		t.Errorf("log lines = %v", logs())
	}
}

func TestErrorHandler_4xxIsNotAnException(t *testing.T) {
	logs := captureLogs(t)
	sink := &recordingSink{}
	e := newApp(sink)
	e.GET("/api/v1/spaces/:id", func(echo.Context) error {
		return echo.NewHTTPError(http.StatusNotFound, "space not found")
	})

	rec := do(e, http.MethodGet, "/api/v1/spaces/abc?token=secret")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d", rec.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["message"] != "space not found" || body["request_id"] != rec.Header().Get(appmw.HeaderRequestID) {
		t.Fatalf("body = %v", body)
	}
	if len(sink.all()) != 0 {
		t.Fatal("4xx must not be reported as an exception")
	}
	lines := logs()
	if countLevel(lines, "warn") != 1 || countLevel(lines, "error") != 0 {
		t.Fatalf("log lines = %v", lines)
	}
	if lines[0]["request_id"] != rec.Header().Get(appmw.HeaderRequestID) || lines[0]["status"] != float64(404) {
		t.Errorf("warn line = %v", lines[0])
	}

	// Unmatched routes keep Echo's 404 and also carry the request id.
	rec = do(e, http.MethodGet, "/nope")
	if rec.Code != 404 || !strings.Contains(rec.Body.String(), `"request_id"`) {
		t.Fatalf("unmatched route response = %d %s", rec.Code, rec.Body.String())
	}

	// HEAD: status only, no body.
	e.HEAD("/head", func(echo.Context) error { return echo.NewHTTPError(http.StatusNotFound, "x") })
	rec = do(e, http.MethodHead, "/head")
	if rec.Code != 404 || rec.Body.Len() != 0 {
		t.Fatalf("HEAD response = %d %q", rec.Code, rec.Body.String())
	}
}

// Secrets planted in a panic value and in a wrapped error message must never
// reach the serialised PostHog batch.
func TestErrorHandler_SecretsNeverReachPostHog(t *testing.T) {
	captureLogs(t)
	const panicSecret = "PANIC-SECRET-7f3a"
	const errSecret = "ERR-SECRET-9c1d"
	const pathSecret = "/srv/budgero/data/user_db/u-9c1d.db"

	var mu sync.Mutex
	var bodies []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		bodies = append(bodies, string(raw))
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	users := fake.NewUserRepository()
	if _, err := users.Create(context.Background(), &domain.User{ID: "u1", Email: "u1@example.com"}); err != nil {
		t.Fatal(err)
	}
	tracker := application.NewAnalyticsService(posthog.NewSender(srv.URL, "phc_test", time.Second), users, application.AnalyticsOptions{})

	e := newApp(tracker)
	e.GET("/api/v1/panic", func(echo.Context) error { panic(panicSecret) }, withUser("u1"))
	e.GET("/api/v1/panic-err", func(echo.Context) error { panic(fmt.Errorf("wrapped %s", panicSecret)) })
	e.GET("/api/v1/wrapped", func(echo.Context) error {
		cause := fmt.Errorf("query users: %w", &fs.PathError{Op: "open", Path: pathSecret, Err: fmt.Errorf("inner %s", errSecret)})
		return appmw.InternalError(http.StatusInternalServerError, "internal server error", cause)
	}, withUser("u1"))
	e.GET("/api/v1/plain", func(echo.Context) error { return errors.New(errSecret) })

	for _, p := range []string{"/api/v1/panic?token=" + errSecret, "/api/v1/panic-err", "/api/v1/wrapped", "/api/v1/plain"} {
		rec := do(e, http.MethodGet, p)
		if rec.Code != 500 {
			t.Fatalf("%s: status %d", p, rec.Code)
		}
		if strings.Contains(rec.Body.String(), "SECRET") || strings.Contains(rec.Body.String(), "user_db") {
			t.Fatalf("%s: response leaks: %s", p, rec.Body.String())
		}
	}
	tracker.Close()

	mu.Lock()
	defer mu.Unlock()
	all := strings.Join(bodies, "\n")
	if all == "" {
		t.Fatal("nothing reached PostHog")
	}
	if strings.Count(all, `"event":"$exception"`) != 4 {
		t.Fatalf("want 4 $exception events, got batch:\n%s", all)
	}
	for _, needle := range []string{panicSecret, errSecret, pathSecret, "user_db", "token=", "query users", "inner ", "permission"} {
		if strings.Contains(all, needle) {
			t.Errorf("PostHog batch contains %q:\n%s", needle, all)
		}
	}
	for _, want := range []string{`"error_code":"panic"`, `"error_code":"storage_error"`, `"error_code":"internal"`, `"distinct_id":"u1"`, `"distinct_id":"server"`, `"$exception_list"`, `"in_app":true`, `"server_version":"1.2.3"`, `"$lib":"budgero-server"`} {
		if !strings.Contains(all, want) {
			t.Errorf("PostHog batch lacks %s:\n%s", want, all)
		}
	}
}

func TestErrorHandler_OptedOutUserExceptionIsDropped(t *testing.T) {
	captureLogs(t)
	users := fake.NewUserRepository()
	for _, u := range []*domain.User{
		{ID: "quiet", Email: "quiet@example.com", IsAnalyticsDisabled: true},
		{ID: "loud", Email: "loud@example.com"},
	} {
		if _, err := users.Create(context.Background(), u); err != nil {
			t.Fatal(err)
		}
	}
	sender := &fake.AnalyticsSender{}
	tracker := application.NewAnalyticsService(sender, users, application.AnalyticsOptions{})

	e := newApp(tracker)
	e.GET("/quiet", func(echo.Context) error { panic("x") }, withUser("quiet"))
	e.GET("/loud", func(echo.Context) error { return errors.New("x") }, withUser("loud"))
	e.GET("/anon", func(echo.Context) error { return errors.New("x") })

	for _, p := range []string{"/quiet", "/loud", "/anon"} {
		if rec := do(e, http.MethodGet, p); rec.Code != 500 {
			t.Fatalf("%s: status %d", p, rec.Code)
		}
	}
	tracker.Close()

	got := sender.Events()
	if len(got) != 2 {
		t.Fatalf("events = %+v, want loud + server only", got)
	}
	ids := []string{got[0].DistinctID, got[1].DistinctID}
	if ids[0] != "loud" || ids[1] != application.ServerDistinctID {
		t.Errorf("distinct ids = %v", ids)
	}
}

func TestErrorHandler_NilSinkStillWritesAndLogs(t *testing.T) {
	logs := captureLogs(t)
	e := newApp(nil)
	e.GET("/x", func(echo.Context) error { panic("boom") })
	rec := do(e, http.MethodGet, "/x")
	if rec.Code != 500 || countLevel(logs(), "error") != 1 {
		t.Fatalf("status %d, logs %v", rec.Code, logs())
	}
}

type fakeNetErr struct{ timeout bool }

func (f fakeNetErr) Error() string   { return "net" }
func (f fakeNetErr) Timeout() bool   { return f.timeout }
func (f fakeNetErr) Temporary() bool { return false }

var _ net.Error = fakeNetErr{}

func TestClassifyError(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	if _, err := db.Exec(`CREATE TABLE t (id TEXT PRIMARY KEY); INSERT INTO t VALUES ('a');`); err != nil {
		t.Fatal(err)
	}
	_, constraintErr := db.Exec(`INSERT INTO t VALUES ('a')`)
	if constraintErr == nil {
		t.Fatal("expected a constraint error")
	}
	_, syntaxErr := db.Exec(`SELEC nonsense`)
	if syntaxErr == nil {
		t.Fatal("expected a syntax error")
	}

	cases := []struct {
		name string
		err  error
		want analytics.ErrorCode
	}{
		{"sqlite constraint", fmt.Errorf("insert: %w", constraintErr), analytics.ErrCodeDBConstraint},
		{"sqlite other", syntaxErr, analytics.ErrCodeDBError},
		{"sql conn done", fmt.Errorf("x: %w", sql.ErrConnDone), analytics.ErrCodeDBError},
		{"deadline", fmt.Errorf("x: %w", context.DeadlineExceeded), analytics.ErrCodeTimeout},
		{"path error", &fs.PathError{Op: "open", Path: "/x", Err: fs.ErrNotExist}, analytics.ErrCodeStorage},
		{"fs not exist", fmt.Errorf("x: %w", fs.ErrNotExist), analytics.ErrCodeStorage},
		{"net timeout", fakeNetErr{timeout: true}, analytics.ErrCodeTimeout},
		{"net other", fmt.Errorf("x: %w", fakeNetErr{}), analytics.ErrCodeUpstream},
		{"plain", errors.New("x"), analytics.ErrCodeInternal},
		{"http error", echo.NewHTTPError(500, "x"), analytics.ErrCodeInternal},
	}
	for _, tc := range cases {
		if got := appmw.ClassifyErrorForTest(tc.err); got != tc.want {
			t.Errorf("%s: code = %s, want %s", tc.name, got, tc.want)
		}
	}
	if got := appmw.RootErrorTypeForTest(fmt.Errorf("a: %w", fmt.Errorf("b: %w", constraintErr))); got != "*sqlite.Error" {
		t.Errorf("root type = %q", got)
	}
	if got := appmw.RootErrorTypeForTest(appmw.InternalError(500, "x", errors.New("y"))); got != "*errors.errorString" {
		t.Errorf("root type through HTTPError+stack = %q", got)
	}
	if got := appmw.RootErrorTypeForTest(echo.NewHTTPError(500, "x")); got != "*echo.HTTPError" {
		t.Errorf("bare HTTPError type = %q", got)
	}
}
