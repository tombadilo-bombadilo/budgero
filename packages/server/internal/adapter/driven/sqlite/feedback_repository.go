package sqlite

import (
	"context"
	"database/sql"

	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
)

// FeedbackRepository implements repository.FeedbackRepository using SQLite.
// Uses raw SQL rather than sqlc so a new column on the user_feedback table
// (e.g. an attachment URL later) doesn't have to wait for an `sqlc generate`
// step in CI — same pattern activity_repository.go follows.
type FeedbackRepository struct {
	db *sql.DB
}

// NewFeedbackRepository creates a new FeedbackRepository.
func NewFeedbackRepository(db *sql.DB) *FeedbackRepository {
	return &FeedbackRepository{db: db}
}

var _ repository.FeedbackRepository = (*FeedbackRepository)(nil)

// Create persists a feedback row. ID and CreatedAt must already be set on fb.
func (r *FeedbackRepository) Create(ctx context.Context, fb *domain.Feedback) error {
	const stmt = `
INSERT INTO user_feedback (
    id, user_id, category, body, contact_back,
    screen_path, app_version, user_agent, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`
	_, err := r.db.ExecContext(ctx, stmt,
		fb.ID,
		fb.UserID,
		string(fb.Category),
		fb.Body,
		fb.ContactBack,
		fb.ScreenPath,
		fb.AppVersion,
		fb.UserAgent,
		fb.CreatedAt,
	)
	return err
}
