package application

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"

	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
	"budgero-server/internal/port/driving"

	"github.com/google/uuid"
)

// PushService implements driving.PushService.
type PushService struct {
	pushRepo repository.PushRepository
}

// NewPushService creates a new PushService.
func NewPushService(pushRepo repository.PushRepository) *PushService {
	return &PushService{pushRepo: pushRepo}
}

var _ driving.PushService = (*PushService)(nil)

// GenerateAndSaveToken generates a new push token and saves it for the user.
func (s *PushService) GenerateAndSaveToken(ctx context.Context, userID, spaceID string) (string, error) {
	// Generate a secure random token
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", fmt.Errorf("failed to generate token: %w", err)
	}
	token := hex.EncodeToString(tokenBytes)

	// Hash the token for storage
	hash := sha256.Sum256([]byte(token))
	tokenHash := hex.EncodeToString(hash[:])

	if err := s.pushRepo.UpsertToken(ctx, userID, tokenHash, spaceID); err != nil {
		return "", err
	}

	return token, nil
}

// GetTokenStatus returns the push token status for a user.
func (s *PushService) GetTokenStatus(ctx context.Context, userID string) (*domain.PushTokenStatus, error) {
	token, err := s.pushRepo.GetToken(ctx, userID)
	if err != nil {
		if errors.Is(err, domain.ErrPushTokenNotFound) {
			return &domain.PushTokenStatus{HasToken: false}, nil
		}
		return nil, err
	}

	return &domain.PushTokenStatus{
		HasToken:  true,
		SpaceID:   token.SpaceID,
		CreatedAt: &token.CreatedAt,
		LastUsed:  token.LastUsed,
		IsEnabled: token.IsEnabled,
	}, nil
}

// SetTokenEnabled enables or disables a user's push token.
func (s *PushService) SetTokenEnabled(ctx context.Context, userID string, enabled bool) error {
	return s.pushRepo.SetTokenEnabled(ctx, userID, enabled)
}

// RevokeToken revokes and deletes a user's push token.
func (s *PushService) RevokeToken(ctx context.Context, userID string) error {
	return s.pushRepo.DeleteToken(ctx, userID)
}

// ValidateTokenByHash validates a push token by its hash and returns user and space IDs.
func (s *PushService) ValidateTokenByHash(ctx context.Context, tokenHash string) (userID, spaceID string, err error) {
	token, err := s.pushRepo.GetTokenByHash(ctx, tokenHash)
	if err != nil {
		return "", "", err
	}

	if !token.IsEnabled {
		return "", "", domain.ErrPushTokenInvalid
	}

	// Mark token as used
	_ = s.pushRepo.MarkTokenUsed(ctx, token.UserID)

	return token.UserID, token.SpaceID, nil
}

// CheckDuplicateMessage checks if a message has already been processed.
func (s *PushService) CheckDuplicateMessage(ctx context.Context, spaceID, messageID string) (existingID, status string, exists bool, err error) {
	return s.pushRepo.CheckDuplicateMessage(ctx, spaceID, messageID)
}

// QueueMutation adds a mutation to the push queue and returns its ID.
func (s *PushService) QueueMutation(ctx context.Context, userID, spaceID, messageID, encryptedPayload string) (string, error) {
	item := &domain.PushQueueItem{
		ID:               uuid.New().String(),
		UserID:           userID,
		SpaceID:          spaceID,
		MessageID:        messageID,
		EncryptedPayload: encryptedPayload,
		Status:           domain.PushStatusPending,
	}

	if err := s.pushRepo.CreateQueueItem(ctx, item); err != nil {
		return "", err
	}

	return item.ID, nil
}

// ListPendingItems returns pending push queue items for a user, optionally filtered by space.
func (s *PushService) ListPendingItems(ctx context.Context, userID, spaceID string) ([]domain.PushQueueItem, error) {
	if spaceID != "" {
		return s.pushRepo.ListPendingItemsForSpace(ctx, userID, spaceID)
	}
	return s.pushRepo.ListPendingItems(ctx, userID)
}

// AckItem acknowledges a push queue item with the given status.
func (s *PushService) AckItem(ctx context.Context, userID, itemID, status string) error {
	return s.pushRepo.UpdateItemStatus(ctx, itemID, userID, status)
}

// GetStats returns push queue statistics for a user.
func (s *PushService) GetStats(ctx context.Context, userID string) (*domain.PushQueueStats, error) {
	return s.pushRepo.GetStats(ctx, userID)
}

// ClearQueue clears pending or all push queue items for a user.
func (s *PushService) ClearQueue(ctx context.Context, userID string, clearAll bool) (int64, error) {
	if clearAll {
		return s.pushRepo.ClearAllQueue(ctx, userID)
	}
	return s.pushRepo.ClearPendingQueue(ctx, userID)
}

// DeleteUserPushData deletes all push data for a user including tokens and queue items.
func (s *PushService) DeleteUserPushData(ctx context.Context, userID string) error {
	// Clear all queue items
	if _, err := s.pushRepo.ClearAllQueue(ctx, userID); err != nil {
		return err
	}
	// Delete token
	return s.pushRepo.DeleteToken(ctx, userID)
}
