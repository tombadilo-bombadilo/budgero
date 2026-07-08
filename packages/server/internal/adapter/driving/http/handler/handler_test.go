package handler_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/adapter/driving/http/handler"
	"budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/testkit"

	"github.com/labstack/echo/v4"
)

// setupTestHandler creates a handler with test infrastructure in SaaS mode.
func setupTestHandler(t *testing.T) (*handler.Handlers, *echo.Echo, *testkit.TestContext) {
	t.Helper()
	sqlDB, queries, services, cfg := testkit.NewTestServices(t, false)

	h := handler.NewHandlers(services, nil, handler.Options{
		SelfHost: false,
		Config:   cfg,
	})

	e := echo.New()
	return h, e, &testkit.TestContext{
		DB:      sqlDB,
		Queries: queries,
	}
}

// setupSelfHostHandler creates a handler with test infrastructure in self-host mode.
func setupSelfHostHandler(t *testing.T) (*handler.Handlers, *echo.Echo, *testkit.TestContext) {
	t.Helper()
	sqlDB, queries, services, cfg := testkit.NewTestServices(t, true)

	// Initialize self-host auth
	middleware.InitSelfHostAuth(cfg)

	h := handler.NewHandlers(services, nil, handler.Options{
		SelfHost: true,
		Config:   cfg,
	})

	e := echo.New()
	return h, e, &testkit.TestContext{
		DB:      sqlDB,
		Queries: queries,
	}
}

// setUserContext sets the user_id in the echo context to simulate authenticated request.
func setUserContext(c echo.Context, userID string) {
	c.Set("user_id", userID)
}

// --- Health Tests ---

func TestHealthCheck(t *testing.T) {
	h, e, _ := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.HealthCheck(c)
	if err != nil {
		t.Fatalf("HealthCheck() error = %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Errorf("HealthCheck() status = %d, want %d", rec.Code, http.StatusOK)
	}

	var response map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if response["status"] != "healthy" {
		t.Errorf("HealthCheck() status = %v, want healthy", response["status"])
	}
}

// --- Self-Host Auth Tests ---

func TestSelfHostLogin_Unauthorized(t *testing.T) {
	h, e, tc := setupSelfHostHandler(t)

	// Create user with credentials
	userID := testkit.SeedUser(t, tc.Queries, "test@example.com")
	_ = testkit.SeedCredential(t, tc.Queries, userID, "wronghash", false)

	body := `{"username": "test@example.com", "password": "wrongpassword"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.SelfHostLogin(c)
	if err == nil {
		t.Fatal("SelfHostLogin() expected error for invalid credentials")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusUnauthorized {
		t.Errorf("SelfHostLogin() status = %d, want %d", httpErr.Code, http.StatusUnauthorized)
	}
}

func TestSelfHostRegister_Success(t *testing.T) {
	h, e, _ := setupSelfHostHandler(t)

	body := `{"name": "New User", "username": "newuser@example.com", "password": "securepassword123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.SelfHostRegister(c)
	if err != nil {
		t.Fatalf("SelfHostRegister() error = %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Errorf("SelfHostRegister() status = %d, want %d", rec.Code, http.StatusOK)
	}

	var response map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if response["token"] == nil || response["token"] == "" {
		t.Error("SelfHostRegister() missing token in response")
	}
	if response["user"] == nil {
		t.Error("SelfHostRegister() missing user in response")
	}
}

func TestSelfHostRegister_InvalidBody(t *testing.T) {
	h, e, _ := setupSelfHostHandler(t)

	body := `{"name": "", "username": "", "password": "short"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.SelfHostRegister(c)
	if err == nil {
		t.Fatal("SelfHostRegister() expected error for invalid body")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusBadRequest {
		t.Errorf("SelfHostRegister() status = %d, want %d", httpErr.Code, http.StatusBadRequest)
	}
}

// --- Profile Tests ---

func TestGetProfile_Unauthorized(t *testing.T) {
	h, e, _ := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/profile", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	// No user_id set

	err := h.GetProfile(c)
	if err == nil {
		t.Fatal("GetProfile() expected error for unauthenticated request")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusUnauthorized {
		t.Errorf("GetProfile() status = %d, want %d", httpErr.Code, http.StatusUnauthorized)
	}
}

func TestRecordActivityHeartbeat_Unauthorized(t *testing.T) {
	h, e, _ := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/profile/activity/heartbeat", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.RecordActivityHeartbeat(c)
	if err == nil {
		t.Fatal("RecordActivityHeartbeat() expected error for unauthenticated request")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusUnauthorized {
		t.Errorf("RecordActivityHeartbeat() status = %d, want %d", httpErr.Code, http.StatusUnauthorized)
	}
}

func TestRecordActivityHeartbeat_Success(t *testing.T) {
	h, e, tc := setupTestHandler(t)
	userID := testkit.SeedUser(t, tc.Queries, "heartbeat@example.com")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/profile/activity/heartbeat", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	err := h.RecordActivityHeartbeat(c)
	if err != nil {
		t.Fatalf("RecordActivityHeartbeat() error = %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("RecordActivityHeartbeat() status = %d, want %d", rec.Code, http.StatusNoContent)
	}

	var count int
	if queryErr := tc.DB.QueryRowContext(
		context.Background(),
		"SELECT COUNT(*) FROM user_daily_activity WHERE user_id = ?",
		userID,
	).Scan(&count); queryErr != nil {
		t.Fatalf("failed to verify heartbeat row: %v", queryErr)
	}
	if count != 1 {
		t.Fatalf("heartbeat row count = %d, want 1", count)
	}
}

func TestGetDatabaseState_IncludesMutationVersion(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "sync-state@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Sync State Space")
	_, err := tc.Queries.UpdateSpaceSyncState(context.Background(), sqlc.UpdateSpaceSyncStateParams{
		CurrentHash: "hash-1",
		SizeBytes:   128,
		SpaceID:     spaceID,
	})
	if err != nil {
		t.Fatalf("UpdateSpaceSyncState() error = %v", err)
	}

	testkit.SeedMutation(t, tc.Queries, spaceID, userID, 1, "cipher-1")
	testkit.SeedMutation(t, tc.Queries, spaceID, userID, 2, "cipher-2")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/database/state?space_id="+spaceID, http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	err = h.GetDatabaseState(c)
	if err != nil {
		t.Fatalf("GetDatabaseState() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("GetDatabaseState() status = %d, want %d", rec.Code, http.StatusOK)
	}

	var response map[string]any
	if unmarshalErr := json.Unmarshal(rec.Body.Bytes(), &response); unmarshalErr != nil {
		t.Fatalf("Failed to parse response: %v", unmarshalErr)
	}

	if response["space_id"] != spaceID {
		t.Fatalf("space_id = %v, want %s", response["space_id"], spaceID)
	}
	if response["version"] != float64(1) {
		t.Fatalf("version = %v, want 1", response["version"])
	}
	if response["mutation_version"] != float64(2) {
		t.Fatalf("mutation_version = %v, want 2", response["mutation_version"])
	}
}

func TestGetProfile_SaaS_UsesLocalUserWithoutClerkRoundTrip(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "profile-existing@example.com")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/profile", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	err := h.GetProfile(c)
	if err != nil {
		t.Fatalf("GetProfile() error = %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Fatalf("GetProfile() status = %d, want %d", rec.Code, http.StatusOK)
	}

	// Existing users should stay on their local profile data and not be rewritten
	// to fallback Clerk identity when external fetch is unavailable.
	updated, getErr := tc.Queries.GetUserByID(context.Background(), userID)
	if getErr != nil {
		t.Fatalf("GetUserByID() error = %v", getErr)
	}
	if updated.Email != "profile-existing@example.com" {
		t.Errorf("user email = %q, want %q", updated.Email, "profile-existing@example.com")
	}
}

func TestGetProfile_SelfHost_UsesLocalCredentialAdminFlag(t *testing.T) {
	_, queries, services, cfg := testkit.NewTestServices(t, false)

	h := handler.NewHandlers(services, nil, handler.Options{
		SelfHost: true,
		Config:   cfg,
	})
	e := echo.New()

	userID := testkit.SeedUser(t, queries, "local-admin@example.com")
	if err := testkit.SeedCredential(t, queries, userID, "hash", true); err != nil {
		t.Fatalf("SeedCredential() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/profile", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	err := h.GetProfile(c)
	if err != nil {
		t.Fatalf("GetProfile() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("GetProfile() status = %d, want %d", rec.Code, http.StatusOK)
	}

	var response map[string]interface{}
	if unmarshalErr := json.Unmarshal(rec.Body.Bytes(), &response); unmarshalErr != nil {
		t.Fatalf("Failed to parse response: %v", unmarshalErr)
	}

	isAdmin, ok := response["is_admin"].(bool)
	if !ok {
		t.Fatalf("is_admin missing or not a bool in response")
	}
	if !isAdmin {
		t.Fatalf("is_admin = false, want true")
	}
}

func TestGetAdminUserDetails_NotFound(t *testing.T) {
	h, e, _ := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/users/missing/details?windowDays=90", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("missing")

	err := h.GetAdminUserDetails(c)
	if err == nil {
		t.Fatal("GetAdminUserDetails() expected not found error")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusNotFound {
		t.Fatalf("GetAdminUserDetails() code = %d, want 404", httpErr.Code)
	}
}

func TestGetAdminUserDetails_ReturnsPartialDataWhenProvidersUnavailable(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "details@example.com")
	if _, err := tc.DB.ExecContext(context.Background(), "UPDATE users SET subscription_id = ?, customer_id = ? WHERE id = ?", "sub_test", "cust_test", userID); err != nil {
		t.Fatalf("failed to attach subscription identifiers: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/users/"+userID+"/details?windowDays=90", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(userID)

	err := h.GetAdminUserDetails(c)
	if err != nil {
		t.Fatalf("GetAdminUserDetails() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("GetAdminUserDetails() code = %d, want 200", rec.Code)
	}

	var response map[string]any
	if unmarshalErr := json.Unmarshal(rec.Body.Bytes(), &response); unmarshalErr != nil {
		t.Fatalf("failed to unmarshal response: %v", unmarshalErr)
	}

	sectionErrors, ok := response["sectionErrors"].(map[string]any)
	if !ok {
		t.Fatalf("sectionErrors missing or wrong type: %T", response["sectionErrors"])
	}
	if sectionErrors["activity"] == nil {
		t.Fatalf("expected activity section error, got %v", sectionErrors)
	}
	if sectionErrors["subscription"] == nil {
		t.Fatalf("expected subscription section error, got %v", sectionErrors)
	}
	if response["mutations"] == nil {
		t.Fatalf("mutations payload should still be present")
	}
	if response["workspaces"] == nil {
		t.Fatalf("workspaces payload should still be present")
	}
}

func TestUpdateProfile_InvalidBody(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "profile@example.com")

	req := httptest.NewRequest(http.MethodPut, "/api/v1/profile", strings.NewReader(`{invalid}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	err := h.UpdateProfile(c)
	if err == nil {
		t.Fatal("UpdateProfile() expected error for invalid body")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusBadRequest {
		t.Errorf("UpdateProfile() status = %d, want %d", httpErr.Code, http.StatusBadRequest)
	}
}

func TestUpdateProfile_MissingName(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "profile@example.com")

	body := `{"name": "", "email": "profile@example.com"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/profile", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	err := h.UpdateProfile(c)
	if err == nil {
		t.Fatal("UpdateProfile() expected error for missing name")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusBadRequest {
		t.Errorf("UpdateProfile() status = %d, want %d", httpErr.Code, http.StatusBadRequest)
	}
}

func TestUpdateProfile_Success(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "profile@example.com")

	body := `{"name": "Updated Name", "email": "profile@example.com"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/profile", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	err := h.UpdateProfile(c)
	if err != nil {
		t.Fatalf("UpdateProfile() error = %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Errorf("UpdateProfile() status = %d, want %d", rec.Code, http.StatusOK)
	}
}

// --- Budget Space Tests ---

func TestGetBudgetSpaces_Unauthorized(t *testing.T) {
	h, e, _ := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/budget-spaces", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	// No user_id set

	err := h.GetBudgetSpaces(c)
	if err == nil {
		t.Fatal("GetBudgetSpaces() expected error for unauthenticated request")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusUnauthorized {
		t.Errorf("GetBudgetSpaces() status = %d, want %d", httpErr.Code, http.StatusUnauthorized)
	}
}

func TestGetBudgetSpaces_EmptyList(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "spaces@example.com")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/budget-spaces", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	err := h.GetBudgetSpaces(c)
	if err != nil {
		t.Fatalf("GetBudgetSpaces() error = %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Errorf("GetBudgetSpaces() status = %d, want %d", rec.Code, http.StatusOK)
	}

	var spaces []interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &spaces); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if len(spaces) != 0 {
		t.Errorf("GetBudgetSpaces() returned %d spaces, want 0", len(spaces))
	}
}

func TestGetBudgetSpaces_WithSpaces(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "spaces@example.com")
	testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Test Space")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/budget-spaces", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	err := h.GetBudgetSpaces(c)
	if err != nil {
		t.Fatalf("GetBudgetSpaces() error = %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Errorf("GetBudgetSpaces() status = %d, want %d", rec.Code, http.StatusOK)
	}

	var spaces []interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &spaces); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if len(spaces) != 1 {
		t.Errorf("GetBudgetSpaces() returned %d spaces, want 1", len(spaces))
	}
}

func TestGetBudgetSpaces_AnnotatesLockedOwnedAndSharedSpaces(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "collab-only@example.com")
	ownedSpaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Owned Space")

	otherOwnerID := testkit.SeedUser(t, tc.Queries, "other-owner@example.com")
	memberSpaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, otherOwnerID, "Shared Space")
	testkit.SeedMembership(t, tc.Queries, memberSpaceID, userID, "member")

	expiredOwnerID := testkit.SeedUser(t, tc.Queries, "expired-owner@example.com")
	expiredSharedSpaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, expiredOwnerID, "Expired Shared")
	testkit.SeedMembership(t, tc.Queries, expiredSharedSpaceID, userID, "member")

	_, err := tc.DB.ExecContext(
		context.Background(),
		"UPDATE users SET subscription_status = ?, trial_ends_at = NULL, has_collaboration_access = 1 WHERE id = ?",
		"inactive",
		userID,
	)
	if err != nil {
		t.Fatalf("failed to set collaboration-only status: %v", err)
	}
	_, err = tc.DB.ExecContext(
		context.Background(),
		"UPDATE users SET subscription_status = ?, trial_ends_at = NULL WHERE id = ?",
		"inactive",
		expiredOwnerID,
	)
	if err != nil {
		t.Fatalf("failed to expire shared owner: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/budget-spaces", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	err = h.GetBudgetSpaces(c)
	if err != nil {
		t.Fatalf("GetBudgetSpaces() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("GetBudgetSpaces() status = %d, want %d", rec.Code, http.StatusOK)
	}

	var spaces []map[string]interface{}
	if unmarshalErr := json.Unmarshal(rec.Body.Bytes(), &spaces); unmarshalErr != nil {
		t.Fatalf("Failed to parse response: %v", unmarshalErr)
	}
	if len(spaces) != 3 {
		t.Fatalf("GetBudgetSpaces() returned %d spaces, want 3", len(spaces))
	}

	indexed := make(map[string]map[string]interface{}, len(spaces))
	for _, space := range spaces {
		spaceID, _ := space["space_id"].(string)
		indexed[spaceID] = space
	}

	if got := indexed[ownedSpaceID]["access_reason"]; got != "owned_subscription_required" {
		t.Fatalf("owned space access_reason = %v, want owned_subscription_required", got)
	}
	if accessible, _ := indexed[ownedSpaceID]["is_accessible"].(bool); accessible {
		t.Fatalf("owned space %q should be inaccessible", ownedSpaceID)
	}
	if got := indexed[memberSpaceID]["access_reason"]; got != "active" {
		t.Fatalf("member space access_reason = %v, want active", got)
	}
	if accessible, _ := indexed[memberSpaceID]["is_accessible"].(bool); !accessible {
		t.Fatalf("member space %q should remain accessible", memberSpaceID)
	}
	if got := indexed[expiredSharedSpaceID]["access_reason"]; got != "shared_owner_inactive" {
		t.Fatalf("expired shared space access_reason = %v, want shared_owner_inactive", got)
	}
	if accessible, _ := indexed[expiredSharedSpaceID]["is_accessible"].(bool); accessible {
		t.Fatalf("expired shared space %q should be inaccessible", expiredSharedSpaceID)
	}
}

func TestCreateBudgetSpace_Unauthorized(t *testing.T) {
	h, e, _ := setupTestHandler(t)

	body := `{"display_name": "New Space"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/budget-spaces", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	// No user_id set

	err := h.CreateBudgetSpace(c)
	if err == nil {
		t.Fatal("CreateBudgetSpace() expected error for unauthenticated request")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusUnauthorized {
		t.Errorf("CreateBudgetSpace() status = %d, want %d", httpErr.Code, http.StatusUnauthorized)
	}
}

func TestCreateBudgetSpace_Success(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "create@example.com")

	body := `{"display_name": "My Budget"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/budget-spaces", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	err := h.CreateBudgetSpace(c)
	if err != nil {
		t.Fatalf("CreateBudgetSpace() error = %v", err)
	}

	if rec.Code != http.StatusCreated {
		t.Errorf("CreateBudgetSpace() status = %d, want %d", rec.Code, http.StatusCreated)
	}

	var response map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if response["space_id"] == nil || response["space_id"] == "" {
		t.Error("CreateBudgetSpace() missing space_id in response")
	}
}

func TestUpdateBudgetSpace_Unauthorized(t *testing.T) {
	h, e, _ := setupTestHandler(t)

	body := `{"display_name": "Updated Name"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/budget-spaces/space123", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("spaceID")
	c.SetParamValues("space123")
	// No user_id set

	err := h.UpdateBudgetSpace(c)
	if err == nil {
		t.Fatal("UpdateBudgetSpace() expected error for unauthenticated request")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusUnauthorized {
		t.Errorf("UpdateBudgetSpace() status = %d, want %d", httpErr.Code, http.StatusUnauthorized)
	}
}

func TestUpdateBudgetSpace_Success(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "update@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Original Name")

	body := `{"display_name": "Updated Name"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/budget-spaces/"+spaceID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("spaceID")
	c.SetParamValues(spaceID)
	setUserContext(c, userID)

	err := h.UpdateBudgetSpace(c)
	if err != nil {
		t.Fatalf("UpdateBudgetSpace() error = %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Errorf("UpdateBudgetSpace() status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestUpdateBudgetSpace_AccessDenied(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	ownerID := testkit.SeedUser(t, tc.Queries, "owner@example.com")
	otherID := testkit.SeedUser(t, tc.Queries, "other@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, ownerID, "Owner's Space")

	body := `{"display_name": "Hacked Name"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/budget-spaces/"+spaceID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("spaceID")
	c.SetParamValues(spaceID)
	setUserContext(c, otherID) // Different user trying to update

	err := h.UpdateBudgetSpace(c)
	if err == nil {
		t.Fatal("UpdateBudgetSpace() expected error for access denied")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusForbidden {
		t.Errorf("UpdateBudgetSpace() status = %d, want %d", httpErr.Code, http.StatusForbidden)
	}
}

func TestRemoveBudgetSpaceMember_Unauthorized(t *testing.T) {
	h, e, _ := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/budget-spaces/space123/members/member456", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("spaceID", "memberID")
	c.SetParamValues("space123", "member456")
	// No user_id set

	err := h.RemoveBudgetSpaceMember(c)
	if err == nil {
		t.Fatal("RemoveBudgetSpaceMember() expected error for unauthenticated request")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusUnauthorized {
		t.Errorf("RemoveBudgetSpaceMember() status = %d, want %d", httpErr.Code, http.StatusUnauthorized)
	}
}

func TestRemoveBudgetSpaceMember_RevokesCollaborationAccessWhenNoMemberSpacesRemain(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	ownerID := testkit.SeedUser(t, tc.Queries, "owner-remove@example.com")
	memberID := testkit.SeedUser(t, tc.Queries, "member-remove@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, ownerID, "Shared Space")
	testkit.SeedMembership(t, tc.Queries, spaceID, memberID, "member")

	_, setErr := tc.DB.ExecContext(context.Background(), "UPDATE users SET has_collaboration_access = 1 WHERE id = ?", memberID)
	if setErr != nil {
		t.Fatalf("failed setting collaboration access: %v", setErr)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/budget-spaces/"+spaceID+"/members/"+memberID, http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("spaceID", "memberID")
	c.SetParamValues(spaceID, memberID)
	setUserContext(c, ownerID)

	err := h.RemoveBudgetSpaceMember(c)
	if err != nil {
		t.Fatalf("RemoveBudgetSpaceMember() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("RemoveBudgetSpaceMember() status = %d, want %d", rec.Code, http.StatusOK)
	}

	updated, getErr := tc.Queries.GetUserByID(context.Background(), memberID)
	if getErr != nil {
		t.Fatalf("GetUserByID() error = %v", getErr)
	}
	if updated.HasCollaborationAccess {
		t.Fatal("HasCollaborationAccess = true, want false after removing last member workspace")
	}
}

func TestRemoveBudgetSpaceMember_KeepsCollaborationAccessWhenOtherMemberSpaceExists(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	ownerOneID := testkit.SeedUser(t, tc.Queries, "owner-one@example.com")
	ownerTwoID := testkit.SeedUser(t, tc.Queries, "owner-two@example.com")
	memberID := testkit.SeedUser(t, tc.Queries, "member-keep@example.com")
	spaceOneID := testkit.SeedSpace(t, tc.DB, tc.Queries, ownerOneID, "Shared One")
	spaceTwoID := testkit.SeedSpace(t, tc.DB, tc.Queries, ownerTwoID, "Shared Two")
	testkit.SeedMembership(t, tc.Queries, spaceOneID, memberID, "member")
	testkit.SeedMembership(t, tc.Queries, spaceTwoID, memberID, "member")

	_, setErr := tc.DB.ExecContext(context.Background(), "UPDATE users SET has_collaboration_access = 1 WHERE id = ?", memberID)
	if setErr != nil {
		t.Fatalf("failed setting collaboration access: %v", setErr)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/budget-spaces/"+spaceOneID+"/members/"+memberID, http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("spaceID", "memberID")
	c.SetParamValues(spaceOneID, memberID)
	setUserContext(c, ownerOneID)

	err := h.RemoveBudgetSpaceMember(c)
	if err != nil {
		t.Fatalf("RemoveBudgetSpaceMember() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("RemoveBudgetSpaceMember() status = %d, want %d", rec.Code, http.StatusOK)
	}

	updated, getErr := tc.Queries.GetUserByID(context.Background(), memberID)
	if getErr != nil {
		t.Fatalf("GetUserByID() error = %v", getErr)
	}
	if !updated.HasCollaborationAccess {
		t.Fatal("HasCollaborationAccess = false, want true while user remains member in another workspace")
	}
}

// --- Invite Tests ---

func TestInviteBudgetSpaceMember_Success(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "inviter@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Invite Space")

	body := `{"email": "invitee@example.com", "invite_secret": "client-provided-secret-hash"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/budget-spaces/"+spaceID+"/invites", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("spaceID")
	c.SetParamValues(spaceID)
	setUserContext(c, userID)

	err := h.InviteBudgetSpaceMember(c)
	if err != nil {
		t.Fatalf("InviteBudgetSpaceMember() error = %v", err)
	}

	if rec.Code != http.StatusCreated {
		t.Errorf("InviteBudgetSpaceMember() status = %d, want %d", rec.Code, http.StatusCreated)
	}

	var response map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if response["id"] == nil || response["id"] == "" {
		t.Error("InviteBudgetSpaceMember() missing id in response")
	}
}

func TestInviteBudgetSpaceMember_NonOwnerDenied(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	ownerID := testkit.SeedUser(t, tc.Queries, "owner-invite@example.com")
	memberID := testkit.SeedUser(t, tc.Queries, "member-invite@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, ownerID, "Invite Space")
	testkit.SeedMembership(t, tc.Queries, spaceID, memberID, "member")

	body := `{"email": "invitee@example.com", "invite_secret": "client-provided-secret-hash"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/budget-spaces/"+spaceID+"/invites", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("spaceID")
	c.SetParamValues(spaceID)
	setUserContext(c, memberID)

	err := h.InviteBudgetSpaceMember(c)
	if err == nil {
		t.Fatal("InviteBudgetSpaceMember() expected error for non-owner")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusForbidden {
		t.Errorf("InviteBudgetSpaceMember() status = %d, want %d", httpErr.Code, http.StatusForbidden)
	}
}

func TestInspectInvite_NotFound(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "inspector@example.com")

	body := `{"invite_secret": "nonexistent-secret"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/invites/inspect", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	err := h.InspectInvite(c)
	if err == nil {
		t.Fatal("InspectInvite() expected error for not found")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusNotFound {
		t.Errorf("InspectInvite() status = %d, want %d", httpErr.Code, http.StatusNotFound)
	}
}

func TestInspectInvite_Success(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	inviterID := testkit.SeedUser(t, tc.Queries, "inviter@example.com")
	inspectorID := testkit.SeedUser(t, tc.Queries, "inspector@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, inviterID, "Inspect Space")
	_, secret := testkit.SeedInvite(t, tc.Queries, spaceID, inviterID, "invitee@example.com")

	body := `{"invite_secret": "` + secret + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/invites/inspect", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, inspectorID)

	err := h.InspectInvite(c)
	if err != nil {
		t.Fatalf("InspectInvite() error = %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Errorf("InspectInvite() status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestRedeemInvite_Success(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	inviterID := testkit.SeedUser(t, tc.Queries, "inviter@example.com")
	redeemID := testkit.SeedUser(t, tc.Queries, "redeemer@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, inviterID, "Redeem Space")
	_, secret := testkit.SeedInvite(t, tc.Queries, spaceID, inviterID, "redeemer@example.com")

	// Attach a bundle to the invite first
	testkit.AttachInviteBundle(t, tc.Queries, secret, "encrypted-bundle")

	body := `{"invite_secret": "` + secret + `", "encrypted_space_key": "user-key"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/invites/redeem", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, redeemID)

	err := h.RedeemInvite(c)
	if err != nil {
		t.Fatalf("RedeemInvite() error = %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Errorf("RedeemInvite() status = %d, want %d", rec.Code, http.StatusOK)
	}

	var response map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if response["space_id"] != spaceID {
		t.Errorf("RedeemInvite() space_id = %v, want %v", response["space_id"], spaceID)
	}

	updated, getErr := tc.Queries.GetUserByID(context.Background(), redeemID)
	if getErr != nil {
		t.Fatalf("GetUserByID() error = %v", getErr)
	}
	if !updated.HasCollaborationAccess {
		t.Fatal("HasCollaborationAccess = false, want true after redeeming invite")
	}
}

// --- Push API Tests ---

func TestGetPushTokenStatus_Unauthorized(t *testing.T) {
	h, e, _ := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/push/token/status", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	// No user_id set

	err := h.GetPushTokenStatus(c)
	if err == nil {
		t.Fatal("GetPushTokenStatus() expected error for unauthenticated request")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusUnauthorized {
		t.Errorf("GetPushTokenStatus() status = %d, want %d", httpErr.Code, http.StatusUnauthorized)
	}
}

func TestGetPushTokenStatus_NoToken(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "push@example.com")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/push/token/status", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	err := h.GetPushTokenStatus(c)
	if err != nil {
		t.Fatalf("GetPushTokenStatus() error = %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Errorf("GetPushTokenStatus() status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestGetPushTokenStatus_WithToken(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "push@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Push Space")
	testkit.SeedPushToken(t, tc.Queries, userID, spaceID)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/push/token/status", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	setUserContext(c, userID)

	err := h.GetPushTokenStatus(c)
	if err != nil {
		t.Fatalf("GetPushTokenStatus() error = %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Errorf("GetPushTokenStatus() status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestPushMutation_InvalidAuth(t *testing.T) {
	h, e, _ := setupTestHandler(t)

	body := `{"encrypted_payload": "payload123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/push", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	// No Authorization header
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.PushMutation(c)
	if err == nil {
		t.Fatal("PushMutation() expected error for missing auth")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusUnauthorized {
		t.Errorf("PushMutation() status = %d, want %d", httpErr.Code, http.StatusUnauthorized)
	}
}

func TestPushMutation_MissingPayload(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "push@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Push Space")
	token := testkit.SeedPushTokenWithPlaintext(t, tc.Queries, userID, spaceID)

	body := `{}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/push", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.PushMutation(c)
	if err == nil {
		t.Fatal("PushMutation() expected error for missing payload")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusBadRequest {
		t.Errorf("PushMutation() status = %d, want %d", httpErr.Code, http.StatusBadRequest)
	}
}

func TestPushMutation_Success(t *testing.T) {
	h, e, tc := setupTestHandler(t)

	userID := testkit.SeedUser(t, tc.Queries, "push@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, userID, "Push Space")
	token := testkit.SeedPushTokenWithPlaintext(t, tc.Queries, userID, spaceID)

	body := `{"encrypted_payload": "base64-encrypted-payload"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/push", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.PushMutation(c)
	if err != nil {
		t.Fatalf("PushMutation() error = %v", err)
	}

	if rec.Code != http.StatusAccepted {
		t.Errorf("PushMutation() status = %d, want %d", rec.Code, http.StatusAccepted)
	}

	var response map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if response["status"] != "queued" {
		t.Errorf("PushMutation() status = %v, want queued", response["status"])
	}
}

func TestGetPushEncryptionInfo_Unauthorized(t *testing.T) {
	h, e, _ := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/push/encryption-info", http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	// No user_id set

	err := h.GetPushEncryptionInfo(c)
	if err == nil {
		t.Fatal("GetPushEncryptionInfo() expected error for unauthenticated request")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusUnauthorized {
		t.Errorf("GetPushEncryptionInfo() status = %d, want %d", httpErr.Code, http.StatusUnauthorized)
	}
}
