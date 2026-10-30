package websocket_test

import (
	"errors"
	"testing"
	"time"

	"budgero-server/internal/adapter/driving/http/websocket"

	gws "github.com/gorilla/websocket"
)

func sendText(t *testing.T, conn *gws.Conn, payload string) {
	t.Helper()
	if err := conn.WriteMessage(gws.TextMessage, []byte(payload)); err != nil {
		t.Fatalf("write: %v", err)
	}
}

// awaitConnected polls until the hub's Run loop has registered n clients.
// (awaitRegistered reads from client.Send, which a running WritePump owns.)
func awaitConnected(t *testing.T, hub *websocket.Hub, n int64) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for hub.ConnectionCount() != n {
		if time.Now().After(deadline) {
			t.Fatalf("hub has %d connections, want %d", hub.ConnectionCount(), n)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// readCloseWithin reads until the peer's close frame and returns it.
func readCloseWithin(t *testing.T, conn *gws.Conn, d time.Duration) *gws.CloseError {
	t.Helper()
	deadline := time.Now().Add(d)
	for {
		_ = conn.SetReadDeadline(deadline)
		_, _, err := conn.ReadMessage()
		if err == nil {
			continue // a data frame queued before the close; keep reading
		}
		var ce *gws.CloseError
		if !errors.As(err, &ce) {
			t.Fatalf("expected a close frame, got %v", err)
		}
		return ce
	}
}

func TestReadPump_InvalidMutationGetsNack(t *testing.T) {
	hub := newRunningHub(t)
	conn, _ := dialPumpServer(t, hub, "space-nack")

	// baseVersion must be a number: the mutation does not unmarshal.
	sendText(t, conn, `{"type":"mutation","id":"mut-bad","baseVersion":"not-a-number","encryptedPayload":"xx"}`)

	frame := readJSONWithin(t, conn, 2*time.Second)
	if frame["type"] != "mutation_nack" || frame["id"] != "mut-bad" || frame["code"] != websocket.NackInvalid || frame["space_id"] != "space-nack" {
		t.Fatalf("frame = %v, want mutation_nack mut-bad invalid", frame)
	}
}

func TestReadPump_UnparseableFrameGetsNackWithoutID(t *testing.T) {
	hub := newRunningHub(t)
	conn, _ := dialPumpServer(t, hub, "space-garbage")

	sendText(t, conn, `this is not json`)

	frame := readJSONWithin(t, conn, 2*time.Second)
	if frame["type"] != "mutation_nack" || frame["id"] != "" || frame["code"] != websocket.NackInvalid {
		t.Fatalf("frame = %v, want mutation_nack with empty id and code invalid", frame)
	}
}

// A client re-sends unacked mutations after a reconnect; a duplicate id is
// already in the log and must be acked with the original version, never nacked.
func TestReadPump_DuplicateMutationIsAckedNotNacked(t *testing.T) {
	hub := newRunningHub(t)
	conn, _ := dialPumpServer(t, hub, "space-dup")

	mutation := `{"type":"mutation","id":"mut-dup","baseVersion":0,"encryptedPayload":"c2VjcmV0","timestamp":"2026-10-30T10:00:00Z"}`
	sendText(t, conn, mutation)
	first := readJSONWithin(t, conn, 2*time.Second)
	sendText(t, conn, mutation)
	second := readJSONWithin(t, conn, 2*time.Second)

	for i, frame := range []map[string]interface{}{first, second} {
		if frame["type"] != "mutation_ack" || frame["mutationId"] != "mut-dup" || frame["success"] != true {
			t.Fatalf("reply %d = %v, want mutation_ack for mut-dup", i, frame)
		}
	}
	if first["version"] != second["version"] || first["version"] != float64(1) {
		t.Fatalf("versions = %v / %v, want both 1", first["version"], second["version"])
	}
}

func TestHub_ResetSpaceClosesWithSpaceResetReason(t *testing.T) {
	hub := newRunningHub(t)
	conn, _ := dialPumpServer(t, hub, "space-reset")
	awaitConnected(t, hub, 1)

	if err := hub.ResetSpace("space-reset"); err != nil {
		t.Fatalf("ResetSpace: %v", err)
	}

	ce := readCloseWithin(t, conn, 2*time.Second)
	if ce.Code != gws.CloseNormalClosure || ce.Text != websocket.CloseReasonSpaceReset {
		t.Fatalf("close = %d %q, want 1000 space_reset", ce.Code, ce.Text)
	}
}

func TestHub_CloseUserClientsSendsPolicyViolation(t *testing.T) {
	hub := newRunningHub(t)
	conn, client := dialPumpServer(t, hub, "space-removed")
	awaitConnected(t, hub, 1)

	hub.CloseUserClients("space-removed", "user-1")

	ce := readCloseWithin(t, conn, 2*time.Second)
	if ce.Code != gws.ClosePolicyViolation || ce.Text != websocket.CloseReasonMemberRemoved {
		t.Fatalf("close = %d %q, want 1008 member_removed", ce.Code, ce.Text)
	}

	// The first reason wins: a later close for the same client changes nothing.
	hub.CloseClient(client, gws.CloseInternalServerErr, websocket.CloseReasonSendBufferFull)
}

func TestHub_CloseAllUserClientsSendsBlocked(t *testing.T) {
	hub := newRunningHub(t)
	conn, _ := dialPumpServer(t, hub, "space-blocked")
	awaitConnected(t, hub, 1)

	if n := hub.CloseAllUserClients("user-1"); n != 1 {
		t.Fatalf("closed %d clients, want 1", n)
	}

	ce := readCloseWithin(t, conn, 2*time.Second)
	if ce.Code != gws.ClosePolicyViolation || ce.Text != websocket.CloseReasonBlocked {
		t.Fatalf("close = %d %q, want 1008 blocked", ce.Code, ce.Text)
	}
}

func TestReadPump_CatchUpFailureClosesWithReason(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog: %v", err)
	}
	hub := websocket.NewHub(ml)
	go hub.Run()
	conn, _ := dialPumpServer(t, hub, "space-catchup")
	awaitConnected(t, hub, 1)

	// Every mutation log query fails from here on.
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	sendText(t, conn, `{"type":"catch_up_request","sinceVersion":0}`)

	ce := readCloseWithin(t, conn, 3*time.Second)
	if ce.Code != gws.CloseInternalServerErr || ce.Text != websocket.CloseReasonCatchUpFailed {
		t.Fatalf("close = %d %q, want 1011 catch_up_failed", ce.Code, ce.Text)
	}
}
