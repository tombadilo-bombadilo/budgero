package websocket_test

import (
	"testing"
	"time"

	"budgero-server/internal/adapter/driving/http/websocket"
)

func TestHub_NewHub(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}

	hub := websocket.NewHub(ml)
	if hub == nil {
		t.Fatal("NewHub() returned nil")
		return
	}

	// Verify channels are initialized
	if hub.Register == nil {
		t.Error("Hub.Register channel is nil")
	}
	if hub.Unregister == nil {
		t.Error("Hub.Unregister channel is nil")
	}
}

func TestHub_RunAndRegisterClient(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}

	hub := websocket.NewHub(ml)

	// Start hub in background
	go hub.Run()

	// Create a mock client (we can't use real websocket in unit tests)
	// The Client struct requires a real websocket.Conn, so we test via channel interactions
	// This test verifies the hub's Run goroutine starts without panicking

	// Give the goroutine time to start
	time.Sleep(10 * time.Millisecond)

	// The hub should be running - we can't easily verify internal state
	// but at least verify it didn't panic
}

func TestHub_NotifyDatabaseUpdate(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}

	hub := websocket.NewHub(ml)

	// Start hub
	go hub.Run()
	time.Sleep(10 * time.Millisecond)

	// This should not block or panic even with no clients
	hub.NotifyDatabaseUpdate("space1", "user1", 1, "hash123", false)
}

func TestHub_GetMutationsSince(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}

	// Add a mutation
	_, _ = ml.AppendMutation("space1", "user1", &websocket.MutationMessage{
		ID:        "mut-1",
		Op:        "test_op",
		Timestamp: time.Now(),
	})

	hub := websocket.NewHub(ml)

	mutations, err := hub.GetMutationsSince("space1", 0)
	if err != nil {
		t.Fatalf("GetMutationsSince() error = %v", err)
	}

	if len(mutations) != 1 {
		t.Errorf("got %d mutations, want 1", len(mutations))
	}
}

func TestHub_GetLatestMutationVersion(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}

	_, _ = ml.AppendMutation("space1", "user1", &websocket.MutationMessage{
		ID:        "mut-1",
		Op:        "test_op_1",
		Timestamp: time.Now(),
	})
	_, _ = ml.AppendMutation("space1", "user1", &websocket.MutationMessage{
		ID:        "mut-2",
		Op:        "test_op_2",
		Timestamp: time.Now(),
	})

	hub := websocket.NewHub(ml)
	latest, err := hub.GetLatestMutationVersion("space1")
	if err != nil {
		t.Fatalf("GetLatestMutationVersion() error = %v", err)
	}
	if latest != 2 {
		t.Fatalf("latest version = %d, want 2", latest)
	}
}

func TestHub_ResetSpace(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}

	// Add data
	_, _ = ml.AppendMutation("space1", "user1", &websocket.MutationMessage{
		ID:        "mut-1",
		Op:        "op",
		Timestamp: time.Now(),
	})

	hub := websocket.NewHub(ml)
	go hub.Run()
	time.Sleep(10 * time.Millisecond)

	err = hub.ResetSpace("space1")
	if err != nil {
		t.Fatalf("ResetSpace() error = %v", err)
	}

	// Verify data is gone
	mutations, _ := hub.GetMutationsSince("space1", 0)
	if len(mutations) != 0 {
		t.Errorf("got %d mutations after reset, want 0", len(mutations))
	}
}

func TestHub_HandleMutation(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}

	hub := websocket.NewHub(ml)
	go hub.Run()
	time.Sleep(10 * time.Millisecond)

	mutation := &websocket.MutationMessage{
		ID:        "mut-handle-test",
		Op:        "create_account",
		Timestamp: time.Now(),
	}

	// HandleMutation with nil sender (no ack sent)
	err = hub.HandleMutation("space1", "user1", mutation, nil)
	if err != nil {
		t.Fatalf("HandleMutation() error = %v", err)
	}

	// Verify mutation was stored
	mutations, _ := hub.GetMutationsSince("space1", 0)
	if len(mutations) != 1 {
		t.Errorf("got %d mutations, want 1", len(mutations))
	}
	if mutations[0].ID != "mut-handle-test" {
		t.Errorf("mutation ID = %q, want mut-handle-test", mutations[0].ID)
	}
}

func TestHub_HandleMutation_AssignsVersion(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}

	hub := websocket.NewHub(ml)
	go hub.Run()
	time.Sleep(10 * time.Millisecond)

	// Handle first mutation
	err = hub.HandleMutation("space1", "user1", &websocket.MutationMessage{
		ID:        "mut-1",
		Op:        "op1",
		Timestamp: time.Now(),
	}, nil)
	if err != nil {
		t.Fatalf("first HandleMutation() error = %v", err)
	}

	// Handle second mutation
	err = hub.HandleMutation("space1", "user1", &websocket.MutationMessage{
		ID:        "mut-2",
		Op:        "op2",
		Timestamp: time.Now(),
	}, nil)
	if err != nil {
		t.Fatalf("second HandleMutation() error = %v", err)
	}

	// Verify versions were assigned
	mutations, _ := hub.GetMutationsSince("space1", 0)
	if len(mutations) != 2 {
		t.Fatalf("got %d mutations, want 2", len(mutations))
	}
	if mutations[0].Version != 1 {
		t.Errorf("first mutation version = %d, want 1", mutations[0].Version)
	}
	if mutations[1].Version != 2 {
		t.Errorf("second mutation version = %d, want 2", mutations[1].Version)
	}
}
