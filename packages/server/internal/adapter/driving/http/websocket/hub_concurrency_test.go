package websocket_test

import (
	"database/sql"
	"fmt"
	"sync"
	"testing"
	"time"

	"budgero-server/internal/adapter/driving/http/websocket"
)

// newSerializedTestDB returns an in-memory database restricted to a single
// connection so concurrent hub operations exercise the hub's own locking
// rather than opening extra (empty) in-memory databases from the pool.
func newSerializedTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db := newTestDB(t)
	db.SetMaxOpenConns(1)
	return db
}

func newRunningHub(t *testing.T) *websocket.Hub {
	t.Helper()
	ml, err := websocket.NewMutationLog(newSerializedTestDB(t))
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}
	hub := websocket.NewHub(ml)
	go hub.Run()
	return hub
}

// awaitRegistered blocks until every listed client has received a broadcast,
// proving the hub's Run loop processed their registration.
func awaitRegistered(t *testing.T, hub *websocket.Hub, spaceID string, clients ...*websocket.Client) {
	t.Helper()
	pending := make(map[*websocket.Client]bool, len(clients))
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
	// Repeated probes land in ALREADY-registered clients' buffers while
	// slower clients are still pending — drain them so callers only ever
	// read messages their own test actions produced.
	for _, client := range clients {
		drainSend(client)
	}
}

// assertSendClosed drains a client's Send channel until it is closed.
func assertSendClosed(t *testing.T, client *websocket.Client) {
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

// drainSend empties any buffered messages without blocking.
func drainSend(client *websocket.Client) {
	for {
		select {
		case <-client.Send:
		default:
			return
		}
	}
}

// TestHub_ConcurrentBroadcastsResetAndChurn hammers the Run loop's broadcast
// branches concurrently with ResetSpace and Register/Unregister churn. Run
// with -race: it used to trip concurrent map iteration+write, double-close,
// and send-on-closed-channel panics.
func TestHub_ConcurrentBroadcastsResetAndChurn(t *testing.T) {
	hub := newRunningHub(t)
	const spaceID = "space-race"

	var wg sync.WaitGroup

	// Client churn: register clients (some drained, some left to fill up so the
	// full-channel drop path fires), unregister a third of them.
	for worker := 0; worker < 4; worker++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				client := websocket.NewClient(hub, nil, fmt.Sprintf("user-%d", worker), spaceID)
				hub.Register <- client
				if j%2 == 0 {
					go func() {
						for msg := range client.Send { // drain until closed
							_ = msg
						}
					}()
				}
				if j%3 == 0 {
					hub.Unregister <- client
				}
			}
		}(worker)
	}

	// Broadcasters: sync notifications through the broadcast channel plus full
	// HandleMutation flows (ack sends + mutation broadcasts).
	for worker := 0; worker < 2; worker++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				hub.NotifyDatabaseUpdate(spaceID, "broadcaster", int64(j), "hash", false)
				_ = hub.HandleMutation(spaceID, "broadcaster", &websocket.MutationMessage{
					ID:        fmt.Sprintf("mut-%d-%d", worker, j),
					Op:        "noop",
					Timestamp: time.Now(),
				}, nil)
			}
		}(worker)
	}

	// Resetter: the user-triggerable path (master-password reset) that used to
	// race the broadcast loops.
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 30; i++ {
			if err := hub.ResetSpace(spaceID); err != nil {
				t.Errorf("ResetSpace() error = %v", err)
			}
			time.Sleep(time.Millisecond)
		}
	}()

	wg.Wait()

	// Final reset closes any remaining clients (and their drain goroutines).
	if err := hub.ResetSpace(spaceID); err != nil {
		t.Fatalf("final ResetSpace() error = %v", err)
	}
}

func TestHub_CloseUserClients_DisconnectsOnlyTargetUser(t *testing.T) {
	hub := newRunningHub(t)
	const spaceID = "space-close"

	removed := websocket.NewClient(hub, nil, "user-removed", spaceID)
	kept := websocket.NewClient(hub, nil, "user-kept", spaceID)
	hub.Register <- removed
	hub.Register <- kept
	awaitRegistered(t, hub, spaceID, removed, kept)

	hub.CloseUserClients(spaceID, "user-removed")

	assertSendClosed(t, removed)

	// The other user's client must still receive broadcasts.
	drainSend(kept)
	hub.NotifyDatabaseUpdate(spaceID, "user-kept", 42, "still-open", false)
	select {
	case msg, ok := <-kept.Send:
		if !ok {
			t.Fatal("kept client's send channel was closed")
		}
		if msg.Version != 42 {
			t.Fatalf("kept client got version %d, want 42", msg.Version)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("kept client did not receive broadcast after CloseUserClients")
	}
}

func TestHub_ResetSpace_ClosesConnectedClients(t *testing.T) {
	hub := newRunningHub(t)
	const spaceID = "space-reset"

	client := websocket.NewClient(hub, nil, "user-1", spaceID)
	hub.Register <- client
	awaitRegistered(t, hub, spaceID, client)

	if err := hub.HandleMutation(spaceID, "user-1", &websocket.MutationMessage{
		ID:        "mut-reset-1",
		Op:        "noop",
		Timestamp: time.Now(),
	}, nil); err != nil {
		t.Fatalf("HandleMutation() error = %v", err)
	}

	if err := hub.ResetSpace(spaceID); err != nil {
		t.Fatalf("ResetSpace() error = %v", err)
	}

	assertSendClosed(t, client)

	mutations, err := hub.GetMutationsSince(spaceID, 0)
	if err != nil {
		t.Fatalf("GetMutationsSince() error = %v", err)
	}
	if len(mutations) != 0 {
		t.Fatalf("got %d mutations after reset, want 0", len(mutations))
	}

	// A second reset (double close path) must be a no-op, not a panic.
	if err := hub.ResetSpace(spaceID); err != nil {
		t.Fatalf("second ResetSpace() error = %v", err)
	}
	// Unregistering an already-closed client must also be safe.
	hub.Unregister <- client
}

// TestHub_NotifyUserPasswordChanged_TargetsOnlyOwnDevices proves the master
// password notification is USER-scoped: the same user's other connections —
// across spaces — get it, while other members of a shared space (who have
// their own passwords) and the initiating connection itself do not.
func TestHub_NotifyUserPasswordChanged_TargetsOnlyOwnDevices(t *testing.T) {
	hub := newRunningHub(t)

	sender := websocket.NewClient(hub, nil, "user-a", "space-1")
	ownOtherDevice := websocket.NewClient(hub, nil, "user-a", "space-1")
	ownDeviceOtherSpace := websocket.NewClient(hub, nil, "user-a", "space-2")
	sharedMember := websocket.NewClient(hub, nil, "user-b", "space-1")
	hub.Register <- sender
	hub.Register <- ownOtherDevice
	hub.Register <- sharedMember
	awaitRegistered(t, hub, "space-1", sender, ownOtherDevice, sharedMember)
	hub.Register <- ownDeviceOtherSpace
	awaitRegistered(t, hub, "space-2", ownDeviceOtherSpace)

	hub.NotifyUserPasswordChanged("user-a", sender)

	expectMessage := func(name string, client *websocket.Client) {
		t.Helper()
		select {
		case msg := <-client.Send:
			if msg.Type != "master_password_changed" {
				t.Fatalf("%s: got message type %q, want master_password_changed", name, msg.Type)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("%s: expected master_password_changed, got nothing", name)
		}
	}
	expectNoMessage := func(name string, client *websocket.Client) {
		t.Helper()
		select {
		case msg := <-client.Send:
			t.Fatalf("%s: unexpectedly received message type %q", name, msg.Type)
		case <-time.After(50 * time.Millisecond):
		}
	}

	expectMessage("own other device", ownOtherDevice)
	expectMessage("own device in another space", ownDeviceOtherSpace)
	expectNoMessage("shared-space member", sharedMember)
	expectNoMessage("initiating connection", sender)
}
