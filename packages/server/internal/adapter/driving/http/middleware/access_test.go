package middleware_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/testkit"

	"github.com/labstack/echo/v4"
)

func TestRequireWorkspaceWriteAccess_DeniesCollabOnlyOwnerWorkspace(t *testing.T) {
	sqlDB, queries, services, _ := testkit.NewTestServices(t, false)

	userID := testkit.SeedUser(t, queries, "owner-collab-only@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Owner Space")

	_, err := sqlDB.ExecContext(
		context.Background(),
		"UPDATE users SET subscription_status = ?, trial_ends_at = NULL, has_collaboration_access = 1 WHERE id = ?",
		"inactive",
		userID,
	)
	if err != nil {
		t.Fatalf("failed to update user entitlement: %v", err)
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/database/blob?space_id="+spaceID, http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("user_id", userID)

	handler := middleware.RequireWorkspaceWriteAccess(services.User, services.Space)(func(c echo.Context) error {
		return c.NoContent(http.StatusNoContent)
	})

	err = handler(c)
	if err == nil {
		t.Fatal("expected payment required error for collab-only owner workspace")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, want %d", httpErr.Code, http.StatusPaymentRequired)
	}
}

func TestRequireWorkspaceWriteAccess_AllowsCollabOnlyMemberWorkspace(t *testing.T) {
	sqlDB, queries, services, _ := testkit.NewTestServices(t, false)

	ownerID := testkit.SeedUser(t, queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Shared Space")

	memberID := testkit.SeedUser(t, queries, "member@example.com")
	testkit.SeedMembership(t, queries, spaceID, memberID, "member")
	_, err := sqlDB.ExecContext(
		context.Background(),
		"UPDATE users SET subscription_status = ?, trial_ends_at = NULL, has_collaboration_access = 1 WHERE id = ?",
		"inactive",
		memberID,
	)
	if err != nil {
		t.Fatalf("failed to update member entitlement: %v", err)
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/database/blob?space_id="+spaceID, http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("user_id", memberID)

	handler := middleware.RequireWorkspaceWriteAccess(services.User, services.Space)(func(c echo.Context) error {
		return c.NoContent(http.StatusNoContent)
	})

	err = handler(c)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
}

func TestRequireWorkspaceWriteAccess_DeniesMemberWorkspaceWhenOwnerIsInactive(t *testing.T) {
	sqlDB, queries, services, _ := testkit.NewTestServices(t, false)

	ownerID := testkit.SeedUser(t, queries, "expired-owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Expired Shared Space")

	memberID := testkit.SeedUser(t, queries, "member-expired-owner@example.com")
	testkit.SeedMembership(t, queries, spaceID, memberID, "member")

	_, err := sqlDB.ExecContext(
		context.Background(),
		"UPDATE users SET subscription_status = ?, trial_ends_at = NULL WHERE id = ?",
		"inactive",
		ownerID,
	)
	if err != nil {
		t.Fatalf("failed to expire owner entitlement: %v", err)
	}
	_, err = sqlDB.ExecContext(
		context.Background(),
		"UPDATE users SET subscription_status = ?, trial_ends_at = NULL, has_collaboration_access = 1 WHERE id = ?",
		"inactive",
		memberID,
	)
	if err != nil {
		t.Fatalf("failed to update member entitlement: %v", err)
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/database/blob?space_id="+spaceID, http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("user_id", memberID)

	handler := middleware.RequireWorkspaceWriteAccess(services.User, services.Space)(func(c echo.Context) error {
		return c.NoContent(http.StatusNoContent)
	})

	err = handler(c)
	if err == nil {
		t.Fatal("expected payment required error for expired shared owner")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, want %d", httpErr.Code, http.StatusPaymentRequired)
	}
}

func TestRequireWorkspaceWriteAccess_AllowsFoundingOwnerWorkspace(t *testing.T) {
	sqlDB, queries, services, _ := testkit.NewTestServices(t, false)

	userID := testkit.SeedUser(t, queries, "founding-owner@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Founding Owner Space")

	_, err := sqlDB.ExecContext(
		context.Background(),
		"UPDATE users SET subscription_status = ?, trial_ends_at = NULL, has_collaboration_access = 0, is_founding_member = 1 WHERE id = ?",
		"inactive",
		userID,
	)
	if err != nil {
		t.Fatalf("failed to set founding member status: %v", err)
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/database/blob?space_id="+spaceID, http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("user_id", userID)

	handler := middleware.RequireWorkspaceWriteAccess(services.User, services.Space)(func(c echo.Context) error {
		return c.NoContent(http.StatusNoContent)
	})

	err = handler(c)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
}

func TestRequireWorkspaceBlobExportAccess_AllowsLockedOwnerWorkspace(t *testing.T) {
	sqlDB, queries, services, _ := testkit.NewTestServices(t, false)

	userID := testkit.SeedUser(t, queries, "locked-owner-export@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Locked Owner Space")

	_, err := sqlDB.ExecContext(
		context.Background(),
		"UPDATE users SET subscription_status = ?, trial_ends_at = NULL, has_collaboration_access = 0 WHERE id = ?",
		"expired",
		userID,
	)
	if err != nil {
		t.Fatalf("failed to expire owner entitlement: %v", err)
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/database/blob?space_id="+spaceID, http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("user_id", userID)

	handler := middleware.RequireWorkspaceBlobExportAccess(services.User, services.Space)(func(c echo.Context) error {
		return c.NoContent(http.StatusNoContent)
	})

	err = handler(c)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
}

func TestRequireWorkspaceBlobExportAccess_DeniesLockedSharedMemberWorkspace(t *testing.T) {
	sqlDB, queries, services, _ := testkit.NewTestServices(t, false)

	ownerID := testkit.SeedUser(t, queries, "expired-owner-export@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Locked Shared Space")

	memberID := testkit.SeedUser(t, queries, "locked-member-export@example.com")
	testkit.SeedMembership(t, queries, spaceID, memberID, "member")

	_, err := sqlDB.ExecContext(
		context.Background(),
		"UPDATE users SET subscription_status = ?, trial_ends_at = NULL WHERE id = ?",
		"expired",
		ownerID,
	)
	if err != nil {
		t.Fatalf("failed to expire owner entitlement: %v", err)
	}
	_, err = sqlDB.ExecContext(
		context.Background(),
		"UPDATE users SET subscription_status = ?, trial_ends_at = NULL, has_collaboration_access = 1 WHERE id = ?",
		"inactive",
		memberID,
	)
	if err != nil {
		t.Fatalf("failed to update member entitlement: %v", err)
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/database/blob?space_id="+spaceID, http.NoBody)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("user_id", memberID)

	handler := middleware.RequireWorkspaceBlobExportAccess(services.User, services.Space)(func(c echo.Context) error {
		return c.NoContent(http.StatusNoContent)
	})

	err = handler(c)
	if err == nil {
		t.Fatal("expected payment required error for locked shared member workspace")
	}

	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("expected echo.HTTPError, got %T", err)
	}
	if httpErr.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, want %d", httpErr.Code, http.StatusPaymentRequired)
	}
}
