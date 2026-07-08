package application_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/fake"
	"budgero-server/internal/application"
	"budgero-server/internal/domain"
)

const (
	testSubscriptionID = "sub123"
	testCustomerID     = "cust123"
	testUserID         = "user1"
)

func TestAdminService_GetStats(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	credRepo := fake.NewCredentialRepository()
	adminRepo := fake.NewAdminRepository(userRepo, credRepo)
	svc := application.NewAdminService(adminRepo)

	// Create users with different subscription states
	_, _ = userRepo.Create(ctx, &domain.User{ID: "user1", Email: "user1@example.com", SubscriptionStatus: domain.SubscriptionActive})
	_, _ = userRepo.Create(ctx, &domain.User{ID: "user2", Email: "user2@example.com", SubscriptionStatus: domain.SubscriptionActive})
	_, _ = userRepo.Create(ctx, &domain.User{ID: "user3", Email: "user3@example.com", SubscriptionStatus: domain.SubscriptionTrialing})
	_, _ = userRepo.Create(ctx, &domain.User{ID: "user4", Email: "user4@example.com", HasBetaAccess: true})
	_, _ = userRepo.Create(ctx, &domain.User{ID: "user5", Email: "user5@example.com", IsFoundingMember: true})
	_, _ = userRepo.Create(ctx, &domain.User{ID: "user6", Email: "user6@example.com"}) // No subscription

	stats, err := svc.GetStats(ctx)
	if err != nil {
		t.Fatalf("GetStats() error = %v", err)
	}

	if stats.TotalUsers != 6 {
		t.Errorf("TotalUsers = %d, want 6", stats.TotalUsers)
	}
	if stats.ActiveUsers != 2 {
		t.Errorf("ActiveUsers = %d, want 2", stats.ActiveUsers)
	}
	if stats.PaidUsers != 2 {
		t.Errorf("PaidUsers = %d, want 2", stats.PaidUsers)
	}
	if stats.TrialUsers != 1 {
		t.Errorf("TrialUsers = %d, want 1", stats.TrialUsers)
	}
	if stats.BetaUsers != 1 {
		t.Errorf("BetaUsers = %d, want 1", stats.BetaUsers)
	}
	if stats.FoundingMembers != 1 {
		t.Errorf("FoundingMembers = %d, want 1", stats.FoundingMembers)
	}
}

func TestAdminService_GetSelfHostStats(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	credRepo := fake.NewCredentialRepository()
	adminRepo := fake.NewAdminRepository(userRepo, credRepo)
	svc := application.NewAdminService(adminRepo)

	// Create users
	_, _ = userRepo.Create(ctx, &domain.User{ID: "user1", Email: "user1@example.com", IsMasterPasswordSet: true})
	_, _ = userRepo.Create(ctx, &domain.User{ID: "user2", Email: "user2@example.com", IsMasterPasswordSet: true})
	_, _ = userRepo.Create(ctx, &domain.User{ID: "user3", Email: "user3@example.com"})

	// Create credentials (local accounts)
	_ = credRepo.Create(ctx, "user1", "hash1", true)  // admin
	_ = credRepo.Create(ctx, "user2", "hash2", false) // regular

	stats, err := svc.GetSelfHostStats(ctx)
	if err != nil {
		t.Fatalf("GetSelfHostStats() error = %v", err)
	}

	if stats.TotalUsers != 3 {
		t.Errorf("TotalUsers = %d, want 3", stats.TotalUsers)
	}
	if stats.LocalAccounts != 2 {
		t.Errorf("LocalAccounts = %d, want 2", stats.LocalAccounts)
	}
	if stats.AdminUsers != 1 {
		t.Errorf("AdminUsers = %d, want 1", stats.AdminUsers)
	}
	if stats.MasterPasswordUsers != 2 {
		t.Errorf("MasterPasswordUsers = %d, want 2", stats.MasterPasswordUsers)
	}
}

func TestAdminService_ListUsers(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	credRepo := fake.NewCredentialRepository()
	adminRepo := fake.NewAdminRepository(userRepo, credRepo)
	svc := application.NewAdminService(adminRepo)

	subID := testSubscriptionID
	custID := testCustomerID
	_, _ = userRepo.Create(ctx, &domain.User{
		ID:                 testUserID,
		Name:               "Test User",
		Email:              "test@example.com",
		SubscriptionStatus: domain.SubscriptionActive,
		SubscriptionID:     &subID,
		CustomerID:         &custID,
		IsFoundingMember:   true,
	})

	users, err := svc.ListUsers(ctx)
	if err != nil {
		t.Fatalf("ListUsers() error = %v", err)
	}

	if len(users) != 1 {
		t.Fatalf("Expected 1 user, got %d", len(users))
	}

	user := users[0]
	if user.ID != testUserID {
		t.Errorf("ID = %v, want %s", user.ID, testUserID)
	}
	if user.Name != "Test User" {
		t.Errorf("Name = %v, want Test User", user.Name)
	}
	if user.Email != "test@example.com" {
		t.Errorf("Email = %v, want test@example.com", user.Email)
	}
	if user.SubscriptionStatus != domain.SubscriptionActive {
		t.Errorf("SubscriptionStatus = %v, want active", user.SubscriptionStatus)
	}
	if !user.IsFoundingMember {
		t.Error("IsFoundingMember should be true")
	}
}

func TestAdminService_ListSelfHostUsers(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	credRepo := fake.NewCredentialRepository()
	adminRepo := fake.NewAdminRepository(userRepo, credRepo)
	svc := application.NewAdminService(adminRepo)

	_, _ = userRepo.Create(ctx, &domain.User{
		ID:                  "user1",
		Name:                "Admin User",
		Email:               "admin@example.com",
		IsMasterPasswordSet: true,
	})
	_ = credRepo.Create(ctx, "user1", "hash", true)
	_ = credRepo.MarkLogin(ctx, "user1")

	users, err := svc.ListSelfHostUsers(ctx)
	if err != nil {
		t.Fatalf("ListSelfHostUsers() error = %v", err)
	}

	if len(users) != 1 {
		t.Fatalf("Expected 1 user, got %d", len(users))
	}

	user := users[0]
	if !user.HasLocalPassword {
		t.Error("HasLocalPassword should be true")
	}
	if !user.IsAdmin {
		t.Error("IsAdmin should be true")
	}
	if user.LastLoginAt == nil {
		t.Error("LastLoginAt should be set")
	}
	if !user.IsMasterPasswordSet {
		t.Error("IsMasterPasswordSet should be true")
	}
}

func TestAdminService_ListRecentUsers(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	credRepo := fake.NewCredentialRepository()
	adminRepo := fake.NewAdminRepository(userRepo, credRepo)
	svc := application.NewAdminService(adminRepo)

	_, _ = userRepo.Create(ctx, &domain.User{
		ID:        "user1",
		Name:      "Recent User",
		Email:     "recent@example.com",
		CreatedAt: time.Now(),
	})

	users, err := svc.ListRecentUsers(ctx)
	if err != nil {
		t.Fatalf("ListRecentUsers() error = %v", err)
	}

	if len(users) != 1 {
		t.Fatalf("Expected 1 user, got %d", len(users))
	}

	if users[0].Name != "Recent User" {
		t.Errorf("Name = %v, want Recent User", users[0].Name)
	}
}

func TestAdminService_IsLocalAdmin(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	credRepo := fake.NewCredentialRepository()
	adminRepo := fake.NewAdminRepository(userRepo, credRepo)
	svc := application.NewAdminService(adminRepo)

	// Create admin user
	_ = credRepo.Create(ctx, "admin1", "hash", true)
	// Create regular user
	_ = credRepo.Create(ctx, "user1", "hash", false)

	// Test admin
	isAdmin, err := svc.IsLocalAdmin(ctx, "admin1")
	if err != nil {
		t.Fatalf("IsLocalAdmin(admin1) error = %v", err)
	}
	if !isAdmin {
		t.Error("admin1 should be admin")
	}

	// Test regular user
	isAdmin, err = svc.IsLocalAdmin(ctx, "user1")
	if err != nil {
		t.Fatalf("IsLocalAdmin(user1) error = %v", err)
	}
	if isAdmin {
		t.Error("user1 should not be admin")
	}

	// Test non-existent user
	isAdmin, err = svc.IsLocalAdmin(ctx, "nonexistent")
	if err != nil {
		t.Fatalf("IsLocalAdmin(nonexistent) error = %v", err)
	}
	if isAdmin {
		t.Error("nonexistent user should not be admin")
	}
}

func TestAdminService_RevokeAllAccess(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	credRepo := fake.NewCredentialRepository()
	adminRepo := fake.NewAdminRepository(userRepo, credRepo)
	svc := application.NewAdminService(adminRepo)

	subID := testSubscriptionID
	custID := testCustomerID
	_, _ = userRepo.Create(ctx, &domain.User{
		ID:                    testUserID,
		SubscriptionStatus:    domain.SubscriptionActive,
		SubscriptionID:        &subID,
		CustomerID:            &custID,
		HasBetaAccess:         true,
		IsFoundingMember:      true,
		HasCollaborationAccess: true,
	})

	err := svc.RevokeAllAccess(ctx, testUserID)
	if err != nil {
		t.Fatalf("RevokeAllAccess() error = %v", err)
	}

	// Verify all access revoked
	user, _ := userRepo.GetByID(ctx, testUserID)
	if user.SubscriptionStatus != "" {
		t.Errorf("SubscriptionStatus should be empty, got %v", user.SubscriptionStatus)
	}
	if user.SubscriptionID != nil {
		t.Error("SubscriptionID should be nil")
	}
	if user.CustomerID != nil {
		t.Error("CustomerID should be nil")
	}
	if user.HasBetaAccess {
		t.Error("HasBetaAccess should be false")
	}
	if user.IsFoundingMember {
		t.Error("IsFoundingMember should be false")
	}
	if user.HasCollaborationAccess {
		t.Error("HasCollaborationAccess should be false")
	}
}

func TestAdminService_ListUsersWithSubscription(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	credRepo := fake.NewCredentialRepository()
	adminRepo := fake.NewAdminRepository(userRepo, credRepo)
	svc := application.NewAdminService(adminRepo)

	subID := testSubscriptionID
	custID := testCustomerID
	_, _ = userRepo.Create(ctx, &domain.User{
		ID:             testUserID,
		Email:          "user1@example.com",
		SubscriptionID: &subID,
		CustomerID:     &custID,
	})
	_, _ = userRepo.Create(ctx, &domain.User{
		ID:    "user2",
		Email: "user2@example.com",
		// No subscription
	})

	users, err := svc.ListUsersWithSubscription(ctx)
	if err != nil {
		t.Fatalf("ListUsersWithSubscription() error = %v", err)
	}

	if len(users) != 1 {
		t.Fatalf("Expected 1 user with subscription, got %d", len(users))
	}

	if users[0].ID != testUserID {
		t.Errorf("ID = %v, want %s", users[0].ID, testUserID)
	}
	if users[0].SubscriptionID != testSubscriptionID {
		t.Errorf("SubscriptionID = %v, want %s", users[0].SubscriptionID, testSubscriptionID)
	}
}

func TestAdminService_MigrateUserID(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	credRepo := fake.NewCredentialRepository()
	adminRepo := fake.NewAdminRepository(userRepo, credRepo)
	svc := application.NewAdminService(adminRepo)

	_, _ = userRepo.Create(ctx, &domain.User{
		ID:    "old-id",
		Name:  "Old Name",
		Email: "old@example.com",
	})

	err := svc.MigrateUserID(ctx, "old-id", "new-id", "New Name", "new@example.com")
	if err != nil {
		t.Fatalf("MigrateUserID() error = %v", err)
	}

	// Old ID should not exist
	_, err = userRepo.GetByID(ctx, "old-id")
	if !errors.Is(err, domain.ErrUserNotFound) {
		t.Error("Old ID should not exist")
	}

	// New ID should exist with updated info
	user, err := userRepo.GetByID(ctx, "new-id")
	if err != nil {
		t.Fatalf("GetByID(new-id) error = %v", err)
	}
	if user.Name != "New Name" {
		t.Errorf("Name = %v, want New Name", user.Name)
	}
	if user.Email != "new@example.com" {
		t.Errorf("Email = %v, want new@example.com", user.Email)
	}
}

func TestAdminService_MigrateUserID_NotFound(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	credRepo := fake.NewCredentialRepository()
	adminRepo := fake.NewAdminRepository(userRepo, credRepo)
	svc := application.NewAdminService(adminRepo)

	err := svc.MigrateUserID(ctx, "nonexistent", "new-id", "Name", "email@example.com")
	if !errors.Is(err, domain.ErrUserNotFound) {
		t.Errorf("MigrateUserID() error = %v, want ErrUserNotFound", err)
	}
}

func TestAdminService_BackfillTrialForInactiveUsers(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	credRepo := fake.NewCredentialRepository()
	adminRepo := fake.NewAdminRepository(userRepo, credRepo)
	svc := application.NewAdminService(adminRepo)

	// Create users with different states
	_, _ = userRepo.Create(ctx, &domain.User{ID: "user1", Email: "user1@example.com"})                                       // Inactive - should get trial
	_, _ = userRepo.Create(ctx, &domain.User{ID: "user2", Email: "user2@example.com"})                                       // Inactive - should get trial
	_, _ = userRepo.Create(ctx, &domain.User{ID: "user3", Email: "user3@example.com", SubscriptionStatus: domain.SubscriptionActive}) // Active - no change
	_, _ = userRepo.Create(ctx, &domain.User{ID: "user4", Email: "user4@example.com", IsFoundingMember: true})               // Founding - no change
	_, _ = userRepo.Create(ctx, &domain.User{ID: "user5", Email: "user5@example.com", HasBetaAccess: true})                  // Beta - no change

	count, err := svc.BackfillTrialForInactiveUsers(ctx, 14)
	if err != nil {
		t.Fatalf("BackfillTrialForInactiveUsers() error = %v", err)
	}

	if count != 2 {
		t.Errorf("BackfillTrialForInactiveUsers() count = %d, want 2", count)
	}

	// Verify user1 got trial
	user1, _ := userRepo.GetByID(ctx, "user1")
	if user1.SubscriptionStatus != domain.SubscriptionTrialing {
		t.Errorf("user1.SubscriptionStatus = %v, want trialing", user1.SubscriptionStatus)
	}
	if user1.TrialEndsAt == nil {
		t.Error("user1.TrialEndsAt should be set")
	}

	// Verify user3 unchanged
	user3, _ := userRepo.GetByID(ctx, "user3")
	if user3.SubscriptionStatus != domain.SubscriptionActive {
		t.Errorf("user3.SubscriptionStatus = %v, want active", user3.SubscriptionStatus)
	}

	// Verify founding member unchanged
	user4, _ := userRepo.GetByID(ctx, "user4")
	if user4.SubscriptionStatus == domain.SubscriptionTrialing {
		t.Error("Founding member should not get trial")
	}
}

func TestAdminService_GetStats_EmptyRepository(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	credRepo := fake.NewCredentialRepository()
	adminRepo := fake.NewAdminRepository(userRepo, credRepo)
	svc := application.NewAdminService(adminRepo)

	stats, err := svc.GetStats(ctx)
	if err != nil {
		t.Fatalf("GetStats() error = %v", err)
	}

	if stats.TotalUsers != 0 {
		t.Errorf("TotalUsers = %d, want 0", stats.TotalUsers)
	}
}
