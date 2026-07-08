package websocket_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"budgero-server/internal/adapter/driving/http/websocket"

	gws "github.com/gorilla/websocket"
)

// dialPumpServer spins up a websocket endpoint that mirrors the production
// handler wiring (register with hub, WritePump goroutine, ReadPump inline) and
// returns the dialed peer connection plus the server-side client.
func dialPumpServer(t *testing.T, hub *websocket.Hub, spaceID string) (*gws.Conn, *websocket.Client) {
	t.Helper()

	upgrader := gws.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	clientCh := make(chan *websocket.Client, 1)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade failed: %v", err)
			return
		}
		client := websocket.NewClient(hub, conn, "user-1", spaceID)
		hub.Register <- client
		clientCh <- client
		go client.WritePump()
		client.ReadPump()
	}))
	t.Cleanup(srv.Close)

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	conn, resp, err := gws.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	t.Cleanup(func() { _ = conn.Close() })

	select {
	case client := <-clientCh:
		return conn, client
	case <-time.After(2 * time.Second):
		t.Fatal("server did not create a client in time")
		return nil, nil
	}
}

func readJSONWithin(t *testing.T, conn *gws.Conn, d time.Duration) map[string]interface{} {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(d))
	var payload map[string]interface{}
	if err := conn.ReadJSON(&payload); err != nil {
		t.Fatalf("failed to read JSON from socket: %v", err)
	}
	return payload
}

// TestWritePump_MutationApplied_UsesAttachedPayload verifies the broadcast
// payload attached by the hub is sent as-is: the mutation log is left empty,
// so a re-query (the old behavior) could never produce the payload.
func TestWritePump_MutationApplied_UsesAttachedPayload(t *testing.T) {
	hub := newRunningHub(t)
	conn, client := dialPumpServer(t, hub, "space-pump")

	entry := &websocket.MutationEntry{
		ID:      "mut-77",
		SpaceID: "space-pump",
		UserID:  "user-2",
		Version: 7,
	}
	if !hub.TrySend(client, &websocket.Message{
		Type:    "mutation_applied",
		UserID:  "user-2",
		SpaceID: "space-pump",
		Version: 7,
		Hash:    "mut-77",
		Payload: entry,
	}) {
		t.Fatal("TrySend() failed")
	}

	msg := readJSONWithin(t, conn, 2*time.Second)
	if msg["type"] != "mutation_applied" {
		t.Fatalf("type = %v, want mutation_applied", msg["type"])
	}
	if msg["userId"] != "user-2" {
		t.Fatalf("userId = %v, want user-2", msg["userId"])
	}
	if msg["version"] != float64(7) {
		t.Fatalf("version = %v, want 7", msg["version"])
	}
	if msg["mutationId"] != "mut-77" {
		t.Fatalf("mutationId = %v, want mut-77", msg["mutationId"])
	}
	payload, ok := msg["payload"].(map[string]interface{})
	if !ok {
		t.Fatalf("payload missing or wrong type: %T", msg["payload"])
	}
	if payload["id"] != "mut-77" {
		t.Fatalf("payload.id = %v, want mut-77", payload["id"])
	}
}

// TestReadPump_CatchUpRequest_RespondsViaWritePump verifies catch-up responses
// travel through the Send channel (single socket writer) and keep the exact
// response shape clients depend on.
func TestReadPump_CatchUpRequest_RespondsViaWritePump(t *testing.T) {
	db := newSerializedTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}
	for _, id := range []string{"mut-1", "mut-2"} {
		if _, err := ml.AppendMutation("space-catchup", "user-1", &websocket.MutationMessage{
			ID:        id,
			Op:        "noop",
			Timestamp: time.Now(),
		}); err != nil {
			t.Fatalf("AppendMutation(%s) error = %v", id, err)
		}
	}
	hub := websocket.NewHub(ml)
	go hub.Run()

	conn, _ := dialPumpServer(t, hub, "space-catchup")

	if err := conn.WriteJSON(map[string]interface{}{"type": "catch_up_request", "sinceVersion": 0}); err != nil {
		t.Fatalf("failed to send catch-up request: %v", err)
	}

	msg := readJSONWithin(t, conn, 2*time.Second)
	if msg["type"] != "catch_up_response" {
		t.Fatalf("type = %v, want catch_up_response", msg["type"])
	}
	if msg["space_id"] != "space-catchup" {
		t.Fatalf("space_id = %v, want space-catchup", msg["space_id"])
	}
	mutations, ok := msg["mutations"].([]interface{})
	if !ok {
		t.Fatalf("mutations missing or wrong type: %T", msg["mutations"])
	}
	if len(mutations) != 2 {
		t.Fatalf("got %d mutations, want 2", len(mutations))
	}
	if msg["hasMore"] != false {
		t.Fatalf("hasMore = %v, want false", msg["hasMore"])
	}
	if msg["latestVersion"] != float64(2) {
		t.Fatalf("latestVersion = %v, want 2", msg["latestVersion"])
	}
	if msg["nextSinceVersion"] != float64(2) {
		t.Fatalf("nextSinceVersion = %v, want 2", msg["nextSinceVersion"])
	}
}

// TestReadPump_CatchUpRequest_ClosesConnectionOnPersistentFailure verifies a
// client stuck in catch-up gets its connection closed (so it reconnects and
// retries) instead of being silently stalled when the mutation log errors.
func TestReadPump_CatchUpRequest_ClosesConnectionOnPersistentFailure(t *testing.T) {
	db := newSerializedTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}
	hub := websocket.NewHub(ml)
	go hub.Run()

	conn, _ := dialPumpServer(t, hub, "space-fail")

	// Break the mutation log persistently.
	if err := db.Close(); err != nil {
		t.Fatalf("failed to close db: %v", err)
	}

	if err := conn.WriteJSON(map[string]interface{}{"type": "catch_up_request", "sinceVersion": 0}); err != nil {
		t.Fatalf("failed to send catch-up request: %v", err)
	}

	// The server must close the connection rather than answer with nothing.
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("expected the server to close the connection, but a message arrived")
	}
}

// TestReadPump_EncryptionKeyAck_DeliveredViaWritePump verifies the key-version
// ack is routed through the Send channel and preserves its JSON shape.
func TestReadPump_EncryptionKeyAck_DeliveredViaWritePump(t *testing.T) {
	hub := newRunningHub(t)
	conn, _ := dialPumpServer(t, hub, "space-key")

	if err := conn.WriteJSON(map[string]interface{}{"type": "increment_encryption_key_version"}); err != nil {
		t.Fatalf("failed to send key increment request: %v", err)
	}

	msg := readJSONWithin(t, conn, 2*time.Second)
	if msg["type"] != "encryption_key_version_ack" {
		t.Fatalf("type = %v, want encryption_key_version_ack", msg["type"])
	}
	if msg["space_id"] != "space-key" {
		t.Fatalf("space_id = %v, want space-key", msg["space_id"])
	}
	if msg["success"] != true {
		t.Fatalf("success = %v, want true", msg["success"])
	}
	if _, ok := msg["new_version"]; !ok {
		t.Fatal("new_version missing from ack")
	}
}
