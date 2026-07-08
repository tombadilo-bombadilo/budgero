package application

import (
	"context"
	"errors"
	"strings"
	"time"

	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
	"budgero-server/internal/port/driving"

	"github.com/google/uuid"
)

// maxFeedbackBodyLen caps the body at 4 KB so a single submission can't be
// used as a write-amplification vector. The UI textarea is short; anything
// past this is almost certainly abuse.
const maxFeedbackBodyLen = 4096

// ErrFeedbackBodyEmpty / ErrFeedbackCategoryInvalid surface as 400s from the
// HTTP handler.
var (
	ErrFeedbackBodyEmpty      = errors.New("feedback body is empty")
	ErrFeedbackCategoryInvalid = errors.New("feedback category invalid")
	ErrFeedbackBodyTooLong    = errors.New("feedback body too long")
)

// FeedbackService implements driving.FeedbackService.
type FeedbackService struct {
	repo repository.FeedbackRepository
}

// NewFeedbackService creates a new FeedbackService.
func NewFeedbackService(repo repository.FeedbackRepository) *FeedbackService {
	return &FeedbackService{repo: repo}
}

var _ driving.FeedbackService = (*FeedbackService)(nil)

// Submit validates input and persists a new feedback row.
func (s *FeedbackService) Submit(ctx context.Context, userID string, in *driving.FeedbackSubmission) (*domain.Feedback, error) {
	if in == nil {
		return nil, ErrFeedbackCategoryInvalid
	}
	if !in.Category.IsValid() {
		return nil, ErrFeedbackCategoryInvalid
	}
	body := strings.TrimSpace(in.Body)
	if body == "" {
		return nil, ErrFeedbackBodyEmpty
	}
	if len(body) > maxFeedbackBodyLen {
		return nil, ErrFeedbackBodyTooLong
	}

	// Praise never opens a follow-up loop — force ContactBack off regardless
	// of what the client sent. The UI hides the checkbox there, but defense
	// in depth: don't trust the client to do that.
	contactBack := in.ContactBack
	if in.Category == domain.FeedbackCategoryPraise {
		contactBack = false
	}

	fb := &domain.Feedback{
		ID:          uuid.NewString(),
		UserID:      userID,
		Category:    in.Category,
		Body:        body,
		ContactBack: contactBack,
		ScreenPath:  in.ScreenPath,
		AppVersion:  in.AppVersion,
		UserAgent:   in.UserAgent,
		CreatedAt:   time.Now().UTC(),
	}
	if err := s.repo.Create(ctx, fb); err != nil {
		return nil, err
	}
	return fb, nil
}
