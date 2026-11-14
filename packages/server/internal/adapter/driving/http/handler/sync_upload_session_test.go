package handler_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"budgero-server/internal/adapter/driving/http/handler"
	"budgero-server/internal/adapter/driving/http/middleware"
	synchub "budgero-server/internal/adapter/driving/http/websocket"
	"budgero-server/internal/testkit"

	"github.com/labstack/echo/v4"
)

// postBlobAsSession uploads a blob the way the middleware sees a request
// carrying X-Client-Session (empty session: no header).
func postBlobAsSession(t *testing.T, h *handler.Handlers, e *echo.Echo, userID, spaceID, session string, headers map[string]string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/database/blob?space_id="+spaceID, strings.NewReader("blob"))
	req.Header.Set("Content-Type", "application/octet-stream")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)
	middleware.SetClientSession(c, session)
	if err := h.PostDatabaseBlob(c); err != nil {
		t.Fatalf("PostDatabaseBlob() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("PostDatabaseBlob() status = %d (body %s)", rec.Code, rec.Body.String())
	}
}

// syncStateVersions drains client's sync_state_changed versions up to the
// marker broadcast (the hub delivers in order, so anything sent before the
// marker has arrived by then).
func syncStateVersions(t *testing.T, hub *synchub.Hub, spaceID string, client *synchub.Client, marker int64) []int64 {
	t.Helper()
	hub.NotifyDatabaseUpdate(spaceID, "marker", marker, "marker", false)
	var versions []int64
	deadline := time.After(2 * time.Second)
	for {
		select {
		case msg, ok := <-client.Send:
			if !ok {
				t.Fatal("send channel closed")
			}
			if msg.Type != "sync_state_changed" {
				continue
			}
			if msg.UserID == "marker" && msg.Version == marker {
				return versions
			}
			if msg.UserID == "marker" || msg.UserID == "registration-probe" {
				continue // earlier markers sent while draining other clients
			}
			versions = append(versions, msg.Version)
		case <-deadline:
			t.Fatal("marker broadcast not received")
		}
	}
}

func TestPostDatabaseBlob_NotifiesEverySessionButTheUploader(t *testing.T) {
	h, e, tc, hub := setupTestHandlerWithHub(t)

	userID := testkit.SeedUser(t, tc.Queries, "sessions@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Sessions Space")

	const sessionA = "session-aaaaaaaa"
	const sessionB = "session-bbbbbbbb"
	uploader := synchub.NewClient(hub, nil, userID, spaceID).WithClientSession(sessionA)
	otherTab := synchub.NewClient(hub, nil, userID, spaceID).WithClientSession(sessionB)
	noSession := synchub.NewClient(hub, nil, userID, spaceID)
	for _, client := range []*synchub.Client{uploader, otherTab, noSession} {
		hub.Register <- client
	}
	awaitHubRegistered(t, hub, spaceID, uploader, otherTab, noSession)
	// Out-of-band upload from session A: other sessions must download it, but
	// A must not get its own blob echoed back (it would re-download it).
	postBlobAsSession(t, h, e, userID, spaceID, sessionA, map[string]string{
		"X-Database-Version": "0",
		"X-Mutation-Version": "0",
		"X-Out-Of-Band":      "1",
	})
	if got := syncStateVersions(t, hub, spaceID, uploader, 1001); len(got) != 0 {
		t.Fatalf("uploading session got its own blob announced: %v", got)
	}
	for name, client := range map[string]*synchub.Client{"other session": otherTab, "no-session client": noSession} {
		if got := syncStateVersions(t, hub, spaceID, client, 1001); len(got) != 1 || got[0] != 1 {
			t.Fatalf("%s got %v, want [1]", name, got)
		}
	}

	// An upload without a client session is announced to everyone.
	postBlobAsSession(t, h, e, userID, spaceID, "", map[string]string{
		"X-Database-Version": "1",
		"X-Mutation-Version": "0",
		"X-Out-Of-Band":      "1",
	})
	for name, client := range map[string]*synchub.Client{"session A": uploader, "session B": otherTab, "no-session client": noSession} {
		if got := syncStateVersions(t, hub, spaceID, client, 1002); len(got) != 1 || got[0] != 2 {
			t.Fatalf("%s got %v, want [2]", name, got)
		}
	}
}
