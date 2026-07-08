package sqlite_test

import (
	"context"
	"errors"
	"testing"

	"budgero-server/internal/adapter/driven/sqlite"
	"budgero-server/internal/domain"
	"budgero-server/internal/testkit"
)

func TestPushRepository_UpsertToken(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewPushRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "push@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	tokenHash := testkit.GenerateHash()
	err := repo.UpsertToken(ctx, userID, tokenHash, spaceID)
	if err != nil {
		t.Fatalf("UpsertToken() error = %v", err)
	}

	// Verify
	token, err := repo.GetToken(ctx, userID)
	if err != nil {
		t.Fatalf("GetToken() error = %v", err)
	}
	if token.TokenHash != tokenHash {
		t.Errorf("TokenHash = %v, want %v", token.TokenHash, tokenHash)
	}
}

func TestPushRepository_GetToken(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewPushRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "push@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")
	tokenHash := testkit.SeedPushToken(t, queries, userID, spaceID)

	token, err := repo.GetToken(ctx, userID)
	if err != nil {
		t.Fatalf("GetToken() error = %v", err)
	}
	if token.TokenHash != tokenHash {
		t.Errorf("TokenHash = %v, want %v", token.TokenHash, tokenHash)
	}
	if token.UserID != userID {
		t.Errorf("UserID = %v, want %v", token.UserID, userID)
	}
}

func TestPushRepository_GetToken_NotFound(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewPushRepository(queries)
	ctx := context.Background()

	_, err := repo.GetToken(ctx, "nonexistent")
	if !errors.Is(err, domain.ErrPushTokenNotFound) {
		t.Errorf("GetToken() error = %v, want ErrPushTokenNotFound", err)
	}
}

func TestPushRepository_GetTokenByHash(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewPushRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "push@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")
	tokenHash := testkit.SeedPushToken(t, queries, userID, spaceID)

	token, err := repo.GetTokenByHash(ctx, tokenHash)
	if err != nil {
		t.Fatalf("GetTokenByHash() error = %v", err)
	}
	if token.UserID != userID {
		t.Errorf("UserID = %v, want %v", token.UserID, userID)
	}
}

func TestPushRepository_GetTokenByHash_NotFound(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewPushRepository(queries)
	ctx := context.Background()

	_, err := repo.GetTokenByHash(ctx, "nonexistent_hash")
	if !errors.Is(err, domain.ErrPushTokenNotFound) {
		t.Errorf("GetTokenByHash() error = %v, want ErrPushTokenNotFound", err)
	}
}

func TestPushRepository_SetTokenEnabled(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewPushRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "push@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")
	testkit.SeedPushToken(t, queries, userID, spaceID)

	// Disable
	err := repo.SetTokenEnabled(ctx, userID, false)
	if err != nil {
		t.Fatalf("SetTokenEnabled(false) error = %v", err)
	}

	token, _ := repo.GetToken(ctx, userID)
	if token.IsEnabled {
		t.Error("IsEnabled = true, want false")
	}

	// Enable
	err = repo.SetTokenEnabled(ctx, userID, true)
	if err != nil {
		t.Fatalf("SetTokenEnabled(true) error = %v", err)
	}

	token, _ = repo.GetToken(ctx, userID)
	if !token.IsEnabled {
		t.Error("IsEnabled = false, want true")
	}
}

func TestPushRepository_DeleteToken(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewPushRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "push@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")
	testkit.SeedPushToken(t, queries, userID, spaceID)

	err := repo.DeleteToken(ctx, userID)
	if err != nil {
		t.Fatalf("DeleteToken() error = %v", err)
	}

	_, err = repo.GetToken(ctx, userID)
	if !errors.Is(err, domain.ErrPushTokenNotFound) {
		t.Errorf("GetToken() after delete: error = %v, want ErrPushTokenNotFound", err)
	}
}

func TestPushRepository_MarkTokenUsed(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewPushRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "push@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")
	testkit.SeedPushToken(t, queries, userID, spaceID)

	err := repo.MarkTokenUsed(ctx, userID)
	if err != nil {
		t.Fatalf("MarkTokenUsed() error = %v", err)
	}

	token, _ := repo.GetToken(ctx, userID)
	if token.LastUsed == nil {
		t.Error("LastUsed = nil after MarkTokenUsed, want non-nil")
	}
}

func TestPushRepository_CreateQueueItem(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewPushRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "push@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	item := &domain.PushQueueItem{
		ID:               testkit.GenerateID(),
		UserID:           userID,
		SpaceID:          spaceID,
		MessageID:        "msg123",
		EncryptedPayload: "encrypted_data",
	}

	err := repo.CreateQueueItem(ctx, item)
	if err != nil {
		t.Fatalf("CreateQueueItem() error = %v", err)
	}

	// Verify
	items, _ := repo.ListPendingItems(ctx, userID)
	if len(items) != 1 {
		t.Errorf("ListPendingItems() returned %d items, want 1", len(items))
	}
}

func TestPushRepository_CheckDuplicateMessage(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewPushRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "push@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	messageID := "unique_msg_123"
	item := &domain.PushQueueItem{
		ID:               testkit.GenerateID(),
		UserID:           userID,
		SpaceID:          spaceID,
		MessageID:        messageID,
		EncryptedPayload: "data",
	}
	_ = repo.CreateQueueItem(ctx, item)

	// Check for duplicate
	existingID, status, exists, err := repo.CheckDuplicateMessage(ctx, spaceID, messageID)
	if err != nil {
		t.Fatalf("CheckDuplicateMessage() error = %v", err)
	}
	if !exists {
		t.Error("CheckDuplicateMessage() exists = false, want true")
	}
	if existingID != item.ID {
		t.Errorf("CheckDuplicateMessage() existingID = %v, want %v", existingID, item.ID)
	}
	if status != "pending" {
		t.Errorf("CheckDuplicateMessage() status = %v, want pending", status)
	}

	// Check for non-duplicate
	_, _, exists, _ = repo.CheckDuplicateMessage(ctx, spaceID, "different_msg")
	if exists {
		t.Error("CheckDuplicateMessage() exists = true for new message, want false")
	}
}

func TestPushRepository_CheckDuplicateMessage_EmptyMessageID(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewPushRepository(queries)
	ctx := context.Background()

	_, _, exists, err := repo.CheckDuplicateMessage(ctx, "space", "")
	if err != nil {
		t.Fatalf("CheckDuplicateMessage() error = %v", err)
	}
	if exists {
		t.Error("CheckDuplicateMessage() exists = true for empty messageID, want false")
	}
}

func TestPushRepository_ListPendingItems(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewPushRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "push@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	// Create items
	for i := 0; i < 3; i++ {
		_ = repo.CreateQueueItem(ctx, &domain.PushQueueItem{
			ID:               testkit.GenerateID(),
			UserID:           userID,
			SpaceID:          spaceID,
			EncryptedPayload: "data",
		})
	}

	items, err := repo.ListPendingItems(ctx, userID)
	if err != nil {
		t.Fatalf("ListPendingItems() error = %v", err)
	}
	if len(items) != 3 {
		t.Errorf("ListPendingItems() returned %d items, want 3", len(items))
	}
}

func TestPushRepository_ListPendingItemsForSpace(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewPushRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "push@example.com")
	space1ID := testkit.SeedSpace(t, sqlDB, queries, userID, "Space 1")
	space2ID := testkit.SeedSpace(t, sqlDB, queries, userID, "Space 2")

	// Create items in different spaces
	_ = repo.CreateQueueItem(ctx, &domain.PushQueueItem{ID: testkit.GenerateID(), UserID: userID, SpaceID: space1ID, EncryptedPayload: "data"})
	_ = repo.CreateQueueItem(ctx, &domain.PushQueueItem{ID: testkit.GenerateID(), UserID: userID, SpaceID: space1ID, EncryptedPayload: "data"})
	_ = repo.CreateQueueItem(ctx, &domain.PushQueueItem{ID: testkit.GenerateID(), UserID: userID, SpaceID: space2ID, EncryptedPayload: "data"})

	items, err := repo.ListPendingItemsForSpace(ctx, userID, space1ID)
	if err != nil {
		t.Fatalf("ListPendingItemsForSpace() error = %v", err)
	}
	if len(items) != 2 {
		t.Errorf("ListPendingItemsForSpace() returned %d items, want 2", len(items))
	}
}

func TestPushRepository_UpdateItemStatus(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewPushRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "push@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	itemID := testkit.GenerateID()
	_ = repo.CreateQueueItem(ctx, &domain.PushQueueItem{
		ID:               itemID,
		UserID:           userID,
		SpaceID:          spaceID,
		EncryptedPayload: "data",
	})

	err := repo.UpdateItemStatus(ctx, itemID, userID, "processed")
	if err != nil {
		t.Fatalf("UpdateItemStatus() error = %v", err)
	}

	// Pending items should now be 0
	items, _ := repo.ListPendingItems(ctx, userID)
	if len(items) != 0 {
		t.Errorf("ListPendingItems() after status update returned %d items, want 0", len(items))
	}
}

func TestPushRepository_GetStats(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewPushRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "push@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	// Create items with different statuses
	item1ID := testkit.GenerateID()
	item2ID := testkit.GenerateID()
	_ = repo.CreateQueueItem(ctx, &domain.PushQueueItem{ID: item1ID, UserID: userID, SpaceID: spaceID, EncryptedPayload: "data"})
	_ = repo.CreateQueueItem(ctx, &domain.PushQueueItem{ID: item2ID, UserID: userID, SpaceID: spaceID, EncryptedPayload: "data"})
	_ = repo.CreateQueueItem(ctx, &domain.PushQueueItem{ID: testkit.GenerateID(), UserID: userID, SpaceID: spaceID, EncryptedPayload: "data"})

	_ = repo.UpdateItemStatus(ctx, item1ID, userID, "processed")
	_ = repo.UpdateItemStatus(ctx, item2ID, userID, "failed")

	stats, err := repo.GetStats(ctx, userID)
	if err != nil {
		t.Fatalf("GetStats() error = %v", err)
	}
	if stats.Pending != 1 {
		t.Errorf("Pending = %v, want 1", stats.Pending)
	}
	if stats.Processed != 1 {
		t.Errorf("Processed = %v, want 1", stats.Processed)
	}
	if stats.Failed != 1 {
		t.Errorf("Failed = %v, want 1", stats.Failed)
	}
	if stats.Total != 3 {
		t.Errorf("Total = %v, want 3", stats.Total)
	}
}

func TestPushRepository_ClearPendingQueue(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewPushRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "push@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	// Create items
	item1ID := testkit.GenerateID()
	_ = repo.CreateQueueItem(ctx, &domain.PushQueueItem{ID: item1ID, UserID: userID, SpaceID: spaceID, EncryptedPayload: "data"})
	_ = repo.CreateQueueItem(ctx, &domain.PushQueueItem{ID: testkit.GenerateID(), UserID: userID, SpaceID: spaceID, EncryptedPayload: "data"})

	// Mark one as processed
	_ = repo.UpdateItemStatus(ctx, item1ID, userID, "processed")

	// Clear pending
	cleared, err := repo.ClearPendingQueue(ctx, userID)
	if err != nil {
		t.Fatalf("ClearPendingQueue() error = %v", err)
	}
	if cleared != 1 {
		t.Errorf("ClearPendingQueue() cleared = %v, want 1", cleared)
	}

	// Should have no pending items, but processed item remains
	stats, _ := repo.GetStats(ctx, userID)
	if stats.Pending != 0 {
		t.Errorf("Pending after clear = %v, want 0", stats.Pending)
	}
	if stats.Processed != 1 {
		t.Errorf("Processed after clear = %v, want 1", stats.Processed)
	}
}

func TestPushRepository_ClearAllQueue(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewPushRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "push@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")

	// Create items
	item1ID := testkit.GenerateID()
	_ = repo.CreateQueueItem(ctx, &domain.PushQueueItem{ID: item1ID, UserID: userID, SpaceID: spaceID, EncryptedPayload: "data"})
	_ = repo.CreateQueueItem(ctx, &domain.PushQueueItem{ID: testkit.GenerateID(), UserID: userID, SpaceID: spaceID, EncryptedPayload: "data"})

	// Mark one as processed
	_ = repo.UpdateItemStatus(ctx, item1ID, userID, "processed")

	// Clear all
	cleared, err := repo.ClearAllQueue(ctx, userID)
	if err != nil {
		t.Fatalf("ClearAllQueue() error = %v", err)
	}
	if cleared != 2 {
		t.Errorf("ClearAllQueue() cleared = %v, want 2", cleared)
	}

	stats, _ := repo.GetStats(ctx, userID)
	if stats.Total != 0 {
		t.Errorf("Total after clear all = %v, want 0", stats.Total)
	}
}
