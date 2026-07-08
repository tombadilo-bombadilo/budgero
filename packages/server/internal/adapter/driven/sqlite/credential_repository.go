package sqlite

import (
	"context"
	"database/sql"
	"errors"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
)

// CredentialRepository implements repository.CredentialRepository using SQLite.
type CredentialRepository struct {
	queries *sqlc.Queries
}

// NewCredentialRepository creates a new CredentialRepository.
func NewCredentialRepository(queries *sqlc.Queries) *CredentialRepository {
	return &CredentialRepository{queries: queries}
}

var _ repository.CredentialRepository = (*CredentialRepository)(nil)

// Create stores a new local credential for a user.
func (r *CredentialRepository) Create(ctx context.Context, userID, passwordHash string, isAdmin bool) error {
	return r.queries.CreateLocalCredential(ctx, sqlc.CreateLocalCredentialParams{
		UserID:       userID,
		PasswordHash: passwordHash,
		IsAdmin:      isAdmin,
	})
}

// Upsert creates or updates a local credential for a user.
func (r *CredentialRepository) Upsert(ctx context.Context, userID, passwordHash string, isAdmin bool) error {
	return r.queries.UpsertLocalCredential(ctx, sqlc.UpsertLocalCredentialParams{
		UserID:       userID,
		PasswordHash: passwordHash,
		IsAdmin:      isAdmin,
	})
}

// Get retrieves the local credential for a user.
func (r *CredentialRepository) Get(ctx context.Context, userID string) (*domain.Credential, error) {
	cred, err := r.queries.GetLocalCredential(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrInvalidCredentials
		}
		return nil, err
	}
	return ToCredential(&cred), nil
}

// UpdatePassword updates the password hash for a user's credential.
func (r *CredentialRepository) UpdatePassword(ctx context.Context, userID, passwordHash string) error {
	return r.queries.UpdateLocalCredentialPassword(ctx, sqlc.UpdateLocalCredentialPasswordParams{
		PasswordHash: passwordHash,
		UserID:       userID,
	})
}

// SetAdmin sets the admin status for a user's credential.
func (r *CredentialRepository) SetAdmin(ctx context.Context, userID string, isAdmin bool) error {
	return r.queries.SetLocalAdmin(ctx, sqlc.SetLocalAdminParams{
		IsAdmin: isAdmin,
		UserID:  userID,
	})
}

// IsAdmin checks if a user has admin privileges.
func (r *CredentialRepository) IsAdmin(ctx context.Context, userID string) (bool, error) {
	isAdmin, err := r.queries.IsLocalAdmin(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return isAdmin, nil
}

// MarkLogin updates the last login timestamp for a user.
func (r *CredentialRepository) MarkLogin(ctx context.Context, userID string) error {
	return r.queries.MarkLocalLogin(ctx, userID)
}
