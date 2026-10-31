package domain

import "time"

// Space represents a shared budget space.
type Space struct {
	SpaceID     string    `json:"space_id"`
	OwnerUserID string    `json:"owner_user_id"`
	DisplayName string    `json:"display_name"`
	CreatedAt   time.Time `json:"created_at"`
}

// SpaceBlob represents blob metadata for a space.
type SpaceBlob struct {
	SpaceID              string `json:"space_id"`
	BlobPath             string `json:"blob_path"`
	CurrentHash          string `json:"current_hash"`
	SyncVersion          int64  `json:"sync_version"`
	SizeBytes            int64  `json:"size_bytes"`
	EncryptionKeyVersion int64  `json:"encryption_key_version"`
	// MutationVersion is the mutation-log position the blob contents
	// correspond to (client cursor at upload time). 0 = unknown (legacy).
	MutationVersion int64 `json:"mutation_version"`
	// DataFormatVersion is the client data format of the blob contents
	// (2 = integer-milliunit money). Declared by clients on upload; the
	// server cannot inspect the encrypted blob itself.
	DataFormatVersion int64     `json:"data_format_version"`
	UpdatedAt         time.Time `json:"updated_at"`
	// Origin is how the current snapshot was published (SnapshotOrigin*).
	Origin string `json:"origin"`
	// PublishedAt is when the current snapshot was published. Snapshots
	// published before history existed report UpdatedAt.
	PublishedAt time.Time `json:"published_at"`
}

// SyncState represents the sync state of a space.
type SyncState struct {
	SpaceID              string `json:"space_id"`
	Version              int64  `json:"version"`
	Hash                 string `json:"hash"`
	EncryptionKeyVersion int64  `json:"encryption_key_version"`
	// Snapshot* describe the stored blob; SnapshotMutationVersion 0 = unknown (legacy).
	SnapshotMutationVersion   int64     `json:"snapshot_mutation_version"`
	SnapshotDataFormatVersion int64     `json:"snapshot_data_format_version"`
	SnapshotSizeBytes         int64     `json:"snapshot_size_bytes"`
	SnapshotUpdatedAt         time.Time `json:"snapshot_updated_at"`
}

// MutationLogEntry is one stored mutation; the payload stays end-to-end encrypted.
type MutationLogEntry struct {
	ID               string    `json:"id"`
	UserID           string    `json:"user_id"`
	Version          int64     `json:"version"`
	BaseVersion      int64     `json:"base_version"`
	Timestamp        time.Time `json:"timestamp"`
	EncryptedPayload string    `json:"encrypted_payload,omitempty"`
	// Op is set only for legacy unencrypted entries.
	Op string `json:"op,omitempty"`
}

// SpaceSummary represents a space with membership info.
type SpaceSummary struct {
	SpaceID           string     `json:"space_id"`
	DisplayName       string     `json:"display_name"`
	OwnerUserID       string     `json:"owner_user_id"`
	Role              string     `json:"role"`
	InvitationStatus  string     `json:"invitation_status"`
	EncryptedSpaceKey string     `json:"encrypted_space_key"`
	IsAccessible      bool       `json:"is_accessible"`
	AccessReason      string     `json:"access_reason,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         *time.Time `json:"updated_at,omitempty"`
}

// SpaceMember represents a member of a space.
type SpaceMember struct {
	SpaceID           string     `json:"space_id"`
	UserID            string     `json:"user_id"`
	UserName          string     `json:"user_name"`
	UserEmail         string     `json:"user_email"`
	Role              string     `json:"role"`
	EncryptedSpaceKey string     `json:"encrypted_space_key"`
	InvitationStatus  string     `json:"invitation_status"`
	InvitedAt         time.Time  `json:"invited_at"`
	AcceptedAt        *time.Time `json:"accepted_at,omitempty"`
}

// SpaceInvite represents an invitation to a space.
type SpaceInvite struct {
	ID               string     `json:"id"`
	SpaceID          string     `json:"space_id"`
	SpaceDisplayName string     `json:"space_display_name"`
	InviterUserID    string     `json:"inviter_user_id"`
	InviteeEmail     string     `json:"invitee_email,omitempty"`
	EncryptedBundle  string     `json:"encrypted_bundle,omitempty"`
	InviteSecret     string     `json:"-"` // Never expose in JSON
	Status           string     `json:"status"`
	ExpiresAt        *time.Time `json:"expires_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	RedeemedAt       *time.Time `json:"redeemed_at,omitempty"`
	RedeemedBy       *string    `json:"redeemed_by,omitempty"`
}

// SpaceRole constants.
const (
	RoleOwner  = "owner"
	RoleMember = "member"
)

// InvitationStatus constants.
const (
	InvitationPending  = "pending"
	InvitationAccepted = "accepted"
)

// IsExpired returns true if the invite has passed its expiration date.
func (i *SpaceInvite) IsExpired() bool {
	if i == nil || i.ExpiresAt == nil {
		return false
	}
	return time.Now().After(*i.ExpiresAt)
}

// IsRedeemed returns true if the invite has already been used.
func (i *SpaceInvite) IsRedeemed() bool {
	if i == nil {
		return false
	}
	return i.RedeemedAt != nil
}

// CanBeRedeemed checks if the invite can be redeemed and returns an error if not.
func (i *SpaceInvite) CanBeRedeemed() error {
	if i == nil {
		return ErrInviteNotFound
	}
	if i.IsExpired() {
		return ErrInviteExpired
	}
	if i.IsRedeemed() {
		return ErrInviteAlreadyUsed
	}
	return nil
}
