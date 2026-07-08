package domain

import "time"

// Credential represents local authentication credentials for a user.
type Credential struct {
	UserID       string     `json:"user_id"`
	PasswordHash string     `json:"-"` // Never expose in JSON
	IsAdmin      bool       `json:"is_admin"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    *time.Time `json:"updated_at,omitempty"`
	LastLoginAt  *time.Time `json:"last_login_at,omitempty"`
}
