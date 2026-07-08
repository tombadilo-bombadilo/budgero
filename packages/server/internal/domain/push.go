package domain

import "time"

// PushToken represents a push API token for a user.
type PushToken struct {
	UserID    string     `json:"user_id"`
	TokenHash string     `json:"-"` // Never expose in JSON
	SpaceID   string     `json:"space_id"`
	IsEnabled bool       `json:"is_enabled"`
	CreatedAt time.Time  `json:"created_at"`
	LastUsed  *time.Time `json:"last_used,omitempty"`
}

// PushTokenStatus represents token status for API responses.
type PushTokenStatus struct {
	HasToken  bool       `json:"has_token"`
	SpaceID   string     `json:"space_id,omitempty"`
	CreatedAt *time.Time `json:"created_at,omitempty"`
	LastUsed  *time.Time `json:"last_used,omitempty"`
	IsEnabled bool       `json:"is_enabled"`
}

// PushQueueItem represents an item in the push notification queue.
type PushQueueItem struct {
	ID               string     `json:"id"`
	UserID           string     `json:"user_id"`
	SpaceID          string     `json:"space_id"`
	MessageID        string     `json:"message_id,omitempty"`
	EncryptedPayload string     `json:"encrypted_payload"`
	Status           string     `json:"status"`
	CreatedAt        time.Time  `json:"created_at"`
	ProcessedAt      *time.Time `json:"processed_at,omitempty"`
}

// PushQueueStats represents queue statistics.
type PushQueueStats struct {
	Pending   int `json:"pending"`
	Processed int `json:"processed"`
	Failed    int `json:"failed"`
	Total     int `json:"total"`
}

// PushStatus constants.
const (
	PushStatusPending   = "pending"
	PushStatusProcessed = "processed"
	PushStatusFailed    = "failed"
)
