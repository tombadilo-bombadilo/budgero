package analytics_test

import (
	"errors"
	"fmt"
	"sort"
	"testing"

	"budgero-server/internal/domain"
	"budgero-server/internal/domain/analytics"
)

func keys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// Every constructor must emit a registered name and only registered keys.
func TestEventsUseOnlyRegisteredProps(t *testing.T) {
	events := []analytics.Event{
		analytics.UserSignedUp(),
		analytics.SubscriptionStarted(analytics.PlanMonthly),
		analytics.SubscriptionRenewed(analytics.PlanYearly),
		analytics.SubscriptionCanceled(analytics.PlanUnknown),
		analytics.PushTokenCreated(),
		analytics.PushTokenRevoked(),
		analytics.PushQueued(),
		analytics.PushRejected(analytics.PushRejectDuplicate),
		analytics.WorkspaceCreated(analytics.BucketCount(1)),
		analytics.WorkspaceDeleted(analytics.BucketCount(3)),
		analytics.InviteCreated(analytics.InviteRoleMember),
		analytics.InviteRedeemed(),
		analytics.InviteRedeemFailed(analytics.InviteErrExpired),
		analytics.MemberRemoved(),
		analytics.MemberLeft(),
		analytics.BankRelayOK(analytics.BankProviderEnableBanking),
		analytics.BankRelayFailed(analytics.BankProviderEnableBanking, analytics.BankRelayErrThrottled),
	}
	seen := map[string]bool{}
	for _, ev := range events {
		allowed, ok := analytics.Registry[ev.Name()]
		if !ok {
			t.Fatalf("event %q is not registered", ev.Name())
		}
		seen[ev.Name()] = true
		set := map[string]bool{}
		for _, k := range allowed {
			set[k] = true
		}
		for k, v := range ev.Properties() {
			if !set[k] {
				t.Errorf("%s: property %q is not registered", ev.Name(), k)
			}
			if v == "" {
				t.Errorf("%s: property %q is empty", ev.Name(), k)
			}
		}
	}
	for name := range analytics.Registry {
		if !seen[name] {
			t.Errorf("registered event %q has no constructor under test", name)
		}
	}
	if got := keys(analytics.BankRelayFailed(analytics.BankProviderEnableBanking, analytics.BankRelayErrUpgradeFailed).Properties()); fmt.Sprint(got) != "[error_code outcome provider]" {
		t.Errorf("bank_relay_call keys = %v", got)
	}
	if (analytics.Event{}).Valid() {
		t.Error("zero event must be invalid")
	}
}

func TestBucketCount(t *testing.T) {
	cases := map[int]string{0: "0", 1: "1-10", 10: "1-10", 11: "10-100", 100: "10-100", 101: "100-1k", 1000: "100-1k", 1001: "1k-10k", 10000: "1k-10k", 10001: "10k+"}
	for n, want := range cases {
		got := analytics.WorkspaceCreated(analytics.BucketCount(n)).Properties()["members_bucket"]
		if got != want {
			t.Errorf("BucketCount(%d) = %q, want %q", n, got, want)
		}
	}
}

func TestInviteErrorFor(t *testing.T) {
	cases := []struct {
		err  error
		want string
	}{
		{domain.ErrInviteNotFound, "not_found"},
		{fmt.Errorf("wrapped: %w", domain.ErrInviteExpired), "expired"},
		{domain.ErrInviteAlreadyUsed, "already_used"},
		{domain.ErrInviteMissingBundle, "missing_bundle"},
		{domain.ErrSpaceMemberLimitReached, "seat_limit"},
		{domain.ErrCollaborationRestricted, "collaboration_restricted"},
		{errors.New("sqlite: disk I/O error on /data/x.db"), "unknown"},
	}
	for _, tc := range cases {
		got := analytics.InviteRedeemFailed(analytics.InviteErrorFor(tc.err)).Properties()["error_code"]
		if got != tc.want {
			t.Errorf("InviteErrorFor(%v) = %q, want %q", tc.err, got, tc.want)
		}
	}
}

func TestPlanFromInterval(t *testing.T) {
	for in, want := range map[string]analytics.Plan{"month": analytics.PlanMonthly, "year": analytics.PlanYearly, "week": analytics.PlanUnknown, "": analytics.PlanUnknown} {
		if got := analytics.PlanFromInterval(in); got != want {
			t.Errorf("PlanFromInterval(%q) = %v, want %v", in, got, want)
		}
	}
}
