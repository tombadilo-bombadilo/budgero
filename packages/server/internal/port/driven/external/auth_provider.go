// Package external defines interfaces for external service integrations.
// These are "driven" or "secondary" ports for external APIs.
package external

import "context"

// AuthUser represents user information from an authentication provider.
type AuthUser struct {
	ID        string
	Email     string
	FirstName string
	LastName  string
	FullName  string
	Username  string
}

// AuthProvider defines methods for external authentication providers (e.g., Clerk).
type AuthProvider interface {
	// FetchUser fetches user information from the auth provider.
	FetchUser(ctx context.Context, providerUserID string) (*AuthUser, error)

	// UpdateProfile updates the user's name in the auth provider.
	UpdateProfile(ctx context.Context, providerUserID, fullName string) error
}
