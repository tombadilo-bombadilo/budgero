package application

import (
	"context"
	"errors"
	"fmt"
	"unicode"

	"budgero-server/internal/config"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
	"budgero-server/internal/port/driving"

	"golang.org/x/crypto/bcrypt"
)

// CredentialService implements driving.CredentialService.
type CredentialService struct {
	credRepo repository.CredentialRepository
	cfg      *config.Config
}

// NewCredentialService creates a new CredentialService.
func NewCredentialService(
	credRepo repository.CredentialRepository,
	cfg *config.Config,
) *CredentialService {
	return &CredentialService{
		credRepo: credRepo,
		cfg:      cfg,
	}
}

var _ driving.CredentialService = (*CredentialService)(nil)

// Create creates new credentials for a user with the given password.
func (s *CredentialService) Create(ctx context.Context, userID, password string, isAdmin bool) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}
	return s.credRepo.Create(ctx, userID, string(hash), isAdmin)
}

// Verify verifies a user's password against stored credentials.
func (s *CredentialService) Verify(ctx context.Context, userID, password string) error {
	cred, err := s.credRepo.Get(ctx, userID)
	if err != nil {
		return domain.ErrInvalidCredentials
	}

	if err := bcrypt.CompareHashAndPassword([]byte(cred.PasswordHash), []byte(password)); err != nil {
		return domain.ErrInvalidCredentials
	}

	return nil
}

// UpdatePassword updates a user's password.
func (s *CredentialService) UpdatePassword(ctx context.Context, userID, newPassword string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}
	return s.credRepo.UpdatePassword(ctx, userID, string(hash))
}

// SetPassword sets or updates a user's password with validation.
func (s *CredentialService) SetPassword(ctx context.Context, userID, password string, isAdmin bool) error {
	if err := s.validatePassword(password); err != nil {
		return err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	return s.credRepo.Upsert(ctx, userID, string(hash), isAdmin)
}

// ResetPassword resets a user's password while preserving their admin status.
func (s *CredentialService) ResetPassword(ctx context.Context, userID, password string) error {
	if err := s.validatePassword(password); err != nil {
		return err
	}

	// Get existing credential to preserve admin status
	cred, err := s.credRepo.Get(ctx, userID)
	isAdmin := false
	if err == nil && cred != nil {
		isAdmin = cred.IsAdmin
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	return s.credRepo.Upsert(ctx, userID, string(hash), isAdmin)
}

// Get retrieves credentials for a user.
func (s *CredentialService) Get(ctx context.Context, userID string) (*domain.Credential, error) {
	return s.credRepo.Get(ctx, userID)
}

// IsAdmin checks if a user has administrator privileges.
func (s *CredentialService) IsAdmin(ctx context.Context, userID string) bool {
	isAdmin, err := s.credRepo.IsAdmin(ctx, userID)
	if err != nil {
		return false
	}
	return isAdmin
}

// SetAdmin sets or clears administrator privileges for a user.
func (s *CredentialService) SetAdmin(ctx context.Context, userID string, isAdmin bool) error {
	return s.credRepo.SetAdmin(ctx, userID, isAdmin)
}

// MarkLogin records a login event for a user.
func (s *CredentialService) MarkLogin(ctx context.Context, userID string) error {
	return s.credRepo.MarkLogin(ctx, userID)
}

func (s *CredentialService) validatePassword(password string) error {
	const minPasswordLength = 8

	if len(password) < minPasswordLength {
		return errors.New("password too short")
	}

	var hasUpper, hasLower, hasDigit bool
	for _, c := range password {
		switch {
		case unicode.IsUpper(c):
			hasUpper = true
		case unicode.IsLower(c):
			hasLower = true
		case unicode.IsDigit(c):
			hasDigit = true
		}
	}

	if !hasUpper || !hasLower || !hasDigit {
		return errors.New("password must contain uppercase, lowercase, and digit")
	}

	return nil
}
