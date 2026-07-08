// Package domain contains core business entities and errors.
// Domain types have no external dependencies (no sql.*, no db.* types).
package domain

import "errors"

// Domain errors - these are the core business errors that can occur.
var (
	// User errors
	ErrUserNotFound           = errors.New("user not found")
	ErrEmailAlreadyExists     = errors.New("email already exists")
	ErrUserBlocked            = errors.New("user is blocked")
	ErrInvalidUserPreferences = errors.New("invalid user preferences")

	// Authentication errors
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrCredentialNotFound = errors.New("credential not found")
	ErrCredentialExists   = errors.New("credential already exists")

	// Space errors
	ErrSpaceNotFound           = errors.New("space not found")
	ErrSpaceAccessDenied       = errors.New("space access denied")
	ErrSpaceMemberLimitReached = errors.New("space member limit reached")
	ErrSpaceDeleteFailed       = errors.New("space delete failed")

	// Collaboration errors
	ErrCollaborationRestricted = errors.New("collaboration restricted")

	// Invite errors
	ErrInviteNotFound      = errors.New("invite not found")
	ErrInviteExpired       = errors.New("invite expired")
	ErrInviteMissingBundle = errors.New("invite missing bundle")
	ErrInviteAlreadyUsed   = errors.New("invite already used")

	// Push errors
	ErrPushTokenNotFound = errors.New("push token not found")
	ErrPushTokenInvalid  = errors.New("push token invalid")

	// Sync errors
	ErrSyncVersionConflict = errors.New("sync version conflict")
)
