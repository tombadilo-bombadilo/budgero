package application

import (
	"context"
	"fmt"
	"strings"

	"budgero-server/internal/domain"
	"budgero-server/internal/port/driving"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/bcrypt"
)

// CreateLocalUserUsecase orchestrates local user creation.
type CreateLocalUserUsecase struct {
	users       driving.UserService
	credentials driving.CredentialService
}

// NewCreateLocalUserUsecase creates a new CreateLocalUserUsecase.
func NewCreateLocalUserUsecase(users driving.UserService, credentials driving.CredentialService) *CreateLocalUserUsecase {
	return &CreateLocalUserUsecase{
		users:       users,
		credentials: credentials,
	}
}

// Execute creates a new user with local credentials.
func (uc *CreateLocalUserUsecase) Execute(ctx context.Context, name, email, password string, isAdmin bool) (*domain.User, error) {
	email = normalizeEmail(email)
	if email == "" {
		return nil, fmt.Errorf("email required")
	}
	if len(password) < 8 {
		return nil, fmt.Errorf("password must be at least 8 characters")
	}

	userID := uuid.NewString()

	// Create user in users table
	user, err := uc.users.Create(ctx, userID, name, email)
	if err != nil {
		return nil, err
	}

	// Create credentials
	if err := uc.credentials.Create(ctx, user.ID, password, isAdmin); err != nil {
		return nil, fmt.Errorf("failed to create credentials: %w", err)
	}

	return user, nil
}

// AuthenticateLocalUserUsecase orchestrates local authentication.
type AuthenticateLocalUserUsecase struct {
	users       driving.UserService
	credentials driving.CredentialService
}

// NewAuthenticateLocalUserUsecase creates a new AuthenticateLocalUserUsecase.
func NewAuthenticateLocalUserUsecase(users driving.UserService, credentials driving.CredentialService) *AuthenticateLocalUserUsecase {
	return &AuthenticateLocalUserUsecase{
		users:       users,
		credentials: credentials,
	}
}

// Execute authenticates a user with email and password.
func (uc *AuthenticateLocalUserUsecase) Execute(ctx context.Context, email, password string) (*domain.User, bool, error) {
	email = normalizeEmail(email)
	if email == "" || password == "" {
		return nil, false, domain.ErrInvalidCredentials
	}

	user, err := uc.users.GetByEmail(ctx, email)
	if err != nil {
		return nil, false, domain.ErrInvalidCredentials
	}

	blocked, err := uc.users.IsBlocked(ctx, user.ID)
	if err != nil || blocked {
		return nil, false, domain.ErrInvalidCredentials
	}

	cred, err := uc.credentials.Get(ctx, user.ID)
	if err != nil {
		return nil, false, domain.ErrInvalidCredentials
	}

	if err := bcrypt.CompareHashAndPassword([]byte(cred.PasswordHash), []byte(password)); err != nil {
		return nil, false, domain.ErrInvalidCredentials
	}

	if err := uc.credentials.MarkLogin(ctx, user.ID); err != nil {
		log.Warn().Err(err).Str("user_id", user.ID).Msg("failed to record last login")
	}

	return user, cred.IsAdmin, nil
}

// normalizeEmail lowercases and trims whitespace from an email address.
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
