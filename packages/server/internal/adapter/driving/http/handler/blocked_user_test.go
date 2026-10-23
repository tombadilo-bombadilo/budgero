package handler_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/adapter/driving/http/handler"
	"budgero-server/internal/adapter/driving/http/middleware"
	synchub "budgero-server/internal/adapter/driving/http/websocket"
	"budgero-server/internal/testkit"

	"github.com/labstack/echo/v4"
)

func blockUser(t *testing.T, queries *sqlc.Queries, userID string) {
	t.Helper()
	if err := queries.BlockUser(context.Background(), sqlc.BlockUserParams{IsBlocked: true, ID: userID}); err != nil {
		t.Fatalf("BlockUser() error = %v", err)
	}
}

func requireHTTPStatus(t *testing.T, err error, want int) {
	t.Helper()
	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("error = %v (%T), want echo.HTTPError %d", err, err, want)
	}
	if httpErr.Code != want {
		t.Fatalf("status = %d, want %d (message: %v)", httpErr.Code, want, httpErr.Message)
	}
}

func TestWebSocketHandler_BlockedUserRejected(t *testing.T) {
	h, e, tc, _ := setupTestHandlerWithHub(t)

	userID := testkit.SeedUser(t, tc.Queries, "ws-blocked@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Blocked WS Space")
	blockUser(t, tc.Queries, userID)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/ws/sync?space_id="+spaceID, http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	requireHTTPStatus(t, h.WebSocketHandler(c), http.StatusForbidden)
}

func TestWebSocketHandler_SelfHostBlockedTokenRejected(t *testing.T) {
	h, e, tc := setupSelfHostHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "ws-selfhost-blocked@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Self-host WS Space")
	token, err := middleware.GenerateSelfHostToken(userID, false)
	if err != nil {
		t.Fatalf("GenerateSelfHostToken() error = %v", err)
	}
	blockUser(t, tc.Queries, userID)

	// Token issued before the block stays cryptographically valid; the block
	// flag must still keep the socket from opening.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ws/sync?space_id="+spaceID+"&token="+token, http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	requireHTTPStatus(t, h.WebSocketHandler(c), http.StatusForbidden)
}

func TestBlockUser_ClosesAllOfUsersLiveSockets(t *testing.T) {
	h, e, tc, hub := setupTestHandlerWithHub(t)

	userID := testkit.SeedUser(t, tc.Queries, "to-block@example.com")
	otherID := testkit.SeedUser(t, tc.Queries, "bystander@example.com")
	spaceA := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Space A")
	spaceB := testkit.SeedSpace(t, tc.DB, tc.Queries, otherID, "Space B")
	testkit.SeedMembership(t, tc.Queries, spaceB, userID, "member")

	clientA := synchub.NewClient(hub, nil, userID, spaceA)
	clientB := synchub.NewClient(hub, nil, userID, spaceB)
	bystander := synchub.NewClient(hub, nil, otherID, spaceB)
	hub.Register <- clientA
	hub.Register <- clientB
	hub.Register <- bystander
	awaitHubRegistered(t, hub, spaceA, clientA)
	awaitHubRegistered(t, hub, spaceB, clientB, bystander)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/users/"+userID+"/block", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(userID)

	if err := h.BlockUser(c); err != nil {
		t.Fatalf("BlockUser() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("BlockUser() status = %d, want %d", rec.Code, http.StatusOK)
	}

	awaitSendClosed(t, clientA)
	awaitSendClosed(t, clientB)

	hub.NotifyDatabaseUpdate(spaceB, otherID, 77, "still-here", false)
	deadline := time.After(2 * time.Second)
	for {
		select {
		case msg, ok := <-bystander.Send:
			if !ok {
				t.Fatal("bystander's socket was closed")
			}
			if msg.Version == 77 {
				return
			}
		case <-deadline:
			t.Fatal("bystander stopped receiving broadcasts")
		}
	}
}

func pushMutation(h *handler.Handlers, e *echo.Echo, token string) error {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/push", strings.NewReader(`{"encrypted_payload":"cipher"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	return h.PushMutation(e.NewContext(req, rec))
}

func TestPushMutation_BlockedUserRejected(t *testing.T) {
	h, e, tc := setupTestHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "push-blocked@example.com")
	testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Push Space")

	token := generatePushToken(t, h, e, userID)
	if err := pushMutation(h, e, token); err != nil {
		t.Fatalf("PushMutation() before block error = %v", err)
	}

	blockUser(t, tc.Queries, userID)
	requireHTTPStatus(t, pushMutation(h, e, token), http.StatusForbidden)
}

// generatePushToken creates a push token through the real management endpoint.
func generatePushToken(t *testing.T, h *handler.Handlers, e *echo.Echo, userID string) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/push/token", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)
	if err := h.GeneratePushToken(c); err != nil {
		t.Fatalf("GeneratePushToken() error = %v", err)
	}
	var resp handler.PushTokenResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil || resp.Token == "" {
		t.Fatalf("bad GeneratePushToken response %q: %v", rec.Body.String(), err)
	}
	return resp.Token
}
