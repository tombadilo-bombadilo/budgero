package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"budgero-server/internal/adapter/driving/http/handler"
	appmw "budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/domain/analytics"
	"budgero-server/internal/testkit"

	"github.com/labstack/echo/v4"
)

const (
	refusalTestSession   = "page-load_0123456789"
	refusalTestRequestID = "req-refusal-0001"
	blobRoute            = "/api/v1/database/blob"
)

type refusalFixture struct {
	e       *echo.Echo
	tc      *testkit.TestContext
	tracker *recordingTracker
	userID  string
	spaceID string
}

// newRefusalFixture serves PostDatabaseBlob behind the production request-id
// and error-handler chain, records exceptions, and seeds a space whose blob
// is at sync version 1 bound to mutation 19369.
func newRefusalFixture(t *testing.T) *refusalFixture {
	t.Helper()
	sqlDB, queries, services, cfg := testkit.NewTestServices(t, false)
	tracker := &recordingTracker{}
	services.Analytics = tracker
	h := handler.NewHandlers(services, nil, handler.Options{Config: cfg})
	f := &refusalFixture{e: echo.New(), tc: &testkit.TestContext{DB: sqlDB, Queries: queries}, tracker: tracker}
	f.userID = testkit.SeedUser(t, queries, "refusal@example.com")
	f.spaceID = testkit.SeedSpace(t, sqlDB, queries, f.userID, "Refusal Space")

	f.e.Use(appmw.RequestIDMiddleware())
	f.e.HTTPErrorHandler = appmw.ErrorHandler(tracker, "test")
	f.e.POST(blobRoute, h.PostDatabaseBlob, func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Set("user_id", f.userID)
			return next(c)
		}
	})

	rec := f.upload("blob-full", map[string]string{"X-Database-Version": "0", "X-Mutation-Version": "19369"})
	if rec.Code != http.StatusOK {
		t.Fatalf("first upload status = %d body %s", rec.Code, rec.Body.String())
	}
	if n := len(tracker.exceptions()); n != 0 {
		t.Fatalf("a successful upload reported %d exceptions", n)
	}
	return f
}

func (f *refusalFixture) upload(body string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, blobRoute+"?space_id="+f.spaceID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set(appmw.HeaderRequestID, refusalTestRequestID)
	req.Header.Set(appmw.HeaderClientSession, refusalTestSession)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	f.e.ServeHTTP(rec, req)
	return rec
}

// requireOneRefusal asserts the request produced exactly one handled warning
// exception with the given type, code and status, carrying the request id
// and client session and no message text.
func (f *refusalFixture) requireOneRefusal(t *testing.T, typ string, code analytics.ErrorCode, status int) {
	t.Helper()
	excs := f.tracker.exceptions()
	if len(excs) != 1 {
		t.Fatalf("exceptions = %d, want 1", len(excs))
	}
	got := excs[0]
	if got.distinctID != f.userID {
		t.Errorf("distinct id = %q, want the user", got.distinctID)
	}
	exc := got.exc
	if exc.Type != typ || exc.Code != code || exc.Status != status || exc.Level != analytics.LevelWarning || !exc.Handled ||
		exc.Mechanism != analytics.MechanismRefusal || exc.Route != blobRoute || exc.Method != http.MethodPost ||
		exc.RequestID != refusalTestRequestID || exc.ClientSession != refusalTestSession || exc.ServerVersion == "" {
		t.Errorf("exception = %+v", exc)
	}
	if len(exc.Frames) == 0 || exc.Frames[len(exc.Frames)-1].Filename != "internal/adapter/driving/http/handler/sync.go" {
		t.Errorf("frames should end in the handler: %+v", exc.Frames)
	}

	ev := exc.Event()
	props := ev.Properties()
	if props["$exception_level"] != "warning" || props["error_code"] != code.String() ||
		props["request_id"] != refusalTestRequestID || props["client_session"] != refusalTestSession {
		t.Errorf("props = %v", props)
	}
	raw, err := json.Marshal(map[string]any{"props": props, "payload": ev.Payload()})
	if err != nil {
		t.Fatal(err)
	}
	for _, leak := range []string{"message", "Download", "re-enter", "update the app", "conflict.", f.spaceID} {
		if strings.Contains(string(raw), leak) {
			t.Errorf("event carries %q: %s", leak, raw)
		}
	}
}

func TestPostDatabaseBlob_RegressionReportsOneWarningException(t *testing.T) {
	f := newRefusalFixture(t)

	rec := f.upload("blob-near-empty", map[string]string{"X-Database-Version": "1", "X-Mutation-Version": "25"})

	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "mutation_version_regression") {
		t.Fatalf("status = %d body %s", rec.Code, rec.Body.String())
	}
	f.requireOneRefusal(t, "SnapshotRegression", analytics.ErrCodeSnapshotRegression, http.StatusConflict)
}

func TestPostDatabaseBlob_VersionConflictReportsSnapshotConflict(t *testing.T) {
	f := newRefusalFixture(t)

	// Base version 0 against a server that already has data.
	rec := f.upload("blob-other", map[string]string{"X-Database-Version": "0", "X-Mutation-Version": "19369"})

	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "version_conflict") {
		t.Fatalf("status = %d body %s", rec.Code, rec.Body.String())
	}
	f.requireOneRefusal(t, "SnapshotConflict", analytics.ErrCodeSnapshotConflict, http.StatusConflict)
}

func TestPostDatabaseBlob_StaleKeyReportsEncryptionKeyOutdated(t *testing.T) {
	f := newRefusalFixture(t)
	if _, err := f.tc.DB.ExecContext(context.Background(),
		"UPDATE budget_space_blobs SET encryption_key_version = 5 WHERE space_id = ?", f.spaceID); err != nil {
		t.Fatal(err)
	}

	rec := f.upload("blob-v2", map[string]string{
		"X-Database-Version":       "1",
		"X-Mutation-Version":       "19370",
		"X-Encryption-Key-Version": "1",
	})

	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "encryption_key_outdated") {
		t.Fatalf("status = %d body %s", rec.Code, rec.Body.String())
	}
	f.requireOneRefusal(t, "EncryptionKeyOutdated", analytics.ErrCodeEncryptionKeyOutdated, http.StatusConflict)
}

func TestPostDatabaseBlob_NewerFormatReportsFormatTooNew(t *testing.T) {
	f := newRefusalFixture(t)
	setBlobFormat(t, f.tc.DB, f.spaceID, 2)

	// A legacy client (no format header) over a format-2 blob.
	rec := f.upload("blob-legacy", map[string]string{"X-Database-Version": "1", "X-Mutation-Version": "19370"})

	if rec.Code != http.StatusUpgradeRequired {
		t.Fatalf("status = %d body %s", rec.Code, rec.Body.String())
	}
	f.requireOneRefusal(t, "FormatTooNew", analytics.ErrCodeFormatTooNew, http.StatusUpgradeRequired)
}

func TestWebSocketHandler_ReadsClientSessionQueryParam(t *testing.T) {
	h, e, _ := setupTestHandler(t)
	for _, tc := range []struct{ param, want string }{
		{refusalTestSession, refusalTestSession},
		{"bad session!", ""},
		{"", ""},
	} {
		target := "/api/v1/ws/sync?space_id=x"
		if tc.param != "" {
			target += "&client_session=" + strings.ReplaceAll(tc.param, " ", "%20")
		}
		c := e.NewContext(httptest.NewRequest(http.MethodGet, target, http.NoBody), httptest.NewRecorder())
		// Unauthenticated: refused before any upgrade, after the session is read.
		requireHTTPStatus(t, h.WebSocketHandler(c), http.StatusUnauthorized)
		if got := appmw.ClientSession(c); got != tc.want {
			t.Errorf("client_session %q: ClientSession = %q, want %q", tc.param, got, tc.want)
		}
	}
}
