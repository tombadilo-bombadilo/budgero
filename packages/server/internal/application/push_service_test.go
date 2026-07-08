package application_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"

	"budgero-server/internal/adapter/driven/fake"
	"budgero-server/internal/application"
	"budgero-server/internal/domain"
)

const (
	testSpaceID = "space1"
)

func TestPushService_GenerateAndSaveToken(t *testing.T) {
	ctx := context.Background()
	pushRepo := fake.NewPushRepository()
	svc := application.NewPushService(pushRepo)

	// Generate token
	token, err := svc.GenerateAndSaveToken(ctx, "user1", "space1")
	if err != nil {
		t.Fatalf("GenerateAndSaveToken() error = %v", err)
	}

	if token == "" {
		t.Error("GenerateAndSaveToken() returned empty token")
	}

	// Token should be 64 hex characters (32 bytes)
	if len(token) != 64 {
		t.Errorf("Token length = %d, want 64", len(token))
	}

	// Verify token status
	status, err := svc.GetTokenStatus(ctx, "user1")
	if err != nil {
		t.Fatalf("GetTokenStatus() error = %v", err)
	}

	if !status.HasToken {
		t.Error("HasToken should be true")
	}
	if status.SpaceID != testSpaceID {
		t.Errorf("SpaceID = %v, want %s", status.SpaceID, testSpaceID)
	}
	if !status.IsEnabled {
		t.Error("IsEnabled should be true by default")
	}
}

func TestPushService_GetTokenStatus_NoToken(t *testing.T) {
	ctx := context.Background()
	pushRepo := fake.NewPushRepository()
	svc := application.NewPushService(pushRepo)

	status, err := svc.GetTokenStatus(ctx, "user1")
	if err != nil {
		t.Fatalf("GetTokenStatus() error = %v", err)
	}

	if status.HasToken {
		t.Error("HasToken should be false for user without token")
	}
}

func TestPushService_SetTokenEnabled(t *testing.T) {
	ctx := context.Background()
	pushRepo := fake.NewPushRepository()
	svc := application.NewPushService(pushRepo)

	// Generate token first
	_, _ = svc.GenerateAndSaveToken(ctx, "user1", "space1")

	// Disable token
	err := svc.SetTokenEnabled(ctx, "user1", false)
	if err != nil {
		t.Fatalf("SetTokenEnabled(false) error = %v", err)
	}

	status, _ := svc.GetTokenStatus(ctx, "user1")
	if status.IsEnabled {
		t.Error("Token should be disabled")
	}

	// Enable token
	err = svc.SetTokenEnabled(ctx, "user1", true)
	if err != nil {
		t.Fatalf("SetTokenEnabled(true) error = %v", err)
	}

	status, _ = svc.GetTokenStatus(ctx, "user1")
	if !status.IsEnabled {
		t.Error("Token should be enabled")
	}
}

func TestPushService_RevokeToken(t *testing.T) {
	ctx := context.Background()
	pushRepo := fake.NewPushRepository()
	svc := application.NewPushService(pushRepo)

	// Generate token first
	_, _ = svc.GenerateAndSaveToken(ctx, "user1", "space1")

	// Revoke token
	err := svc.RevokeToken(ctx, "user1")
	if err != nil {
		t.Fatalf("RevokeToken() error = %v", err)
	}

	// Token should be gone
	status, _ := svc.GetTokenStatus(ctx, "user1")
	if status.HasToken {
		t.Error("Token should be revoked")
	}
}

func TestPushService_ValidateTokenByHash(t *testing.T) {
	ctx := context.Background()
	pushRepo := fake.NewPushRepository()
	svc := application.NewPushService(pushRepo)

	// Generate token
	token, _ := svc.GenerateAndSaveToken(ctx, "user1", "space1")

	// Hash the token (same way the service does internally)
	hash := sha256.Sum256([]byte(token))
	tokenHash := hex.EncodeToString(hash[:])

	// Validate by hash
	userID, spaceID, err := svc.ValidateTokenByHash(ctx, tokenHash)
	if err != nil {
		t.Fatalf("ValidateTokenByHash() error = %v", err)
	}

	if userID != "user1" {
		t.Errorf("userID = %v, want user1", userID)
	}
	if spaceID != testSpaceID {
		t.Errorf("spaceID = %v, want %s", spaceID, testSpaceID)
	}
}

func TestPushService_ValidateTokenByHash_DisabledToken(t *testing.T) {
	ctx := context.Background()
	pushRepo := fake.NewPushRepository()
	svc := application.NewPushService(pushRepo)

	// Generate and disable token
	token, _ := svc.GenerateAndSaveToken(ctx, "user1", "space1")
	_ = svc.SetTokenEnabled(ctx, "user1", false)

	// Hash the token
	hash := sha256.Sum256([]byte(token))
	tokenHash := hex.EncodeToString(hash[:])

	// Validate should fail
	_, _, err := svc.ValidateTokenByHash(ctx, tokenHash)
	if !errors.Is(err, domain.ErrPushTokenInvalid) {
		t.Errorf("ValidateTokenByHash() error = %v, want %v", err, domain.ErrPushTokenInvalid)
	}
}

func TestPushService_ValidateTokenByHash_InvalidHash(t *testing.T) {
	ctx := context.Background()
	pushRepo := fake.NewPushRepository()
	svc := application.NewPushService(pushRepo)

	_, _, err := svc.ValidateTokenByHash(ctx, "invalid-hash")
	if !errors.Is(err, domain.ErrPushTokenNotFound) {
		t.Errorf("ValidateTokenByHash() error = %v, want %v", err, domain.ErrPushTokenNotFound)
	}
}

func TestPushService_QueueMutation(t *testing.T) {
	ctx := context.Background()
	pushRepo := fake.NewPushRepository()
	svc := application.NewPushService(pushRepo)

	itemID, err := svc.QueueMutation(ctx, "user1", "space1", "msg1", "encrypted-payload")
	if err != nil {
		t.Fatalf("QueueMutation() error = %v", err)
	}

	if itemID == "" {
		t.Error("QueueMutation() returned empty itemID")
	}

	// Verify item in queue
	items, _ := svc.ListPendingItems(ctx, "user1", "")
	if len(items) != 1 {
		t.Errorf("Expected 1 pending item, got %d", len(items))
	}
	if items[0].ID != itemID {
		t.Errorf("Item.ID = %v, want %v", items[0].ID, itemID)
	}
	if items[0].EncryptedPayload != "encrypted-payload" {
		t.Errorf("Item.EncryptedPayload = %v, want encrypted-payload", items[0].EncryptedPayload)
	}
}

func TestPushService_CheckDuplicateMessage(t *testing.T) {
	ctx := context.Background()
	pushRepo := fake.NewPushRepository()
	svc := application.NewPushService(pushRepo)

	// Queue first message
	itemID, _ := svc.QueueMutation(ctx, "user1", "space1", "msg1", "payload1")

	// Check for duplicate
	existingID, status, exists, err := svc.CheckDuplicateMessage(ctx, "space1", "msg1")
	if err != nil {
		t.Fatalf("CheckDuplicateMessage() error = %v", err)
	}
	if !exists {
		t.Error("Duplicate should exist")
	}
	if existingID != itemID {
		t.Errorf("existingID = %v, want %v", existingID, itemID)
	}
	if status != domain.PushStatusPending {
		t.Errorf("status = %v, want pending", status)
	}

	// Check for non-existent message
	_, _, exists, _ = svc.CheckDuplicateMessage(ctx, "space1", "msg2")
	if exists {
		t.Error("Non-existent message should not exist")
	}
}

func TestPushService_ListPendingItems_FilterBySpace(t *testing.T) {
	ctx := context.Background()
	pushRepo := fake.NewPushRepository()
	svc := application.NewPushService(pushRepo)

	// Queue items for different spaces
	_, _ = svc.QueueMutation(ctx, "user1", "space1", "msg1", "payload1")
	_, _ = svc.QueueMutation(ctx, "user1", "space1", "msg2", "payload2")
	_, _ = svc.QueueMutation(ctx, "user1", "space2", "msg3", "payload3")

	// List all pending
	allItems, _ := svc.ListPendingItems(ctx, "user1", "")
	if len(allItems) != 3 {
		t.Errorf("Expected 3 items, got %d", len(allItems))
	}

	// List for space1 only
	space1Items, _ := svc.ListPendingItems(ctx, "user1", "space1")
	if len(space1Items) != 2 {
		t.Errorf("Expected 2 items for space1, got %d", len(space1Items))
	}

	// List for space2 only
	space2Items, _ := svc.ListPendingItems(ctx, "user1", "space2")
	if len(space2Items) != 1 {
		t.Errorf("Expected 1 item for space2, got %d", len(space2Items))
	}
}

func TestPushService_AckItem(t *testing.T) {
	ctx := context.Background()
	pushRepo := fake.NewPushRepository()
	svc := application.NewPushService(pushRepo)

	// Queue item
	itemID, _ := svc.QueueMutation(ctx, "user1", "space1", "msg1", "payload1")

	// Acknowledge item
	err := svc.AckItem(ctx, "user1", itemID, domain.PushStatusProcessed)
	if err != nil {
		t.Fatalf("AckItem() error = %v", err)
	}

	// Item should no longer be pending
	items, _ := svc.ListPendingItems(ctx, "user1", "")
	if len(items) != 0 {
		t.Errorf("Expected 0 pending items, got %d", len(items))
	}

	// Stats should reflect processed item
	stats, _ := svc.GetStats(ctx, "user1")
	if stats.Processed != 1 {
		t.Errorf("stats.Processed = %d, want 1", stats.Processed)
	}
}

func TestPushService_GetStats(t *testing.T) {
	ctx := context.Background()
	pushRepo := fake.NewPushRepository()
	svc := application.NewPushService(pushRepo)

	// Queue items
	id1, _ := svc.QueueMutation(ctx, "user1", "space1", "msg1", "payload1")
	_, _ = svc.QueueMutation(ctx, "user1", "space1", "msg2", "payload2")
	id3, _ := svc.QueueMutation(ctx, "user1", "space1", "msg3", "payload3")

	// Ack one as processed, one as failed
	_ = svc.AckItem(ctx, "user1", id1, domain.PushStatusProcessed)
	_ = svc.AckItem(ctx, "user1", id3, domain.PushStatusFailed)

	stats, err := svc.GetStats(ctx, "user1")
	if err != nil {
		t.Fatalf("GetStats() error = %v", err)
	}

	if stats.Total != 3 {
		t.Errorf("stats.Total = %d, want 3", stats.Total)
	}
	if stats.Pending != 1 {
		t.Errorf("stats.Pending = %d, want 1", stats.Pending)
	}
	if stats.Processed != 1 {
		t.Errorf("stats.Processed = %d, want 1", stats.Processed)
	}
	if stats.Failed != 1 {
		t.Errorf("stats.Failed = %d, want 1", stats.Failed)
	}
}

func TestPushService_ClearQueue(t *testing.T) {
	ctx := context.Background()
	pushRepo := fake.NewPushRepository()
	svc := application.NewPushService(pushRepo)

	// Queue items and ack some
	id1, _ := svc.QueueMutation(ctx, "user1", "space1", "msg1", "payload1")
	_, _ = svc.QueueMutation(ctx, "user1", "space1", "msg2", "payload2")
	_, _ = svc.QueueMutation(ctx, "user1", "space1", "msg3", "payload3")
	_ = svc.AckItem(ctx, "user1", id1, domain.PushStatusProcessed)

	// Clear pending only
	count, err := svc.ClearQueue(ctx, "user1", false)
	if err != nil {
		t.Fatalf("ClearQueue(pending) error = %v", err)
	}
	if count != 2 {
		t.Errorf("ClearQueue(pending) cleared %d, want 2", count)
	}

	// Processed item should still exist
	stats, _ := svc.GetStats(ctx, "user1")
	if stats.Total != 1 {
		t.Errorf("stats.Total = %d, want 1", stats.Total)
	}

	// Clear all
	count, err = svc.ClearQueue(ctx, "user1", true)
	if err != nil {
		t.Fatalf("ClearQueue(all) error = %v", err)
	}
	if count != 1 {
		t.Errorf("ClearQueue(all) cleared %d, want 1", count)
	}

	stats, _ = svc.GetStats(ctx, "user1")
	if stats.Total != 0 {
		t.Errorf("stats.Total = %d, want 0", stats.Total)
	}
}

func TestPushService_DeleteUserPushData(t *testing.T) {
	ctx := context.Background()
	pushRepo := fake.NewPushRepository()
	svc := application.NewPushService(pushRepo)

	// Create token and queue items
	_, _ = svc.GenerateAndSaveToken(ctx, "user1", "space1")
	_, _ = svc.QueueMutation(ctx, "user1", "space1", "msg1", "payload1")
	_, _ = svc.QueueMutation(ctx, "user1", "space1", "msg2", "payload2")

	// Delete all push data
	err := svc.DeleteUserPushData(ctx, "user1")
	if err != nil {
		t.Fatalf("DeleteUserPushData() error = %v", err)
	}

	// Token should be gone
	status, _ := svc.GetTokenStatus(ctx, "user1")
	if status.HasToken {
		t.Error("Token should be deleted")
	}

	// Queue should be empty
	stats, _ := svc.GetStats(ctx, "user1")
	if stats.Total != 0 {
		t.Errorf("Queue should be empty, got %d items", stats.Total)
	}
}

func TestPushService_TokenReplacesOldToken(t *testing.T) {
	ctx := context.Background()
	pushRepo := fake.NewPushRepository()
	svc := application.NewPushService(pushRepo)

	// Generate first token
	token1, _ := svc.GenerateAndSaveToken(ctx, "user1", "space1")

	// Generate second token (should replace first)
	token2, _ := svc.GenerateAndSaveToken(ctx, "user1", "space2")

	if token1 == token2 {
		t.Error("Tokens should be different")
	}

	// New token status should show space2
	status, _ := svc.GetTokenStatus(ctx, "user1")
	if status.SpaceID != "space2" {
		t.Errorf("SpaceID = %v, want space2", status.SpaceID)
	}

	// Old token hash should no longer work
	hash1 := sha256.Sum256([]byte(token1))
	tokenHash1 := hex.EncodeToString(hash1[:])
	_, _, err := svc.ValidateTokenByHash(ctx, tokenHash1)
	if !errors.Is(err, domain.ErrPushTokenNotFound) {
		t.Errorf("Old token should not work, got error = %v", err)
	}

	// New token hash should work
	hash2 := sha256.Sum256([]byte(token2))
	tokenHash2 := hex.EncodeToString(hash2[:])
	userID, _, err := svc.ValidateTokenByHash(ctx, tokenHash2)
	if err != nil {
		t.Errorf("New token should work, got error = %v", err)
	}
	if userID != "user1" {
		t.Errorf("userID = %v, want user1", userID)
	}
}

func TestPushService_MultipleUsers(t *testing.T) {
	ctx := context.Background()
	pushRepo := fake.NewPushRepository()
	svc := application.NewPushService(pushRepo)

	// Queue items for different users
	_, _ = svc.QueueMutation(ctx, "user1", "space1", "msg1", "payload1")
	_, _ = svc.QueueMutation(ctx, "user1", "space1", "msg2", "payload2")
	_, _ = svc.QueueMutation(ctx, "user2", "space1", "msg3", "payload3")

	// User1 should see 2 items
	items1, _ := svc.ListPendingItems(ctx, "user1", "")
	if len(items1) != 2 {
		t.Errorf("user1 should have 2 items, got %d", len(items1))
	}

	// User2 should see 1 item
	items2, _ := svc.ListPendingItems(ctx, "user2", "")
	if len(items2) != 1 {
		t.Errorf("user2 should have 1 item, got %d", len(items2))
	}

	// Clear user1's queue shouldn't affect user2
	_, _ = svc.ClearQueue(ctx, "user1", true)
	items2After, _ := svc.ListPendingItems(ctx, "user2", "")
	if len(items2After) != 1 {
		t.Errorf("user2 should still have 1 item, got %d", len(items2After))
	}
}
