// Package analytics is the typed registry of server-side product analytics
// events. Every event and every property value is built here from fixed
// enums or buckets, so callers cannot attach free text, names, amounts,
// dates or IDs: the enum types have unexported fields and can only be
// obtained through the values declared in this package.
package analytics

import (
	"errors"

	"budgero-server/internal/domain"
)

// Event is one product analytics event: a registered name plus enum-only
// properties. The zero value is not a valid event.
type Event struct {
	name  string
	props map[string]string
}

// Name returns the event name.
func (e Event) Name() string { return e.name }

// Properties returns a copy of the event properties.
func (e Event) Properties() map[string]string {
	out := make(map[string]string, len(e.props))
	for k, v := range e.props {
		out[k] = v
	}
	return out
}

// Valid reports whether the event was built by a constructor in this package.
func (e Event) Valid() bool { return e.name != "" }

// Registry maps every event name to the exact property keys it may carry.
// Tests assert each constructor matches it; the HTTP adapter adds only
// distinct_id and PostHog's own $lib / $geoip_disable.
var Registry = map[string][]string{
	"user_signed_up":        {},
	"subscription_started":  {"plan"},
	"subscription_renewed":  {"plan"},
	"subscription_canceled": {"plan"},
	"push_token_created":    {},
	"push_token_revoked":    {},
	"push_received":         {"outcome", "error_code"},
	"workspace_created":     {"members_bucket"},
	"workspace_deleted":     {"members_bucket"},
	"invite_created":        {"role"},
	"invite_redeemed":       {"outcome", "error_code"},
	"member_removed":        {},
	"member_left":           {},
	"bank_relay_call":       {"provider", "outcome", "error_code"},
}

func newEvent(name string, props map[string]string) Event {
	if props == nil {
		props = map[string]string{}
	}
	return Event{name: name, props: props}
}

// Outcome is the result of an operation.
type Outcome struct{ v string }

// Outcome values.
var (
	OutcomeOK    = Outcome{"ok"}
	OutcomeError = Outcome{"error"}
)

// Plan is the billing interval of a subscription.
type Plan struct{ v string }

// Plan values. PlanUnknown covers variants whose interval isn't known yet
// (product cache cold).
var (
	PlanMonthly = Plan{"monthly"}
	PlanYearly  = Plan{"yearly"}
	PlanUnknown = Plan{"unknown"}
)

// PlanFromInterval maps a payment provider interval ("month", "year") to a Plan.
func PlanFromInterval(interval string) Plan {
	switch interval {
	case "month", "monthly":
		return PlanMonthly
	case "year", "yearly", "annual":
		return PlanYearly
	}
	return PlanUnknown
}

// UserSignedUp fires when a local user row is first created.
func UserSignedUp() Event { return newEvent("user_signed_up", nil) }

// SubscriptionStarted fires on the LemonSqueezy subscription_created webhook.
func SubscriptionStarted(p Plan) Event {
	return newEvent("subscription_started", map[string]string{"plan": p.v})
}

// SubscriptionRenewed fires on a renewal payment (subscription_payment_success, billing_reason=renewal).
func SubscriptionRenewed(p Plan) Event {
	return newEvent("subscription_renewed", map[string]string{"plan": p.v})
}

// SubscriptionCanceled fires on the subscription_cancelled webhook.
func SubscriptionCanceled(p Plan) Event {
	return newEvent("subscription_canceled", map[string]string{"plan": p.v})
}

// PushTokenCreated fires when a push API token is generated or regenerated.
func PushTokenCreated() Event { return newEvent("push_token_created", nil) }

// PushTokenRevoked fires when a push API token is deleted.
func PushTokenRevoked() Event { return newEvent("push_token_revoked", nil) }

// PushRejectCode says why an authenticated push was rejected. Pushes with a
// missing or invalid token have no user to attribute and are not tracked.
type PushRejectCode struct{ v string }

// PushRejectCode values.
var (
	PushRejectBlocked        = PushRejectCode{"blocked"}
	PushRejectInvalidPayload = PushRejectCode{"invalid_payload"}
	PushRejectDuplicate      = PushRejectCode{"duplicate"}
	PushRejectInternal       = PushRejectCode{"internal"}
)

// PushQueued fires when the push API queues a mutation.
func PushQueued() Event {
	return newEvent("push_received", map[string]string{"outcome": "queued"})
}

// PushRejected fires when the push API refuses a mutation from a valid token.
func PushRejected(code PushRejectCode) Event {
	return newEvent("push_received", map[string]string{"outcome": "rejected", "error_code": code.v})
}

// CountBucket is a coarse count bucket.
type CountBucket struct{ v string }

// BucketCount maps n to 0 | 1-10 | 10-100 | 100-1k | 1k-10k | 10k+.
func BucketCount(n int) CountBucket {
	switch {
	case n <= 0:
		return CountBucket{"0"}
	case n <= 10:
		return CountBucket{"1-10"}
	case n <= 100:
		return CountBucket{"10-100"}
	case n <= 1000:
		return CountBucket{"100-1k"}
	case n <= 10000:
		return CountBucket{"1k-10k"}
	}
	return CountBucket{"10k+"}
}

// WorkspaceCreated fires when a user creates a workspace.
func WorkspaceCreated(members CountBucket) Event {
	return newEvent("workspace_created", map[string]string{"members_bucket": members.v})
}

// WorkspaceDeleted fires when an owner deletes a workspace.
func WorkspaceDeleted(members CountBucket) Event {
	return newEvent("workspace_deleted", map[string]string{"members_bucket": members.v})
}

// InviteRole is the role an invite grants.
type InviteRole struct{ v string }

// InviteRoleMember is the only role invites grant today.
var InviteRoleMember = InviteRole{"member"}

// InviteCreated fires when an owner creates an invite.
func InviteCreated(role InviteRole) Event {
	return newEvent("invite_created", map[string]string{"role": role.v})
}

// InviteErrorCode says why redeeming an invite failed.
type InviteErrorCode struct{ v string }

// InviteErrorCode values.
var (
	InviteErrNotFound                = InviteErrorCode{"not_found"}
	InviteErrExpired                 = InviteErrorCode{"expired"}
	InviteErrAlreadyUsed             = InviteErrorCode{"already_used"}
	InviteErrMissingBundle           = InviteErrorCode{"missing_bundle"}
	InviteErrSeatLimit               = InviteErrorCode{"seat_limit"}
	InviteErrCollaborationRestricted = InviteErrorCode{"collaboration_restricted"}
	InviteErrUnknown                 = InviteErrorCode{"unknown"}
)

// InviteRedeemed fires when a user joins a workspace through an invite.
func InviteRedeemed() Event {
	return newEvent("invite_redeemed", map[string]string{"outcome": OutcomeOK.v})
}

// InviteRedeemFailed fires when redeeming an invite fails.
func InviteRedeemFailed(code InviteErrorCode) Event {
	return newEvent("invite_redeemed", map[string]string{"outcome": OutcomeError.v, "error_code": code.v})
}

// MemberRemoved fires when an owner removes another member.
func MemberRemoved() Event { return newEvent("member_removed", nil) }

// MemberLeft fires when a member leaves a workspace.
func MemberLeft() Event { return newEvent("member_left", nil) }

// BankProvider is a bank data provider.
type BankProvider struct{ v string }

// BankProviderEnableBanking is the only provider routed through the server
// relay (SimpleFIN is called from the client directly).
var BankProviderEnableBanking = BankProvider{"enablebanking"}

// BankRelayErrorCode says why a bank relay session failed.
type BankRelayErrorCode struct{ v string }

// BankRelayErrorCode values.
var (
	BankRelayErrThrottled     = BankRelayErrorCode{"throttled"}
	BankRelayErrUpgradeFailed = BankRelayErrorCode{"upgrade_failed"}
)

// BankRelayOK fires when a bank relay session ends normally.
func BankRelayOK(p BankProvider) Event {
	return newEvent("bank_relay_call", map[string]string{"provider": p.v, "outcome": OutcomeOK.v})
}

// BankRelayFailed fires when a bank relay session could not be opened.
func BankRelayFailed(p BankProvider, code BankRelayErrorCode) Event {
	return newEvent("bank_relay_call", map[string]string{"provider": p.v, "outcome": OutcomeError.v, "error_code": code.v})
}

// InviteErrorFor maps a redeem error to its code; unknown errors map to InviteErrUnknown.
func InviteErrorFor(err error) InviteErrorCode {
	switch {
	case errors.Is(err, domain.ErrInviteNotFound):
		return InviteErrNotFound
	case errors.Is(err, domain.ErrInviteExpired):
		return InviteErrExpired
	case errors.Is(err, domain.ErrInviteAlreadyUsed):
		return InviteErrAlreadyUsed
	case errors.Is(err, domain.ErrInviteMissingBundle):
		return InviteErrMissingBundle
	case errors.Is(err, domain.ErrSpaceMemberLimitReached):
		return InviteErrSeatLimit
	case errors.Is(err, domain.ErrCollaborationRestricted):
		return InviteErrCollaborationRestricted
	}
	return InviteErrUnknown
}
