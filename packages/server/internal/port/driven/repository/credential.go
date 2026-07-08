package repository

import (
	"context"

	"budgero-server/internal/domain"
)

// CredentialRepository defines methods for local authentication credential persistence.
type CredentialRepository interface {
	// Create creates local credentials for a user.
	Create(ctx context.Context, userID, passwordHash string, isAdmin bool) error

	// Upsert creates or updates local credentials.
	Upsert(ctx context.Context, userID, passwordHash string, isAdmin bool) error

	// Get retrieves credentials for a user.
	Get(ctx context.Context, userID string) (*domain.Credential, error)

	// UpdatePassword updates the password hash for a user.
	UpdatePassword(ctx context.Context, userID, passwordHash string) error

	// SetAdmin sets the admin status for a user.
	SetAdmin(ctx context.Context, userID string, isAdmin bool) error

	// IsAdmin checks if a user has admin status.
	IsAdmin(ctx context.Context, userID string) (bool, error)

	// MarkLogin updates the last login timestamp.
	MarkLogin(ctx context.Context, userID string) error
}
