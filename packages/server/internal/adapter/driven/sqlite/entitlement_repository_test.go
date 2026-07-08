package sqlite_test

import (
	"context"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/sqlite"
	"budgero-server/internal/domain"
	"budgero-server/internal/testkit"
)

func TestEntitlementRepository_UpdateSubscription(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	userRepo := sqlite.NewUserRepository(queries)
	repo := sqlite.NewEntitlementRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "sub@example.com")

	endsAt := time.Now().Add(30 * 24 * time.Hour)
	periodEnd := time.Now().Add(30 * 24 * time.Hour)
	update := domain.SubscriptionUpdate{
		Status:           "active",
		SubscriptionID:   strPtr("sub_123"),
		CustomerID:       strPtr("cust_456"),
		VariantID:        strPtr("var_789"),
		SubscriptionEnds: &endsAt,
		CurrentPeriodEnd: &periodEnd,
	}

	err := repo.UpdateSubscription(ctx, userID, update)
	if err != nil {
		t.Fatalf("UpdateSubscription() error = %v", err)
	}

	// Verify
	user, _ := userRepo.GetByID(ctx, userID)
	if user.SubscriptionStatus != "active" {
		t.Errorf("SubscriptionStatus = %v, want active", user.SubscriptionStatus)
	}
	if user.SubscriptionID == nil || *user.SubscriptionID != "sub_123" {
		t.Errorf("SubscriptionID = %v, want sub_123", user.SubscriptionID)
	}
}

func TestEntitlementRepository_UpdateSubscriptionStatus(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	userRepo := sqlite.NewUserRepository(queries)
	repo := sqlite.NewEntitlementRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "status@example.com")

	endsAt := time.Now().Add(7 * 24 * time.Hour)
	err := repo.UpdateSubscriptionStatus(ctx, userID, "cancelled", &endsAt, nil)
	if err != nil {
		t.Fatalf("UpdateSubscriptionStatus() error = %v", err)
	}

	user, _ := userRepo.GetByID(ctx, userID)
	if user.SubscriptionStatus != "cancelled" {
		t.Errorf("SubscriptionStatus = %v, want cancelled", user.SubscriptionStatus)
	}
}

func TestEntitlementRepository_GrantFoundingMember(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	userRepo := sqlite.NewUserRepository(queries)
	repo := sqlite.NewEntitlementRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "founder@example.com")

	err := repo.GrantFoundingMember(ctx, userID)
	if err != nil {
		t.Fatalf("GrantFoundingMember() error = %v", err)
	}

	user, _ := userRepo.GetByID(ctx, userID)
	if !user.IsFoundingMember {
		t.Error("IsFoundingMember = false, want true")
	}
}

func TestEntitlementRepository_GrantBetaAccess(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	userRepo := sqlite.NewUserRepository(queries)
	repo := sqlite.NewEntitlementRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "beta@example.com")

	expiresAt := time.Now().Add(90 * 24 * time.Hour)
	err := repo.GrantBetaAccess(ctx, userID, expiresAt)
	if err != nil {
		t.Fatalf("GrantBetaAccess() error = %v", err)
	}

	user, _ := userRepo.GetByID(ctx, userID)
	if !user.HasBetaAccess {
		t.Error("HasBetaAccess = false, want true")
	}
	if user.BetaExpiresAt == nil {
		t.Error("BetaExpiresAt = nil, want non-nil")
	}
}

func TestEntitlementRepository_RevokeBetaAccess(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	userRepo := sqlite.NewUserRepository(queries)
	repo := sqlite.NewEntitlementRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "revokebeta@example.com")

	// Grant first
	_ = repo.GrantBetaAccess(ctx, userID, time.Now().Add(90*24*time.Hour))

	// Revoke
	err := repo.RevokeBetaAccess(ctx, userID)
	if err != nil {
		t.Fatalf("RevokeBetaAccess() error = %v", err)
	}

	user, _ := userRepo.GetByID(ctx, userID)
	if user.HasBetaAccess {
		t.Error("HasBetaAccess = true after revoke, want false")
	}
}

func TestEntitlementRepository_SetCollaborationAccess(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	userRepo := sqlite.NewUserRepository(queries)
	repo := sqlite.NewEntitlementRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "collab@example.com")

	err := repo.SetCollaborationAccess(ctx, userID, true)
	if err != nil {
		t.Fatalf("SetCollaborationAccess(true) error = %v", err)
	}

	user, _ := userRepo.GetByID(ctx, userID)
	if !user.HasCollaborationAccess {
		t.Error("HasCollaborationAccess = false, want true")
	}

	err = repo.SetCollaborationAccess(ctx, userID, false)
	if err != nil {
		t.Fatalf("SetCollaborationAccess(false) error = %v", err)
	}

	user, _ = userRepo.GetByID(ctx, userID)
	if user.HasCollaborationAccess {
		t.Error("HasCollaborationAccess = true after set false, want false")
	}
}

func TestEntitlementRepository_RevokeAllAccess(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	userRepo := sqlite.NewUserRepository(queries)
	repo := sqlite.NewEntitlementRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "revokeall@example.com")

	// Grant various access
	_ = repo.GrantFoundingMember(ctx, userID)
	_ = repo.GrantBetaAccess(ctx, userID, time.Now().Add(90*24*time.Hour))
	_ = repo.SetCollaborationAccess(ctx, userID, true)

	err := repo.RevokeAllAccess(ctx, userID)
	if err != nil {
		t.Fatalf("RevokeAllAccess() error = %v", err)
	}

	user, _ := userRepo.GetByID(ctx, userID)
	if user.IsFoundingMember {
		t.Error("IsFoundingMember = true after revoke all, want false")
	}
	if user.HasBetaAccess {
		t.Error("HasBetaAccess = true after revoke all, want false")
	}
	if user.HasCollaborationAccess {
		t.Error("HasCollaborationAccess = true after revoke all, want false")
	}
}

// Helper function
func strPtr(s string) *string {
	return &s
}
