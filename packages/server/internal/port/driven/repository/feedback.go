package repository

import (
	"context"

	"budgero-server/internal/domain"
)

// FeedbackRepository persists user-submitted feedback.
type FeedbackRepository interface {
	// Create persists a new feedback row. The ID and CreatedAt fields must
	// already be set by the caller.
	Create(ctx context.Context, fb *domain.Feedback) error
}
