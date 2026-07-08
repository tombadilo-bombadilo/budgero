// Package clerk provides an implementation of the AuthProvider port using Clerk.
package clerk

import (
	"context"
	"strings"

	"budgero-server/internal/config"
	"budgero-server/internal/port/driven/external"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/clerk/clerk-sdk-go/v2/user"
)

// AuthProvider implements external.AuthProvider using Clerk.
type AuthProvider struct {
	cfg *config.Config
}

// NewAuthProvider creates a new Clerk AuthProvider.
func NewAuthProvider(cfg *config.Config) *AuthProvider {
	if cfg != nil && cfg.Auth.ClerkSecretKey != "" {
		clerk.SetKey(cfg.Auth.ClerkSecretKey)
	}
	return &AuthProvider{cfg: cfg}
}

var _ external.AuthProvider = (*AuthProvider)(nil)

// FetchUser retrieves user information from Clerk by provider user ID.
func (p *AuthProvider) FetchUser(ctx context.Context, providerUserID string) (*external.AuthUser, error) {
	cu, err := user.Get(ctx, providerUserID)
	if err != nil {
		return nil, err
	}

	return p.normalizeClerkUser(cu, providerUserID), nil
}

// UpdateProfile updates the user's profile name in Clerk.
func (p *AuthProvider) UpdateProfile(ctx context.Context, providerUserID, fullName string) error {
	firstName, lastName := splitFullName(fullName)
	_, err := user.Update(ctx, providerUserID, &user.UpdateParams{
		FirstName: clerk.String(firstName),
		LastName:  clerk.String(lastName),
	})
	return err
}

func (p *AuthProvider) normalizeClerkUser(cu *clerk.User, fallbackID string) *external.AuthUser {
	result := &external.AuthUser{
		ID:       fallbackID,
		Email:    fallbackID + "@clerk.user",
		FullName: "User",
	}

	if cu == nil {
		return result
	}

	result.ID = cu.ID

	// Extract email
	if len(cu.EmailAddresses) > 0 {
		// Prefer primary email
		for _, ea := range cu.EmailAddresses {
			if cu.PrimaryEmailAddressID != nil && ea.ID == *cu.PrimaryEmailAddressID {
				result.Email = ea.EmailAddress
				break
			}
		}
		if result.Email == fallbackID+"@clerk.user" {
			result.Email = cu.EmailAddresses[0].EmailAddress
		}
	}

	// Extract name
	if cu.FirstName != nil {
		result.FirstName = *cu.FirstName
	}
	if cu.LastName != nil {
		result.LastName = *cu.LastName
	}
	if cu.Username != nil {
		result.Username = *cu.Username
	}

	// Build full name
	switch {
	case result.FirstName != "" && result.LastName != "":
		result.FullName = result.FirstName + " " + result.LastName
	case result.FirstName != "":
		result.FullName = result.FirstName
	case result.Username != "":
		result.FullName = result.Username
	}

	return result
}

func splitFullName(fullName string) (firstName, lastName string) {
	parts := strings.Fields(fullName)
	if len(parts) == 0 {
		return "User", ""
	}
	if len(parts) == 1 {
		return parts[0], ""
	}
	return parts[0], strings.Join(parts[1:], " ")
}
