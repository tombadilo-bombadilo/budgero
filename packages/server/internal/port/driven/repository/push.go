package repository

import (
	"context"

	"budgero-server/internal/domain"
)

// PushRepository defines methods for push notification queue and token persistence.
type PushRepository interface {
	// Token operations

	// UpsertToken creates or updates a push API token.
	UpsertToken(ctx context.Context, userID, tokenHash, spaceID string) error

	// GetToken retrieves a user's push API token info.
	GetToken(ctx context.Context, userID string) (*domain.PushToken, error)

	// GetTokenByHash retrieves a token by its hash.
	GetTokenByHash(ctx context.Context, tokenHash string) (*domain.PushToken, error)

	// SetTokenEnabled enables or disables a user's push API token.
	SetTokenEnabled(ctx context.Context, userID string, enabled bool) error

	// DeleteToken deletes a user's push API token.
	DeleteToken(ctx context.Context, userID string) error

	// MarkTokenUsed updates the last used timestamp for a token.
	MarkTokenUsed(ctx context.Context, userID string) error

	// Queue operations

	// CreateQueueItem adds an item to the push queue.
	CreateQueueItem(ctx context.Context, item *domain.PushQueueItem) error

	// CheckDuplicateMessage checks if a message ID already exists for a space.
	CheckDuplicateMessage(ctx context.Context, spaceID, messageID string) (existingID, status string, exists bool, err error)

	// ListPendingItems returns pending push queue items for a user.
	ListPendingItems(ctx context.Context, userID string) ([]domain.PushQueueItem, error)

	// ListPendingItemsForSpace returns pending push queue items for a user and space.
	ListPendingItemsForSpace(ctx context.Context, userID, spaceID string) ([]domain.PushQueueItem, error)

	// UpdateItemStatus updates the status of a push queue item.
	UpdateItemStatus(ctx context.Context, itemID, userID, status string) error

	// GetStats returns push queue statistics for a user.
	GetStats(ctx context.Context, userID string) (*domain.PushQueueStats, error)

	// ClearPendingQueue clears pending push queue items for a user.
	ClearPendingQueue(ctx context.Context, userID string) (int64, error)

	// ClearAllQueue clears all push queue items for a user.
	ClearAllQueue(ctx context.Context, userID string) (int64, error)
}
