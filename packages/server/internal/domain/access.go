package domain

// AccessLevel describes the canonical account-level access state for SaaS users.
const (
	AccessLevelAdmin          = "admin"
	AccessLevelFoundingMember = "founding_member"
	AccessLevelBeta           = "beta"
	AccessLevelTrial          = "trial"
	AccessLevelSubscriber     = "subscriber"
	AccessLevelCollaborator   = "collaborator"
	AccessLevelNone           = "none"
)

// Space access reasons describe why a workspace is or is not currently usable.
const (
	SpaceAccessReasonActive                    = "active"
	SpaceAccessReasonOwnedSubscriptionRequired = "owned_subscription_required"
	SpaceAccessReasonSharedOwnerInactive       = "shared_owner_inactive"
)

// MaxOwnedCollaboratorSeats is the number of non-owner collaborator seats
// available across all workspaces owned by the same account.
const MaxOwnedCollaboratorSeats = 5
