package websocket_test

import (
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"budgero-server/internal/adapter/driving/http/websocket"

	_ "modernc.org/sqlite"
)

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestMutationLog_NewMutationLog(t *testing.T) {
	db := newTestDB(t)

	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}
	if ml == nil {
		t.Error("NewMutationLog() returned nil")
	}

	// Verify tables were created
	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='mutation_log'").Scan(&count)
	if err != nil {
		t.Fatalf("failed to check mutation_log table: %v", err)
	}
	if count != 1 {
		t.Error("mutation_log table was not created")
	}
}

func TestMutationLog_AppendMutation(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}

	mutation := &websocket.MutationMessage{
		ID:          "mut-1",
		BaseVersion: 0,
		Op:          "create_account",
		Args:        json.RawMessage(`{"name":"Test Account"}`),
		Timestamp:   time.Now(),
	}

	version, err := ml.AppendMutation("space1", "user1", mutation)
	if err != nil {
		t.Fatalf("AppendMutation() error = %v", err)
	}
	if version != 1 {
		t.Errorf("AppendMutation() version = %d, want 1", version)
	}
}

func TestMutationLog_AppendMutation_VersionIncrement(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}

	// Add first mutation
	v1, err := ml.AppendMutation("space1", "user1", &websocket.MutationMessage{
		ID:        "mut-1",
		Op:        "op1",
		Timestamp: time.Now(),
	})
	if err != nil {
		t.Fatalf("first AppendMutation() error = %v", err)
	}

	// Add second mutation
	v2, err := ml.AppendMutation("space1", "user1", &websocket.MutationMessage{
		ID:        "mut-2",
		Op:        "op2",
		Timestamp: time.Now(),
	})
	if err != nil {
		t.Fatalf("second AppendMutation() error = %v", err)
	}

	if v1 != 1 {
		t.Errorf("first version = %d, want 1", v1)
	}
	if v2 != 2 {
		t.Errorf("second version = %d, want 2", v2)
	}
}

func TestMutationLog_AppendMutation_DuplicateID(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}

	mutation := &websocket.MutationMessage{
		ID:        "mut-duplicate",
		Op:        "create",
		Timestamp: time.Now(),
	}

	v1, err := ml.AppendMutation("space1", "user1", mutation)
	if err != nil {
		t.Fatalf("first AppendMutation() error = %v", err)
	}

	// Adding same mutation ID should return existing version
	v2, err := ml.AppendMutation("space1", "user1", mutation)
	if err != nil {
		t.Fatalf("duplicate AppendMutation() error = %v", err)
	}

	if v1 != v2 {
		t.Errorf("duplicate mutation returned different version: v1=%d, v2=%d", v1, v2)
	}
}

func TestMutationLog_AppendMutation_DifferentSpaces(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}

	// Add mutations to different spaces
	v1, err := ml.AppendMutation("space1", "user1", &websocket.MutationMessage{
		ID:        "mut-1",
		Op:        "op1",
		Timestamp: time.Now(),
	})
	if err != nil {
		t.Fatalf("space1 AppendMutation() error = %v", err)
	}

	v2, err := ml.AppendMutation("space2", "user2", &websocket.MutationMessage{
		ID:        "mut-2",
		Op:        "op2",
		Timestamp: time.Now(),
	})
	if err != nil {
		t.Fatalf("space2 AppendMutation() error = %v", err)
	}

	// Both should be version 1 in their respective spaces
	if v1 != 1 {
		t.Errorf("space1 version = %d, want 1", v1)
	}
	if v2 != 1 {
		t.Errorf("space2 version = %d, want 1", v2)
	}
}

func TestMutationLog_AppendMutation_EncryptedPayload(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}

	mutation := &websocket.MutationMessage{
		ID:               "mut-encrypted",
		EncryptedPayload: "base64encodedencrypteddata==",
		Timestamp:        time.Now(),
	}

	version, err := ml.AppendMutation("space1", "user1", mutation)
	if err != nil {
		t.Fatalf("AppendMutation() error = %v", err)
	}
	if version != 1 {
		t.Errorf("version = %d, want 1", version)
	}

	// Verify encrypted payload was stored
	mutations, err := ml.GetMutationsSince("space1", 0, 10)
	if err != nil {
		t.Fatalf("GetMutationsSince() error = %v", err)
	}
	if len(mutations) != 1 {
		t.Fatalf("got %d mutations, want 1", len(mutations))
	}
	if mutations[0].EncryptedPayload != "base64encodedencrypteddata==" {
		t.Errorf("EncryptedPayload = %q, want base64encodedencrypteddata==", mutations[0].EncryptedPayload)
	}
}

func TestMutationLog_GetMutationsSince(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}

	// Add 5 mutations
	for i := 1; i <= 5; i++ {
		_, appendErr := ml.AppendMutation("space1", "user1", &websocket.MutationMessage{
			ID:        "mut-" + string(rune('0'+i)),
			Op:        "op",
			Timestamp: time.Now(),
		})
		if appendErr != nil {
			t.Fatalf("AppendMutation() error = %v", appendErr)
		}
	}

	// Get mutations since version 2
	mutations, err := ml.GetMutationsSince("space1", 2, 10)
	if err != nil {
		t.Fatalf("GetMutationsSince() error = %v", err)
	}

	if len(mutations) != 3 {
		t.Errorf("got %d mutations, want 3 (versions 3,4,5)", len(mutations))
	}
	if len(mutations) > 0 && mutations[0].Version != 3 {
		t.Errorf("first mutation version = %d, want 3", mutations[0].Version)
	}
}

func TestMutationLog_GetMutationsSince_WithLimit(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}

	// Add 10 mutations
	for i := 1; i <= 10; i++ {
		_, appendErr := ml.AppendMutation("space1", "user1", &websocket.MutationMessage{
			ID:        "mut-" + string(rune('a'+i)),
			Op:        "op",
			Timestamp: time.Now(),
		})
		if appendErr != nil {
			t.Fatalf("AppendMutation() error = %v", appendErr)
		}
	}

	// Get with limit of 3
	mutations, err := ml.GetMutationsSince("space1", 0, 3)
	if err != nil {
		t.Fatalf("GetMutationsSince() error = %v", err)
	}

	if len(mutations) != 3 {
		t.Errorf("got %d mutations, want 3 (limited)", len(mutations))
	}
}

func TestMutationLog_GetMutationsSince_EmptySpace(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}

	mutations, err := ml.GetMutationsSince("nonexistent", 0, 10)
	if err != nil {
		t.Fatalf("GetMutationsSince() error = %v", err)
	}

	if len(mutations) != 0 {
		t.Errorf("got %d mutations for empty space, want 0", len(mutations))
	}
}

func TestMutationLog_GetLatestVersion(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}

	// Empty space should return 0
	v, err := ml.GetLatestVersion("space1")
	if err != nil {
		t.Fatalf("GetLatestVersion() error = %v", err)
	}
	if v != 0 {
		t.Errorf("GetLatestVersion() for empty space = %d, want 0", v)
	}

	// Add mutations
	for i := 1; i <= 3; i++ {
		_, _ = ml.AppendMutation("space1", "user1", &websocket.MutationMessage{
			ID:        "mut-" + string(rune('0'+i)),
			Op:        "op",
			Timestamp: time.Now(),
		})
	}

	v, err = ml.GetLatestVersion("space1")
	if err != nil {
		t.Fatalf("GetLatestVersion() error = %v", err)
	}
	if v != 3 {
		t.Errorf("GetLatestVersion() = %d, want 3", v)
	}
}


func TestMutationLog_ResetSpace(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}

	// Add mutations
	_, _ = ml.AppendMutation("space1", "user1", &websocket.MutationMessage{
		ID:        "mut-1",
		Op:        "op",
		Timestamp: time.Now(),
	})
	// Reset space
	err = ml.ResetSpace("space1")
	if err != nil {
		t.Fatalf("ResetSpace() error = %v", err)
	}

	// Verify everything is gone
	mutations, _ := ml.GetMutationsSince("space1", 0, 100)
	if len(mutations) != 0 {
		t.Errorf("got %d mutations after reset, want 0", len(mutations))
	}
}

func TestMutationLog_ResetSpace_PreservesOtherSpaces(t *testing.T) {
	db := newTestDB(t)
	ml, err := websocket.NewMutationLog(db)
	if err != nil {
		t.Fatalf("NewMutationLog() error = %v", err)
	}

	// Add data to space1 and space2
	_, _ = ml.AppendMutation("space1", "user1", &websocket.MutationMessage{
		ID: "mut-s1", Op: "op", Timestamp: time.Now(),
	})
	_, _ = ml.AppendMutation("space2", "user2", &websocket.MutationMessage{
		ID: "mut-s2", Op: "op", Timestamp: time.Now(),
	})

	// Reset only space1
	_ = ml.ResetSpace("space1")

	// space2 should still have data
	mutations, _ := ml.GetMutationsSince("space2", 0, 100)
	if len(mutations) != 1 {
		t.Errorf("space2 mutations after space1 reset = %d, want 1", len(mutations))
	}
}
