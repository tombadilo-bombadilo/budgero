package domain

import "time"

// FeedbackCategory is the bucket the user picked in the in-app form.
// Validated at the service layer; anything else is rejected with 400.
type FeedbackCategory string

// Known feedback categories surfaced in the picker step of the UI.
const (
	FeedbackCategoryBug    FeedbackCategory = "bug"
	FeedbackCategoryIdea   FeedbackCategory = "idea"
	FeedbackCategoryPraise FeedbackCategory = "praise"
)

// IsValid returns true if the category is one of the known buckets.
func (c FeedbackCategory) IsValid() bool {
	switch c {
	case FeedbackCategoryBug, FeedbackCategoryIdea, FeedbackCategoryPraise:
		return true
	}
	return false
}

// Feedback is one submission from the in-app feedback widget.
// The user is always authenticated — email/name are joined from users
// when needed, not duplicated here. ContactBack is the user's opt-in for
// the team to follow up; the UI surfaces it for bug/idea only.
type Feedback struct {
	ID          string           `json:"id"`
	UserID      string           `json:"user_id"`
	Category    FeedbackCategory `json:"category"`
	Body        string           `json:"body"`
	ContactBack bool             `json:"contact_back"`
	ScreenPath  string           `json:"screen_path"`
	AppVersion  string           `json:"app_version"`
	UserAgent   string           `json:"user_agent"`
	CreatedAt   time.Time        `json:"created_at"`
}
