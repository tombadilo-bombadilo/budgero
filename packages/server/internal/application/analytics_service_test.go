package application_test

import (
	"context"
	"sort"
	"strings"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/fake"
	"budgero-server/internal/application"
	"budgero-server/internal/config"
	"budgero-server/internal/domain"
	"budgero-server/internal/domain/analytics"
)

func seedAnalyticsUser(t *testing.T, repo *fake.UserRepository, id string, disabled bool) {
	t.Helper()
	if _, err := repo.Create(context.Background(), &domain.User{ID: id, Email: id + "@example.com", IsAnalyticsDisabled: disabled}); err != nil {
		t.Fatalf("seed user: %v", err)
	}
}

func sortedKeys(m map[string]string) string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return strings.Join(out, ",")
}

func TestAnalytics_EventsCarryOnlyAllowedProps(t *testing.T) {
	users := fake.NewUserRepository()
	seedAnalyticsUser(t, users, "u1", false)
	sender := &fake.AnalyticsSender{}
	svc := application.NewAnalyticsService(sender, users, application.AnalyticsOptions{})

	svc.Track("u1", analytics.SubscriptionStarted(analytics.PlanYearly))
	svc.Track("u1", analytics.InviteRedeemFailed(analytics.InviteErrExpired))
	svc.Track("u1", analytics.MemberLeft())
	svc.Track("", analytics.MemberLeft()) // no user: dropped
	svc.Track("u1", analytics.Event{})    // invalid: dropped
	svc.Close()

	got := sender.Events()
	if len(got) != 3 {
		t.Fatalf("sent %d events, want 3: %+v", len(got), got)
	}
	want := []struct{ name, keys string }{
		{"subscription_started", "plan"},
		{"invite_redeemed", "error_code,outcome"},
		{"member_left", ""},
	}
	for i, w := range want {
		ev := got[i]
		if ev.Name != w.name || ev.DistinctID != "u1" || sortedKeys(ev.Properties) != w.keys {
			t.Errorf("event %d = %s %s {%s}, want %s u1 {%s}", i, ev.Name, ev.DistinctID, sortedKeys(ev.Properties), w.name, w.keys)
		}
		if ev.Timestamp.IsZero() {
			t.Errorf("event %d has no timestamp", i)
		}
	}
	if got[0].Properties["plan"] != "yearly" || got[1].Properties["error_code"] != "expired" {
		t.Errorf("unexpected values: %+v %+v", got[0].Properties, got[1].Properties)
	}
	if sender.Batches() != 1 {
		t.Errorf("batches = %d, want 1 (events are batched)", sender.Batches())
	}
}

func TestAnalytics_OptOutSuppressesEvents(t *testing.T) {
	ctx := context.Background()
	users := fake.NewUserRepository()
	seedAnalyticsUser(t, users, "opted-out", true)
	seedAnalyticsUser(t, users, "toggles", false)
	seedAnalyticsUser(t, users, "kept", false)
	sender := &fake.AnalyticsSender{}
	svc := application.NewAnalyticsService(sender, users, application.AnalyticsOptions{})

	userSvc := application.NewUserService(users, fake.NewSpaceRepository(), &config.Config{})
	userSvc.SetAnalytics(svc)
	// Opting out through the user service updates the tracker cache too.
	if err := userSvc.SetAnalyticsDisabled(ctx, "toggles", true); err != nil {
		t.Fatalf("SetAnalyticsDisabled: %v", err)
	}

	svc.Track("opted-out", analytics.PushTokenCreated())
	svc.Track("toggles", analytics.PushTokenCreated())
	svc.Track("kept", analytics.PushTokenCreated())
	svc.Track("ghost", analytics.PushTokenCreated()) // unknown user: dropped
	svc.Close()

	got := sender.Events()
	if len(got) != 1 || got[0].DistinctID != "kept" {
		t.Fatalf("sent %+v, want only the kept user's event", got)
	}
}

func TestAnalytics_UserCreateFiresSignup(t *testing.T) {
	users := fake.NewUserRepository()
	sender := &fake.AnalyticsSender{}
	svc := application.NewAnalyticsService(sender, users, application.AnalyticsOptions{})
	userSvc := application.NewUserService(users, fake.NewSpaceRepository(), &config.Config{})
	userSvc.SetAnalytics(svc)

	if _, err := userSvc.Create(context.Background(), "new-user", "New", "new@example.com"); err != nil {
		t.Fatalf("Create: %v", err)
	}
	svc.Close()

	got := sender.Events()
	if len(got) != 1 || got[0].Name != "user_signed_up" || got[0].DistinctID != "new-user" || len(got[0].Properties) != 0 {
		t.Fatalf("sent %+v, want one bare user_signed_up", got)
	}
}

func TestAnalytics_DisabledSenderSendsNothing(t *testing.T) {
	users := fake.NewUserRepository()
	seedAnalyticsUser(t, users, "u1", false)
	sender := &fake.AnalyticsSender{Disabled: true}
	svc := application.NewAnalyticsService(sender, users, application.AnalyticsOptions{})
	if svc.Enabled() {
		t.Fatal("tracker must be disabled when the sender is")
	}
	svc.Track("u1", analytics.UserSignedUp())
	svc.Close()
	if sender.Batches() != 0 {
		t.Fatalf("disabled tracker sent %d batches", sender.Batches())
	}

	nilSvc := application.NewAnalyticsService(nil, users, application.AnalyticsOptions{})
	if nilSvc.Enabled() {
		t.Fatal("nil sender must disable the tracker")
	}
	nilSvc.Track("u1", analytics.UserSignedUp())
	nilSvc.Close()
}

func TestAnalytics_FullQueueDropsWithoutBlocking(t *testing.T) {
	users := fake.NewUserRepository()
	seedAnalyticsUser(t, users, "u1", false)
	gate := make(chan struct{})
	sender := &fake.AnalyticsSender{Gate: gate}
	svc := application.NewAnalyticsService(sender, users, application.AnalyticsOptions{
		QueueSize: 2, BatchSize: 1, SendTimeout: 5 * time.Second,
	})

	const n = 500
	start := time.Now()
	for range n {
		svc.Track("u1", analytics.PushQueued())
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("Track blocked: %d calls took %v", n, elapsed)
	}
	// At most one event is in flight in the stuck sender and two sit in the queue.
	if dropped := svc.Dropped(); dropped < n-3 {
		t.Fatalf("dropped = %d, want >= %d", dropped, n-3)
	}
	close(gate)
	svc.Close()
	if sent := len(sender.Events()); int64(sent)+svc.Dropped() != n {
		t.Fatalf("sent %d + dropped %d != %d", sent, svc.Dropped(), n)
	}
}
