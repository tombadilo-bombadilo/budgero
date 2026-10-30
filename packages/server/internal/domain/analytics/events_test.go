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
		analytics.ServerException{Type: "*sqlite.Error", Code: analytics.ErrCodeDBLocked, Route: "/api/v1/sync", Method: "POST", Status: 500, RequestID: "req-1", ServerVersion: "1.2.3"}.Event(),
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

func TestServerExceptionEvent(t *testing.T) {
	exc := analytics.ServerException{
		Type:      "*fs.PathError",
		Code:      analytics.ErrCodeStorage,
		Mechanism: analytics.MechanismHTTP5xx,
		Route:     "/api/v1/sync/blob",
		Method:    "PUT",
		Status:    500,
		RequestID: "abc123",
		Frames: []analytics.Frame{
			{Filename: "internal/adapter/driving/http/handler/sync.go", Function: "handler.(*Handlers).Upload", Line: 42},
		},
	}
	ev := exc.Event()
	if ev.Name() != "$exception" {
		t.Fatalf("name = %q", ev.Name())
	}
	props := ev.Properties()
	if props["error_code"] != "storage_error" || props["status"] != "500" || props["route"] != "/api/v1/sync/blob" || props["request_id"] != "abc123" {
		t.Errorf("props = %v", props)
	}
	if _, ok := props["server_version"]; ok {
		t.Error("empty server_version must be omitted")
	}
	list, ok := ev.Payload()["$exception_list"].([]map[string]any)
	if !ok || len(list) != 1 {
		t.Fatalf("$exception_list = %#v", ev.Payload()["$exception_list"])
	}
	if list[0]["type"] != "*fs.PathError" || list[0]["value"] != "*fs.PathError · storage_error · /api/v1/sync/blob" {
		t.Errorf("exception = %v", list[0])
	}
	mech, _ := list[0]["mechanism"].(map[string]any)
	if mech["type"] != "http_5xx" || mech["handled"] != false {
		t.Errorf("mechanism = %v", mech)
	}
	st, _ := list[0]["stacktrace"].(map[string]any)
	frames, _ := st["frames"].([]map[string]any)
	if st["type"] != "raw" || len(frames) != 1 || frames[0]["filename"] != "internal/adapter/driving/http/handler/sync.go" || frames[0]["lineno"] != 42 || frames[0]["in_app"] != true {
		t.Errorf("stacktrace = %v", st)
	}

	// Defaults: unknown type, code, mechanism and route all fall back to fixed values.
	ev = analytics.ServerException{Status: 503}.Event()
	props = ev.Properties()
	if props["error_code"] != "internal" || props["route"] != "unmatched" {
		t.Errorf("default props = %v", props)
	}
	if _, ok := props["method"]; ok {
		t.Error("empty method must be omitted")
	}
	if analytics.UserSignedUp().Payload() != nil {
		t.Error("plain events have no payload")
	}
}
