package handler_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/fake"
	"budgero-server/internal/adapter/driving/http/handler"
	synchub "budgero-server/internal/adapter/driving/http/websocket"
	"budgero-server/internal/port/driven/external"
	"budgero-server/internal/testkit"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

func setupTelemetryHandler(t *testing.T) (*handler.Handlers, *echo.Echo, *testkit.TestContext, *synchub.Hub, *fake.Telemetry) {
	t.Helper()
	sqlDB, queries, services, cfg := testkit.NewTestServices(t, false)
	ml, err := synchub.NewMutationLog(sqlDB)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}
	tel := &fake.Telemetry{}
	hub := synchub.NewHub(ml)
	hub.SetTelemetry(tel)
	go hub.Run()
	h := handler.NewHandlers(services, hub, handler.Options{Config: cfg, Telemetry: tel})
	return h, echo.New(), &testkit.TestContext{DB: sqlDB, Queries: queries}, hub, tel
}

func wsAttempt(h *handler.Handlers, e *echo.Echo, userID, spaceID string) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ws/sync?space_id="+spaceID, http.NoBody)
	c := e.NewContext(req, httptest.NewRecorder())
	if userID != "" {
		setUserContext(c, userID)
	}
	_ = h.WebSocketHandler(c)
}

func TestTelemetry_WebSocketRefusals(t *testing.T) {
	h, e, tc, _, tel := setupTelemetryHandler(t)
	owner := testkit.SeedUser(t, tc.Queries, "ws-owner@example.com")
	stranger := testkit.SeedUser(t, tc.Queries, "ws-stranger@example.com")
	blocked := testkit.SeedUser(t, tc.Queries, "ws-blocked-tel@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, owner, "Owner Space")
	blockUser(t, tc.Queries, blocked)

	wsAttempt(h, e, "", spaceID)       // no token: the 401 reconnect loop
	wsAttempt(h, e, blocked, spaceID)  // blocked account
	wsAttempt(h, e, stranger, spaceID) // not a member of the space

	got := tel.Snapshot().WSAttempts
	want := []external.WSOutcome{external.WSOutcomeUnauthenticated, external.WSOutcomeBlocked, external.WSOutcomeForbidden}
	if len(got) != len(want) {
		t.Fatalf("attempts = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("attempt %d = %s, want %s", i, got[i], want[i])
		}
	}
}

func TestTelemetry_WebSocketSessionCountsSyncTraffic(t *testing.T) {
	h, _, tc, hub, tel := setupTelemetryHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "ws-ok@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "WS Space")

	e := echo.New()
	e.GET("/api/v1/ws/sync", h.WebSocketHandler, func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			setUserContext(c, userID)
			return next(c)
		}
	})
	srv := httptest.NewServer(e)
	defer srv.Close()

	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/ws/sync?space_id=" + spaceID
	conn, resp, err := websocket.DefaultDialer.Dial(url, http.Header{"Origin": {"http://localhost:5173"}})
	if err != nil {
		t.Fatalf("dial: %v (resp %v)", err, resp)
	}
	defer func() { _ = conn.Close() }()
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}

	msgs := []string{
		`{"type":"mutation","id":"m1","baseVersion":0,"encryptedPayload":"x","timestamp":"2026-01-01T00:00:00Z"}`,
		`{"type":"mutation","id":5}`, // id must be a string: rejected as invalid
		`{"type":"catch_up_request","sinceVersion":0}`,
	}
	for _, m := range msgs {
		if err := conn.WriteMessage(websocket.TextMessage, []byte(m)); err != nil {
			t.Fatalf("write: %v", err)
		}
	}

	deadline := time.Now().Add(3 * time.Second)
	for {
		s := tel.Snapshot()
		if s.CatchUps == 1 && len(s.Processed) == 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("telemetry did not settle: %+v", s)
		}
		time.Sleep(10 * time.Millisecond)
	}
	s := tel.Snapshot()
	if len(s.WSAttempts) != 1 || s.WSAttempts[0] != external.WSOutcomeOK {
		t.Errorf("attempts = %v, want [ok]", s.WSAttempts)
	}
	if s.Received != 2 || s.Processed[0] != external.MutationAppended || s.Processed[1] != external.MutationRejectedInvalid {
		t.Errorf("received=%d processed=%v", s.Received, s.Processed)
	}
	if n := tel.WSConnections(); n != 1 || hub.ConnectionCount() != 1 {
		t.Errorf("open connections gauge = %d, want 1", n)
	}
}

func TestTelemetry_BlobUploadOutcomes(t *testing.T) {
	h, e, tc, _, tel := setupTelemetryHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "blob-tel@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Blob Space")

	steps := []struct {
		body    string
		headers map[string]string
	}{
		{"blob-v1", map[string]string{"X-Database-Version": "0", "X-Mutation-Version": "0"}},  // ok
		{"blob-bad", map[string]string{"X-Database-Version": "5", "X-Mutation-Version": "0"}}, // lost CAS
		{"", map[string]string{"X-Database-Version": "1"}},                                    // empty body
	}
	for i, s := range steps {
		if _, err := postBlob(t, h, e, userID, spaceID, s.body, s.headers); err != nil && i != 2 {
			t.Fatalf("step %d: %v", i, err)
		}
	}
	got := tel.Snapshot()
	want := []external.BlobUploadOutcome{external.BlobUploadOK, external.BlobUploadCASConflict, external.BlobUploadRejected}
	if len(got.Blobs) != len(want) {
		t.Fatalf("blob outcomes = %v, want %v", got.Blobs, want)
	}
	for i := range want {
		if got.Blobs[i] != want[i] {
			t.Errorf("upload %d = %s, want %s", i, got.Blobs[i], want[i])
		}
	}
	if got.BlobBytes[0] != int64(len("blob-v1")) {
		t.Errorf("size = %d, want %d", got.BlobBytes[0], len("blob-v1"))
	}
}
