package handler_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"budgero-server/internal/adapter/driving/http/handler"
	"budgero-server/internal/domain/analytics"
	"budgero-server/internal/testkit"

	"github.com/labstack/echo/v4"
)

type trackedEvent struct {
	userID string
	event  analytics.Event
}

// recordingTracker is a driving.AnalyticsTracker that keeps events in memory.
type recordingTracker struct {
	mu     sync.Mutex
	events []trackedEvent
}

func (r *recordingTracker) Enabled() bool { return true }

func (r *recordingTracker) Track(userID string, event analytics.Event) {
	r.mu.Lock()
	r.events = append(r.events, trackedEvent{userID: userID, event: event})
	r.mu.Unlock()
}

func (r *recordingTracker) SetOptOut(string, bool) {}

func (r *recordingTracker) names() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, 0, len(r.events))
	for _, e := range r.events {
		out = append(out, e.event.Name())
	}
	return out
}

func (r *recordingTracker) last(t *testing.T) trackedEvent {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.events) == 0 {
		t.Fatal("no analytics event recorded")
	}
	return r.events[len(r.events)-1]
}

func setupTrackedHandler(t *testing.T) (*handler.Handlers, *echo.Echo, *testkit.TestContext, *recordingTracker) {
	t.Helper()
	sqlDB, queries, services, cfg := testkit.NewTestServices(t, false)
	cfg.LemonSqueezy.WebhookSecret = testWebhookSecret
	rec := &recordingTracker{}
	services.Analytics = rec
	h := handler.NewHandlers(services, nil, handler.Options{Config: cfg})
	return h, echo.New(), &testkit.TestContext{DB: sqlDB, Queries: queries}, rec
}

func TestAnalytics_SubscriptionWebhooks(t *testing.T) {
	h, e, tc, rec := setupTrackedHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "sub@example.com")

	created := `{"meta":{"event_name":"subscription_created","custom_data":{"user_id":"` + userID + `"}},` +
		`"data":{"id":"sub_1","type":"subscriptions","attributes":{"status":"active","customer_id":1,"variant_id":9,` +
		`"variant_name":"Yearly","user_email":"sub@example.com","renews_at":"2030-01-01T00:00:00Z"}}}`
	if r, err := deliverWebhook(h, e, created, signWebhook(created)); err != nil || r.Code != http.StatusOK {
		t.Fatalf("created: err=%v code=%d", err, r.Code)
	}
	got := rec.last(t)
	if got.userID != userID || got.event.Name() != "subscription_started" || got.event.Properties()["plan"] != "yearly" || len(got.event.Properties()) != 1 {
		t.Fatalf("got %s %v for %s", got.event.Name(), got.event.Properties(), got.userID)
	}

	canceled := `{"meta":{"event_name":"subscription_cancelled","custom_data":{"user_id":"` + userID + `"}},` +
		`"data":{"id":"sub_1","type":"subscriptions","attributes":{"status":"cancelled","variant_id":9,"variant_name":"Monthly"}}}`
	if r, err := deliverWebhook(h, e, canceled, signWebhook(canceled)); err != nil || r.Code != http.StatusOK {
		t.Fatalf("cancelled: err=%v code=%d", err, r.Code)
	}
	if got := rec.last(t); got.event.Name() != "subscription_canceled" || got.event.Properties()["plan"] != "monthly" {
		t.Fatalf("got %s %v", got.event.Name(), got.event.Properties())
	}

	renewal := `{"meta":{"event_name":"subscription_payment_success","custom_data":{"user_id":"` + userID + `"}},` +
		`"data":{"id":"inv_1","type":"subscription-invoices","attributes":{"billing_reason":"renewal","status":"paid"}}}`
	if r, err := deliverWebhook(h, e, renewal, signWebhook(renewal)); err != nil || r.Code != http.StatusOK {
		t.Fatalf("renewal: err=%v code=%d", err, r.Code)
	}
	if got := rec.last(t); got.event.Name() != "subscription_renewed" {
		t.Fatalf("got %s", got.event.Name())
	}

	before := len(rec.names())
	initial := strings.Replace(renewal, `"renewal"`, `"initial"`, 1)
	testMode := strings.Replace(created, `"meta":{`, `"meta":{"test_mode":true,`, 1)
	for _, body := range []string{initial, testMode} {
		if r, err := deliverWebhook(h, e, body, signWebhook(body)); err != nil || r.Code != http.StatusOK {
			t.Fatalf("err=%v code=%d", err, r.Code)
		}
	}
	if after := len(rec.names()); after != before {
		t.Fatalf("initial payments and test-mode events must not be tracked: %v", rec.names()[before:])
	}
}

func TestAnalytics_PushReceived(t *testing.T) {
	h, e, tc, rec := setupTrackedHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "push@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Push")
	token := testkit.SeedPushTokenWithPlaintext(t, tc.Queries, userID, spaceID)

	push := func(body string) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/push", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		_ = h.PushMutation(e.NewContext(req, httptest.NewRecorder()))
	}

	push(`{"encrypted_payload":"abc","message_id":"m1"}`)
	if got := rec.last(t); got.event.Name() != "push_received" || got.event.Properties()["outcome"] != "queued" || got.userID != userID {
		t.Fatalf("got %s %v", got.event.Name(), got.event.Properties())
	}
	push(`{"encrypted_payload":"abc","message_id":"m1"}`)
	if p := rec.last(t).event.Properties(); p["outcome"] != "rejected" || p["error_code"] != "duplicate" {
		t.Fatalf("duplicate: %v", p)
	}
	push(`{"message_id":"m2"}`)
	if p := rec.last(t).event.Properties(); p["error_code"] != "invalid_payload" {
		t.Fatalf("missing payload: %v", p)
	}
}

func TestAnalytics_InviteRedeemFailureUsesErrorCode(t *testing.T) {
	h, e, tc, rec := setupTrackedHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "joiner@example.com")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/budget-space-invites/redeem",
		strings.NewReader(`{"invite_secret":"does-not-exist","encrypted_space_key":"k"}`))
	req.Header.Set("Content-Type", "application/json")
	c := e.NewContext(req, httptest.NewRecorder())
	setUserContext(c, userID)
	_ = h.RedeemInvite(c)

	got := rec.last(t)
	if got.event.Name() != "invite_redeemed" || got.event.Properties()["outcome"] != "error" || got.event.Properties()["error_code"] != "not_found" {
		t.Fatalf("got %s %v", got.event.Name(), got.event.Properties())
	}
}

func TestAnalytics_WorkspaceLifecycle(t *testing.T) {
	h, e, tc, rec := setupTrackedHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "owner@example.com")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/budget-spaces", strings.NewReader(`{"display_name":"Home"}`))
	req.Header.Set("Content-Type", "application/json")
	c := e.NewContext(req, httptest.NewRecorder())
	setUserContext(c, userID)
	if err := h.CreateBudgetSpace(c); err != nil {
		t.Fatalf("CreateBudgetSpace: %v", err)
	}
	if got := rec.last(t); got.event.Name() != "workspace_created" || got.event.Properties()["members_bucket"] != "1-10" {
		t.Fatalf("got %s %v", got.event.Name(), got.event.Properties())
	}

	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Second")
	req = httptest.NewRequest(http.MethodDelete, "/api/v1/budget-spaces/"+spaceID, http.NoBody)
	c = e.NewContext(req, httptest.NewRecorder())
	c.SetParamNames("spaceID")
	c.SetParamValues(spaceID)
	setUserContext(c, userID)
	if err := h.DeleteBudgetSpace(c); err != nil {
		t.Fatalf("DeleteBudgetSpace: %v", err)
	}
	if got := rec.last(t); got.event.Name() != "workspace_deleted" || got.event.Properties()["members_bucket"] != "1-10" {
		t.Fatalf("got %s %v", got.event.Name(), got.event.Properties())
	}
}
