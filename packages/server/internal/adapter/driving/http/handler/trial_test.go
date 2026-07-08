package handler_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"budgero-server/internal/adapter/driving/http/handler"
	"budgero-server/internal/application"
	"budgero-server/internal/domain"
	"budgero-server/internal/testkit"

	"github.com/labstack/echo/v4"
)

// backdateUser shifts the user's created_at back by daysAgo and sets
// trial_ends_at to (now + 35d - daysAgo) so the trial is still active. Used
// to give tests a past-dated trial start so unlock timestamps are in the
// past and resulting discount codes pass IsActive(now).
func backdateUser(t *testing.T, db *sql.DB, userID string, daysAgo int) {
	t.Helper()
	now := time.Now()
	createdAt := now.Add(-time.Duration(daysAgo) * 24 * time.Hour)
	trialEnds := createdAt.Add(35 * 24 * time.Hour)
	_, err := db.Exec(`UPDATE users SET created_at = ?, trial_ends_at = ? WHERE id = ?`, createdAt, trialEnds, userID)
	if err != nil {
		t.Fatalf("backdate user: %v", err)
	}
}

// setupTrialHandler creates a SaaS handler and also returns the services
// container so tests can drive the trial-rewards service directly with
// dated signals (the HTTP signal endpoint always uses time.Now).
func setupTrialHandler(t *testing.T) (*handler.Handlers, *echo.Echo, *testkit.TestContext, *application.Services) {
	t.Helper()
	sqlDB, queries, services, cfg := testkit.NewTestServices(t, false)
	h := handler.NewHandlers(services, nil, handler.Options{
		SelfHost: false,
		Config:   cfg,
	})
	e := echo.New()
	return h, e, &testkit.TestContext{DB: sqlDB, Queries: queries}, services
}

func TestRecordTrialSignal_Unauthorized(t *testing.T) {
	h, e, _ := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/trial/signal",
		strings.NewReader(`{"kind":"daily_logging"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := h.RecordTrialSignal(c); err == nil {
		t.Fatalf("expected error for unauthorized request")
	}
}

func TestRecordTrialSignal_RejectsInvalidKind(t *testing.T) {
	h, e, tc := setupTestHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "signal-bad@example.com")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/trial/signal",
		strings.NewReader(`{"kind":"forged_kind"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	if err := h.RecordTrialSignal(c); err == nil {
		t.Fatalf("expected 400 for invalid kind")
	}
}

func TestRecordTrialSignal_Success(t *testing.T) {
	h, e, tc := setupTestHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "signal-ok@example.com")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/trial/signal",
		strings.NewReader(`{"kind":"reconciliation"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	if err := h.RecordTrialSignal(c); err != nil {
		t.Fatalf("RecordTrialSignal: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", rec.Code)
	}
}

func TestGetTrialProgress_ReturnsTierCatalogEvenWithoutProgress(t *testing.T) {
	h, e, tc := setupTestHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "progress-empty@example.com")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/trial/progress", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	if err := h.GetTrialProgress(c); err != nil {
		t.Fatalf("GetTrialProgress: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var resp handler.TrialProgressResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Progress != nil {
		t.Errorf("expected nil progress for fresh user")
	}
	if len(resp.Tiers) != 3 {
		t.Errorf("expected 3 tier catalog entries, got %d", len(resp.Tiers))
	}
	if len(resp.Codes) != 0 {
		t.Errorf("expected empty codes slice, got %d entries", len(resp.Codes))
	}
}

func TestGetTrialProgress_ReturnsCodesAfterUnlock(t *testing.T) {
	h, e, tc, services := setupTrialHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "progress-codes@example.com")
	ctx := context.Background()

	user, err := tc.Queries.GetUserByID(ctx, userID)
	if err != nil {
		t.Fatalf("get seeded user: %v", err)
	}
	if !user.CreatedAt.Valid {
		t.Fatalf("user has no CreatedAt")
	}
	startDay := user.CreatedAt.Time

	month := startDay.UTC().Format("2006-01")
	for i := 0; i < 5; i++ {
		if err := services.TrialRewards.RecordSignal(ctx, userID, domain.SignalTransactionInMonth, startDay, month); err != nil {
			t.Fatalf("seed signal %d: %v", i, err)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/trial/progress", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	if err := h.GetTrialProgress(c); err != nil {
		t.Fatalf("GetTrialProgress: %v", err)
	}

	var resp handler.TrialProgressResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Progress == nil || resp.Progress.Tier1UnlockedAt == nil {
		t.Errorf("expected T1 unlocked, got %+v", resp.Progress)
	}
	if len(resp.Codes) != 1 || resp.Codes[0].Tier != domain.RewardTier1 {
		t.Errorf("expected 1 T1 code, got %+v", resp.Codes)
	}
}

func TestValidateTrialCode_RejectsForeignCode(t *testing.T) {
	h, e, tc, services := setupTrialHandler(t)
	owner := testkit.SeedUser(t, tc.Queries, "owner@example.com")
	other := testkit.SeedUser(t, tc.Queries, "other@example.com")
	ctx := context.Background()

	user, _ := tc.Queries.GetUserByID(ctx, owner)
	startDay := user.CreatedAt.Time
	month := startDay.UTC().Format("2006-01")
	for i := 0; i < 5; i++ {
		_ = services.TrialRewards.RecordSignal(ctx, owner, domain.SignalTransactionInMonth, startDay, month)
	}
	_, codes, _ := services.TrialRewards.GetProgress(ctx, owner)
	if len(codes) == 0 {
		t.Fatalf("no codes for owner")
	}
	stolenCode := codes[0].Code

	req := httptest.NewRequest(http.MethodPost, "/api/v1/trial/codes/validate",
		strings.NewReader(`{"code":"`+stolenCode+`"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, other)

	if err := h.ValidateTrialCode(c); err == nil {
		t.Fatalf("expected validation to reject foreign code")
	}
}

func TestValidateTrialCode_AcceptsOwnCode(t *testing.T) {
	h, e, tc, services := setupTrialHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "code-owner@example.com")
	backdateUser(t, tc.DB, userID, 8)
	ctx := context.Background()

	user, _ := tc.Queries.GetUserByID(ctx, userID)
	startDay := user.CreatedAt.Time
	month := startDay.UTC().Format("2006-01")
	for i := 0; i < 5; i++ {
		_ = services.TrialRewards.RecordSignal(ctx, userID, domain.SignalTransactionInMonth, startDay, month)
	}
	_, codes, _ := services.TrialRewards.GetProgress(ctx, userID)
	if len(codes) == 0 {
		t.Fatalf("no codes for user")
	}
	myCode := codes[0].Code

	req := httptest.NewRequest(http.MethodPost, "/api/v1/trial/codes/validate",
		strings.NewReader(`{"code":"`+myCode+`"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	if err := h.ValidateTrialCode(c); err != nil {
		t.Fatalf("ValidateTrialCode: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}
