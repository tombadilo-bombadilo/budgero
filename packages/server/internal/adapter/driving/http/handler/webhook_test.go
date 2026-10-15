package handler_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/adapter/driving/http/handler"
	"budgero-server/internal/testkit"

	"github.com/labstack/echo/v4"
)

const testWebhookSecret = "webhook-test-secret" //nolint:gosec // G101: test-only HMAC key

func setupWebhookHandler(t *testing.T) (*handler.Handlers, *echo.Echo, *testkit.TestContext) {
	t.Helper()
	sqlDB, queries, services, cfg := testkit.NewTestServices(t, false)
	cfg.LemonSqueezy.WebhookSecret = testWebhookSecret
	h := handler.NewHandlers(services, nil, handler.Options{Config: cfg})
	return h, echo.New(), &testkit.TestContext{DB: sqlDB, Queries: queries}
}

func signWebhook(body string) string {
	mac := hmac.New(sha256.New, []byte(testWebhookSecret))
	mac.Write([]byte(body))
	return hex.EncodeToString(mac.Sum(nil))
}

func deliverWebhook(h *handler.Handlers, e *echo.Echo, body, signature string) (*httptest.ResponseRecorder, error) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/lemonsqueezy", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Signature", signature)
	rec := httptest.NewRecorder()
	return rec, h.HandleLemonSqueezyWebhook(e.NewContext(req, rec))
}

type webhookUserState struct {
	status         sql.NullString
	subscriptionID sql.NullString
	subscribedAt   sql.NullTime
}

func readWebhookUserState(t *testing.T, db *sql.DB, userID string) webhookUserState {
	t.Helper()
	var s webhookUserState
	if err := db.QueryRowContext(context.Background(),
		"SELECT subscription_status, subscription_id, subscribed_at FROM users WHERE id = ?", userID,
	).Scan(&s.status, &s.subscriptionID, &s.subscribedAt); err != nil {
		t.Fatalf("read user state: %v", err)
	}
	return s
}

func TestLemonSqueezyWebhook_FailureReturns5xxAndRetryAppliesOnce(t *testing.T) {
	h, e, tc := setupWebhookHandler(t)

	const userID = "user-created-after-checkout"
	body := `{"meta":{"event_name":"subscription_created","custom_data":{"user_id":"` + userID + `"}},` +
		`"data":{"id":"sub_123","type":"subscriptions","attributes":{"status":"active","customer_id":42,"variant_id":7,` +
		`"renews_at":"2030-01-01T00:00:00Z"}}}`
	sig := signWebhook(body)

	// The user row doesn't exist yet, so the event can't be applied. It must
	// not be acknowledged, or LemonSqueezy never redelivers it.
	_, err := deliverWebhook(h, e, body, sig)
	requireHTTPStatus(t, err, http.StatusInternalServerError)

	if _, err = tc.Queries.CreateUser(context.Background(), sqlc.CreateUserParams{
		ID:                 userID,
		Name:               "Late User",
		Email:              "late@example.com",
		SubscriptionStatus: sql.NullString{String: "trialing", Valid: true},
		CreatedAt:          sql.NullTime{Time: time.Now(), Valid: true},
	}); err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	// LemonSqueezy's retry now succeeds and grants access.
	rec, err := deliverWebhook(h, e, body, sig)
	if err != nil || rec.Code != http.StatusOK {
		t.Fatalf("retry: err=%v status=%d", err, rec.Code)
	}
	first := readWebhookUserState(t, tc.DB, userID)
	if first.status.String != "active" || first.subscriptionID.String != "sub_123" || !first.subscribedAt.Valid {
		t.Fatalf("after retry: status=%q sub=%q subscribed_at valid=%v", first.status.String, first.subscriptionID.String, first.subscribedAt.Valid)
	}

	// A duplicate delivery of the same signed event is acknowledged and
	// changes nothing (first-conversion timestamp is not bumped).
	time.Sleep(10 * time.Millisecond)
	rec, err = deliverWebhook(h, e, body, sig)
	if err != nil || rec.Code != http.StatusOK {
		t.Fatalf("duplicate: err=%v status=%d", err, rec.Code)
	}
	second := readWebhookUserState(t, tc.DB, userID)
	if second.status != first.status || second.subscriptionID != first.subscriptionID ||
		!second.subscribedAt.Time.Equal(first.subscribedAt.Time) {
		t.Fatalf("duplicate delivery changed state: before=%+v after=%+v", first, second)
	}
}

func TestLemonSqueezyWebhook_IgnoredEventsStill2xx(t *testing.T) {
	h, e, tc := setupWebhookHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "webhook-ignored@example.com")

	body := `{"meta":{"event_name":"license_key_created","custom_data":{"user_id":"` + userID + `"}},"data":{"id":"lk_1"}}`
	rec, err := deliverWebhook(h, e, body, signWebhook(body))
	if err != nil || rec.Code != http.StatusOK {
		t.Fatalf("unknown event: err=%v status=%d", err, rec.Code)
	}
}

func TestLemonSqueezyWebhook_RejectsBadSignatureAndOversizedBody(t *testing.T) {
	h, e, _ := setupWebhookHandler(t)

	body := `{"meta":{"event_name":"subscription_created"}}`
	_, err := deliverWebhook(h, e, body, signWebhook(body+"tampered"))
	requireHTTPStatus(t, err, http.StatusUnauthorized)

	huge := strings.Repeat("x", 2<<20)
	_, err = deliverWebhook(h, e, huge, signWebhook(huge))
	requireHTTPStatus(t, err, http.StatusRequestEntityTooLarge)
}
