package handler_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"budgero-server/internal/adapter/driving/http/handler"
	synchub "budgero-server/internal/adapter/driving/http/websocket"
	"budgero-server/internal/testkit"

	"github.com/labstack/echo/v4"
)

// setupTestHandlerWithHub creates a handler wired to a running sync hub, as in
// production, so hub side effects (client disconnects, mutation-log resets)
// can be asserted.
func setupTestHandlerWithHub(t *testing.T) (*handler.Handlers, *echo.Echo, *testkit.TestContext, *synchub.Hub) {
	t.Helper()
	sqlDB, queries, services, cfg := testkit.NewTestServices(t, false)

	ml, err := synchub.NewMutationLog(sqlDB)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}
	hub := synchub.NewHub(ml)
	go hub.Run()

	h := handler.NewHandlers(services, hub, handler.Options{
		SelfHost: false,
		Config:   cfg,
	})

	e := echo.New()
	return h, e, &testkit.TestContext{DB: sqlDB, Queries: queries}, hub
}

// awaitHubRegistered blocks until every listed client has received a broadcast,
// proving the hub's Run loop processed their registration.
func awaitHubRegistered(t *testing.T, hub *synchub.Hub, spaceID string, clients ...*synchub.Client) {
	t.Helper()
	pending := make(map[*synchub.Client]bool, len(clients))
	for _, client := range clients {
		pending[client] = true
	}
	deadline := time.Now().Add(2 * time.Second)
	for len(pending) > 0 {
		if time.Now().After(deadline) {
			t.Fatalf("%d client(s) not registered in time", len(pending))
		}
		hub.NotifyDatabaseUpdate(spaceID, "registration-probe", 0, "probe", false)
		for client := range pending {
			select {
			case _, ok := <-client.Send:
				if !ok {
					t.Fatal("send channel closed while awaiting registration")
				}
				delete(pending, client)
			case <-time.After(10 * time.Millisecond):
			}
		}
	}
}

// awaitSendClosed drains a client's Send channel until it is closed.
func awaitSendClosed(t *testing.T, client *synchub.Client) {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		select {
		case _, ok := <-client.Send:
			if !ok {
				return
			}
		case <-deadline:
			t.Fatal("send channel was not closed in time")
		}
	}
}

// postBlob performs a PostDatabaseBlob request and returns the recorder.
func postBlob(t *testing.T, h *handler.Handlers, e *echo.Echo, userID, spaceID, body string, headers map[string]string) (*httptest.ResponseRecorder, error) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/database/blob?space_id="+spaceID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/octet-stream")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)
	return rec, h.PostDatabaseBlob(c)
}

func TestPostDatabaseBlob_CASConflict_Returns409AndKeepsFile(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "cas@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "CAS Space")

	// First upload against base version 0 succeeds and yields version 1.
	rec, err := postBlob(t, h, e, userID, spaceID, "blob-v1", map[string]string{
		"X-Database-Version": "0",
		"X-Mutation-Version": "0",
	})
	if err != nil {
		t.Fatalf("first PostDatabaseBlob() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("first upload status = %d, want %d (body %s)", rec.Code, http.StatusOK, rec.Body.String())
	}
	var okResp map[string]any
	if unmarshalErr := json.Unmarshal(rec.Body.Bytes(), &okResp); unmarshalErr != nil {
		t.Fatalf("failed to parse response: %v", unmarshalErr)
	}
	if okResp["version"] != float64(1) {
		t.Fatalf("first upload version = %v, want 1", okResp["version"])
	}

	// An upload claiming a base version the server never issued must lose the
	// compare-and-swap and get a 409 without touching the stored blob.
	rec, err = postBlob(t, h, e, userID, spaceID, "blob-imposter", map[string]string{
		"X-Database-Version": "5",
		"X-Mutation-Version": "0",
	})
	if err != nil {
		t.Fatalf("second PostDatabaseBlob() error = %v", err)
	}
	if rec.Code != http.StatusConflict {
		t.Fatalf("stale upload status = %d, want %d (body %s)", rec.Code, http.StatusConflict, rec.Body.String())
	}
	var conflict map[string]any
	if unmarshalErr := json.Unmarshal(rec.Body.Bytes(), &conflict); unmarshalErr != nil {
		t.Fatalf("failed to parse conflict response: %v", unmarshalErr)
	}
	if conflict["error"] != "version_conflict" {
		t.Fatalf("error = %v, want version_conflict", conflict["error"])
	}
	if conflict["server_version"] != float64(1) {
		t.Fatalf("server_version = %v, want 1", conflict["server_version"])
	}

	// The losing upload must not have overwritten the file (CAS runs first).
	blob, blobErr := tc.Queries.GetSpaceBlob(context.Background(), spaceID)
	if blobErr != nil {
		t.Fatalf("GetSpaceBlob() error = %v", blobErr)
	}
	if blob.SyncVersion != 1 {
		t.Fatalf("stored sync_version = %d, want 1", blob.SyncVersion)
	}
	content, readErr := os.ReadFile(blob.BlobPath)
	if readErr != nil {
		t.Fatalf("failed to read blob file: %v", readErr)
	}
	if string(content) != "blob-v1" {
		t.Fatalf("blob file content = %q, want %q", string(content), "blob-v1")
	}
}

func TestPostDatabaseBlob_SameBaseVersionTwice_SecondConflicts(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "cas-race@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "CAS Race Space")

	headers := map[string]string{
		"X-Database-Version": "0",
		"X-Mutation-Version": "0",
	}

	rec, err := postBlob(t, h, e, userID, spaceID, "writer-a", headers)
	if err != nil {
		t.Fatalf("first PostDatabaseBlob() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("first upload status = %d, want %d", rec.Code, http.StatusOK)
	}

	// Second upload against the same base version must conflict, not clobber.
	rec, err = postBlob(t, h, e, userID, spaceID, "writer-b", headers)
	if err != nil {
		t.Fatalf("second PostDatabaseBlob() error = %v", err)
	}
	if rec.Code != http.StatusConflict {
		t.Fatalf("second upload status = %d, want %d (body %s)", rec.Code, http.StatusConflict, rec.Body.String())
	}
	var conflict map[string]any
	if unmarshalErr := json.Unmarshal(rec.Body.Bytes(), &conflict); unmarshalErr != nil {
		t.Fatalf("failed to parse conflict response: %v", unmarshalErr)
	}
	if conflict["error"] != "version_conflict" {
		t.Fatalf("error = %v, want version_conflict", conflict["error"])
	}

	blob, blobErr := tc.Queries.GetSpaceBlob(context.Background(), spaceID)
	if blobErr != nil {
		t.Fatalf("GetSpaceBlob() error = %v", blobErr)
	}
	content, readErr := os.ReadFile(blob.BlobPath)
	if readErr != nil {
		t.Fatalf("failed to read blob file: %v", readErr)
	}
	if string(content) != "writer-a" {
		t.Fatalf("blob file content = %q, want %q", string(content), "writer-a")
	}
}

func TestPostDatabaseBlob_InvalidMutationVersionHeader_Returns400(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "bad-header@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Bad Header Space")

	_, err := postBlob(t, h, e, userID, spaceID, "blob-data", map[string]string{
		"X-Database-Version": "0",
		"X-Mutation-Version": "not-a-number",
	})
	if err == nil {
		t.Fatal("PostDatabaseBlob() expected error for invalid X-Mutation-Version header")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusBadRequest {
		t.Fatalf("PostDatabaseBlob() status = %d, want %d", httpErr.Code, http.StatusBadRequest)
	}
}

func TestRemoveBudgetSpaceMember_ClosesRemovedMembersClients(t *testing.T) {
	h, e, tc, hub := setupTestHandlerWithHub(t)

	ownerID := testkit.SeedUser(t, tc.Queries, "owner-socket@example.com")
	memberID := testkit.SeedUser(t, tc.Queries, "member-socket@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, ownerID, "Socket Space")
	testkit.SeedMembership(t, tc.Queries, spaceID, memberID, "member")

	memberClient := synchub.NewClient(hub, nil, memberID, spaceID)
	ownerClient := synchub.NewClient(hub, nil, ownerID, spaceID)
	hub.Register <- memberClient
	hub.Register <- ownerClient
	awaitHubRegistered(t, hub, spaceID, memberClient, ownerClient)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/budget-spaces/"+spaceID+"/members/"+memberID, http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("spaceID", "memberID")
	c.SetParamValues(spaceID, memberID)
	setUserContext(c, ownerID)

	if err := h.RemoveBudgetSpaceMember(c); err != nil {
		t.Fatalf("RemoveBudgetSpaceMember() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("RemoveBudgetSpaceMember() status = %d, want %d", rec.Code, http.StatusOK)
	}

	// The removed member's live socket must be closed...
	awaitSendClosed(t, memberClient)

	// ...while the owner's client keeps receiving broadcasts.
	hub.NotifyDatabaseUpdate(spaceID, ownerID, 99, "owner-still-connected", false)
	deadline := time.After(2 * time.Second)
	for {
		select {
		case msg, ok := <-ownerClient.Send:
			if !ok {
				t.Fatal("owner client's send channel was closed")
			}
			if msg.Version == 99 {
				return
			}
		case <-deadline:
			t.Fatal("owner client did not receive broadcast after member removal")
		}
	}
}

func TestDeleteBudgetSpace_ClearsMutationLogAndDisconnectsClients(t *testing.T) {
	h, e, tc, hub := setupTestHandlerWithHub(t)

	ownerID := testkit.SeedUser(t, tc.Queries, "owner-delete@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, ownerID, "Doomed Space")

	testkit.SeedMutation(t, tc.Queries, spaceID, ownerID, 1, "cipher-1")
	testkit.SeedMutation(t, tc.Queries, spaceID, ownerID, 2, "cipher-2")

	client := synchub.NewClient(hub, nil, ownerID, spaceID)
	hub.Register <- client
	awaitHubRegistered(t, hub, spaceID, client)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/budget-spaces/"+spaceID, http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("spaceID")
	c.SetParamValues(spaceID)
	setUserContext(c, ownerID)

	if err := h.DeleteBudgetSpace(c); err != nil {
		t.Fatalf("DeleteBudgetSpace() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("DeleteBudgetSpace() status = %d, want %d", rec.Code, http.StatusOK)
	}

	var count int
	if queryErr := tc.DB.QueryRowContext(
		context.Background(),
		"SELECT COUNT(*) FROM mutation_log WHERE space_id = ?",
		spaceID,
	).Scan(&count); queryErr != nil {
		t.Fatalf("failed to count mutation_log rows: %v", queryErr)
	}
	if count != 0 {
		t.Fatalf("mutation_log rows after deletion = %d, want 0", count)
	}

	awaitSendClosed(t, client)
}
