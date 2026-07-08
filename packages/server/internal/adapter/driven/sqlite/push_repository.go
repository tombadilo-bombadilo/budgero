package sqlite

import (
	"context"
	"database/sql"
	"errors"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
)

// PushRepository implements repository.PushRepository using SQLite.
type PushRepository struct {
	queries *sqlc.Queries
}

// NewPushRepository creates a new PushRepository.
func NewPushRepository(queries *sqlc.Queries) *PushRepository {
	return &PushRepository{queries: queries}
}

var _ repository.PushRepository = (*PushRepository)(nil)

// UpsertToken creates or updates a push notification token for a user.
func (r *PushRepository) UpsertToken(ctx context.Context, userID, tokenHash, spaceID string) error {
	return r.queries.UpsertPushAPIToken(ctx, sqlc.UpsertPushAPITokenParams{
		UserID:    userID,
		TokenHash: tokenHash,
		SpaceID:   spaceID,
	})
}

// GetToken retrieves the push token for a user.
func (r *PushRepository) GetToken(ctx context.Context, userID string) (*domain.PushToken, error) {
	token, err := r.queries.GetPushAPIToken(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrPushTokenNotFound
		}
		return nil, err
	}
	return ToPushToken(&token), nil
}

// GetTokenByHash retrieves a push token by its hash value.
func (r *PushRepository) GetTokenByHash(ctx context.Context, tokenHash string) (*domain.PushToken, error) {
	token, err := r.queries.GetPushAPITokenByHash(ctx, tokenHash)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrPushTokenNotFound
		}
		return nil, err
	}
	return ToPushToken(&token), nil
}

// SetTokenEnabled enables or disables a user's push token.
func (r *PushRepository) SetTokenEnabled(ctx context.Context, userID string, enabled bool) error {
	return r.queries.SetPushTokenEnabled(ctx, sqlc.SetPushTokenEnabledParams{
		IsEnabled: enabled,
		UserID:    userID,
	})
}

// DeleteToken removes the push token for a user.
func (r *PushRepository) DeleteToken(ctx context.Context, userID string) error {
	return r.queries.DeletePushAPIToken(ctx, userID)
}

// MarkTokenUsed updates the last used timestamp for a push token.
func (r *PushRepository) MarkTokenUsed(ctx context.Context, userID string) error {
	return r.queries.MarkPushTokenUsed(ctx, userID)
}

// CreateQueueItem adds a new item to the push notification queue.
func (r *PushRepository) CreateQueueItem(ctx context.Context, item *domain.PushQueueItem) error {
	return r.queries.CreatePushQueueItem(ctx, sqlc.CreatePushQueueItemParams{
		ID:               item.ID,
		UserID:           item.UserID,
		SpaceID:          item.SpaceID,
		MessageID:        sql.NullString{String: item.MessageID, Valid: item.MessageID != ""},
		EncryptedPayload: item.EncryptedPayload,
	})
}

// CheckDuplicateMessage checks if a message ID already exists in the queue.
func (r *PushRepository) CheckDuplicateMessage(ctx context.Context, spaceID, messageID string) (existingID, status string, exists bool, err error) {
	if messageID == "" {
		return "", "", false, nil
	}

	result, err := r.queries.CheckDuplicateMessageID(ctx, sqlc.CheckDuplicateMessageIDParams{
		SpaceID:   spaceID,
		MessageID: sql.NullString{String: messageID, Valid: true},
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", "", false, nil
		}
		return "", "", false, err
	}

	return result.ID, result.Status, true, nil
}

// ListPendingItems returns all pending push queue items for a user.
func (r *PushRepository) ListPendingItems(ctx context.Context, userID string) ([]domain.PushQueueItem, error) {
	rows, err := r.queries.ListPendingPushItemsForUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	items := make([]domain.PushQueueItem, 0, len(rows))
	for i := range rows {
		items = append(items, ToPushQueueItem(&rows[i]))
	}
	return items, nil
}

// ListPendingItemsForSpace returns pending push queue items for a user in a specific space.
func (r *PushRepository) ListPendingItemsForSpace(ctx context.Context, userID, spaceID string) ([]domain.PushQueueItem, error) {
	rows, err := r.queries.ListPendingPushItemsForUserAndSpace(ctx, sqlc.ListPendingPushItemsForUserAndSpaceParams{
		UserID:  userID,
		SpaceID: spaceID,
	})
	if err != nil {
		return nil, err
	}

	items := make([]domain.PushQueueItem, 0, len(rows))
	for i := range rows {
		items = append(items, ToPushQueueItem(&rows[i]))
	}
	return items, nil
}

// UpdateItemStatus updates the status of a push queue item.
func (r *PushRepository) UpdateItemStatus(ctx context.Context, itemID, userID, status string) error {
	return r.queries.UpdatePushQueueItemStatus(ctx, sqlc.UpdatePushQueueItemStatusParams{
		Status: status,
		ID:     itemID,
		UserID: userID,
	})
}

// GetStats returns push queue statistics for a user.
func (r *PushRepository) GetStats(ctx context.Context, userID string) (*domain.PushQueueStats, error) {
	row, err := r.queries.GetPushQueueStats(ctx, userID)
	if err != nil {
		return nil, err
	}

	pending := int(ToInt64(row.PendingCount))
	processed := int(ToInt64(row.ProcessedCount))
	failed := int(ToInt64(row.FailedCount))

	return &domain.PushQueueStats{
		Pending:   pending,
		Processed: processed,
		Failed:    failed,
		Total:     pending + processed + failed,
	}, nil
}

// ClearPendingQueue removes all pending items from a user's push queue.
func (r *PushRepository) ClearPendingQueue(ctx context.Context, userID string) (int64, error) {
	result, err := r.queries.ClearPendingPushQueue(ctx, userID)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// ClearAllQueue removes all items from a user's push queue.
func (r *PushRepository) ClearAllQueue(ctx context.Context, userID string) (int64, error) {
	result, err := r.queries.ClearAllPushQueue(ctx, userID)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}
