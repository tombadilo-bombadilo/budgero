package sqlite_test

import (
	"context"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/sqlite"
	"budgero-server/internal/testkit"
)

func TestAdminRepository_GetStats(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewAdminRepository(queries)
	ctx := context.Background()

	// Seed some users
	testkit.SeedUser(t, queries, "user1@example.com")
	testkit.SeedUser(t, queries, "user2@example.com")

	stats, err := repo.GetStats(ctx)
	if err != nil {
		t.Fatalf("GetStats() error = %v", err)
	}
	if stats.TotalUsers < 2 {
		t.Errorf("TotalUsers = %v, want >= 2", stats.TotalUsers)
	}
}

func TestAdminRepository_GetSelfHostStats(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, true)
	repo := sqlite.NewAdminRepository(queries)
	credRepo := sqlite.NewCredentialRepository(queries)
	ctx := context.Background()

	// Seed users and credentials
	user1 := testkit.SeedUser(t, queries, "user1@example.com")
	user2 := testkit.SeedUser(t, queries, "user2@example.com")
	_ = credRepo.Create(ctx, user1, "hash1", true)  // admin
	_ = credRepo.Create(ctx, user2, "hash2", false) // not admin

	// Create a space
	testkit.SeedSpace(t, sqlDB, queries, user1, "Test Space")

	stats, err := repo.GetSelfHostStats(ctx)
	if err != nil {
		t.Fatalf("GetSelfHostStats() error = %v", err)
	}
	if stats.TotalUsers < 2 {
		t.Errorf("TotalUsers = %v, want >= 2", stats.TotalUsers)
	}
	if stats.LocalAccounts < 2 {
		t.Errorf("LocalAccounts = %v, want >= 2", stats.LocalAccounts)
	}
	if stats.AdminUsers < 1 {
		t.Errorf("AdminUsers = %v, want >= 1", stats.AdminUsers)
	}
	if stats.SpaceCount < 1 {
		t.Errorf("SpaceCount = %v, want >= 1", stats.SpaceCount)
	}
}

func TestAdminRepository_ListUsers(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewAdminRepository(queries)
	ctx := context.Background()

	testkit.SeedUser(t, queries, "list1@example.com")
	testkit.SeedUser(t, queries, "list2@example.com")

	users, err := repo.ListUsers(ctx)
	if err != nil {
		t.Fatalf("ListUsers() error = %v", err)
	}
	if len(users) < 2 {
		t.Errorf("ListUsers() returned %d users, want >= 2", len(users))
	}

	// Verify user fields
	for _, user := range users {
		if user.ID == "" {
			t.Error("User ID is empty")
		}
		if user.Email == "" {
			t.Error("User Email is empty")
		}
	}
}

func TestAdminRepository_NormalizesExpiredTrialStatus(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewAdminRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "expired-trial@example.com")
	past := time.Now().Add(-24 * time.Hour)
	if _, err := sqlDB.ExecContext(
		ctx,
		"UPDATE users SET subscription_status = ?, trial_ends_at = ? WHERE id = ?",
		"trialing",
		past,
		userID,
	); err != nil {
		t.Fatalf("failed to update user: %v", err)
	}

	users, err := repo.ListUsers(ctx)
	if err != nil {
		t.Fatalf("ListUsers() error = %v", err)
	}

	for _, user := range users {
		if user.ID != userID {
			continue
		}
		if user.SubscriptionStatus != "expired" {
			t.Fatalf("SubscriptionStatus = %v, want expired", user.SubscriptionStatus)
		}
		return
	}

	t.Fatalf("user %s not found", userID)
}

func TestAdminRepository_GetStatsSkipsExpiredTrials(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewAdminRepository(queries)
	ctx := context.Background()

	activeTrialID := testkit.SeedUser(t, queries, "active-trial@example.com")
	expiredTrialID := testkit.SeedUser(t, queries, "expired-trial-stats@example.com")
	activeTrialEnds := time.Now().Add(24 * time.Hour)
	expiredTrialEnds := time.Now().Add(-24 * time.Hour)

	if _, err := sqlDB.ExecContext(
		ctx,
		"UPDATE users SET subscription_status = ?, trial_ends_at = ? WHERE id = ?",
		"trialing",
		activeTrialEnds,
		activeTrialID,
	); err != nil {
		t.Fatalf("failed to update active trial user: %v", err)
	}
	if _, err := sqlDB.ExecContext(
		ctx,
		"UPDATE users SET subscription_status = ?, trial_ends_at = ? WHERE id = ?",
		"trialing",
		expiredTrialEnds,
		expiredTrialID,
	); err != nil {
		t.Fatalf("failed to update expired trial user: %v", err)
	}

	stats, err := repo.GetStats(ctx)
	if err != nil {
		t.Fatalf("GetStats() error = %v", err)
	}
	if stats.TrialUsers != 1 {
		t.Fatalf("TrialUsers = %v, want 1", stats.TrialUsers)
	}
	if stats.ActiveUsers != 1 {
		t.Fatalf("ActiveUsers = %v, want 1", stats.ActiveUsers)
	}
}

func TestAdminRepository_ListSelfHostUsers(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, true)
	repo := sqlite.NewAdminRepository(queries)
	credRepo := sqlite.NewCredentialRepository(queries)
	ctx := context.Background()

	user1 := testkit.SeedUser(t, queries, "selfhost1@example.com")
	user2 := testkit.SeedUser(t, queries, "selfhost2@example.com")
	_ = credRepo.Create(ctx, user1, "hash1", true)
	_ = credRepo.Create(ctx, user2, "hash2", false)

	// Create space for user1
	testkit.SeedSpace(t, sqlDB, queries, user1, "User1 Space")

	users, err := repo.ListSelfHostUsers(ctx)
	if err != nil {
		t.Fatalf("ListSelfHostUsers() error = %v", err)
	}
	if len(users) < 2 {
		t.Errorf("ListSelfHostUsers() returned %d users, want >= 2", len(users))
	}

	// Find user1 and check fields
	var foundUser1 bool
	for _, user := range users {
		if user.ID == user1 {
			foundUser1 = true
			if !user.HasLocalPassword {
				t.Error("User1 HasLocalPassword = false, want true")
			}
			if !user.IsAdmin {
				t.Error("User1 IsAdmin = false, want true")
			}
			if user.OwnedSpaceCount < 1 {
				t.Errorf("User1 OwnedSpaceCount = %v, want >= 1", user.OwnedSpaceCount)
			}
		}
	}
	if !foundUser1 {
		t.Error("User1 not found in ListSelfHostUsers results")
	}
}

func TestAdminRepository_ListRecentUsers(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewAdminRepository(queries)
	ctx := context.Background()

	testkit.SeedUser(t, queries, "recent1@example.com")
	testkit.SeedUser(t, queries, "recent2@example.com")

	users, err := repo.ListRecentUsers(ctx)
	if err != nil {
		t.Fatalf("ListRecentUsers() error = %v", err)
	}
	if len(users) < 2 {
		t.Errorf("ListRecentUsers() returned %d users, want >= 2", len(users))
	}
}

func TestAdminRepository_ListUsersWithSubscription(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewAdminRepository(queries)
	ctx := context.Background()

	// Create user with subscription
	userID := testkit.SeedUser(t, queries, "subscriber@example.com")
	_, _ = sqlDB.ExecContext(ctx, "UPDATE users SET subscription_id = ? WHERE id = ?", "sub_123", userID)

	// Create user without subscription
	testkit.SeedUser(t, queries, "nosub@example.com")

	users, err := repo.ListUsersWithSubscription(ctx)
	if err != nil {
		t.Fatalf("ListUsersWithSubscription() error = %v", err)
	}
	if len(users) < 1 {
		t.Errorf("ListUsersWithSubscription() returned %d users, want >= 1", len(users))
	}

	// Verify subscriber is in list
	var foundSubscriber bool
	for _, user := range users {
		if user.ID == userID && user.SubscriptionID == "sub_123" {
			foundSubscriber = true
		}
	}
	if !foundSubscriber {
		t.Error("Subscriber not found in ListUsersWithSubscription results")
	}
}

func TestAdminRepository_UserMutationQueries(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewAdminRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "mutations@example.com")
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Mutation Space")

	firstID := testkit.SeedMutation(t, queries, spaceID, userID, 1, "payload-1")
	secondID := testkit.SeedMutation(t, queries, spaceID, userID, 2, "payload-2")

	firstDay := time.Date(2026, 3, 13, 8, 0, 0, 0, time.UTC)
	secondDay := time.Date(2026, 3, 14, 9, 30, 0, 0, time.UTC)
	if _, err := sqlDB.ExecContext(ctx, "UPDATE mutation_log SET timestamp = ?, op = ? WHERE id = ?", firstDay, "transactions.add", firstID); err != nil {
		t.Fatalf("failed to update first mutation: %v", err)
	}
	if _, err := sqlDB.ExecContext(ctx, "UPDATE mutation_log SET timestamp = ?, op = ? WHERE id = ?", secondDay, "transactions.add", secondID); err != nil {
		t.Fatalf("failed to update second mutation: %v", err)
	}

	total, err := repo.CountUserMutations(ctx, userID)
	if err != nil {
		t.Fatalf("CountUserMutations() error = %v", err)
	}
	if total != 2 {
		t.Fatalf("CountUserMutations() = %d, want 2", total)
	}

	lastMutation, err := repo.GetLastUserMutation(ctx, userID)
	if err != nil {
		t.Fatalf("GetLastUserMutation() error = %v", err)
	}
	if lastMutation == nil || lastMutation.ID != secondID {
		t.Fatalf("GetLastUserMutation() = %+v, want id %s", lastMutation, secondID)
	}

	days, err := repo.ListUserMutationDays(
		ctx,
		userID,
		time.Date(2026, 3, 12, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("ListUserMutationDays() error = %v", err)
	}
	if len(days) != 2 {
		t.Fatalf("ListUserMutationDays() returned %d rows, want 2", len(days))
	}
	if days[0].Day != "2026-03-13" || days[0].Count != 1 {
		t.Fatalf("first day = %+v, want 2026-03-13 count 1", days[0])
	}
	if days[1].Day != "2026-03-14" || days[1].Count != 1 {
		t.Fatalf("second day = %+v, want 2026-03-14 count 1", days[1])
	}
}

func TestAdminRepository_MigrateUserID(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	userRepo := sqlite.NewUserRepository(queries)
	repo := sqlite.NewAdminRepository(queries)
	ctx := context.Background()

	oldID := testkit.SeedUser(t, queries, "migrate@example.com")
	newID := testkit.GenerateID()

	err := repo.MigrateUserID(ctx, oldID, newID, "Migrated User", "migrated@example.com")
	if err != nil {
		t.Fatalf("MigrateUserID() error = %v", err)
	}

	// Old ID should not exist
	_, err = userRepo.GetByID(ctx, oldID)
	if err == nil {
		t.Error("GetByID(oldID) succeeded, want error")
	}

	// New ID should exist
	user, err := userRepo.GetByID(ctx, newID)
	if err != nil {
		t.Fatalf("GetByID(newID) error = %v", err)
	}
	if user.Name != "Migrated User" {
		t.Errorf("Name = %v, want Migrated User", user.Name)
	}
	if user.Email != "migrated@example.com" {
		t.Errorf("Email = %v, want migrated@example.com", user.Email)
	}
}

func TestAdminRepository_IsLocalAdmin(t *testing.T) {
	_, queries := testkit.NewTestDB(t, true)
	repo := sqlite.NewAdminRepository(queries)
	credRepo := sqlite.NewCredentialRepository(queries)
	ctx := context.Background()

	adminID := testkit.SeedUser(t, queries, "admin@example.com")
	nonAdminID := testkit.SeedUser(t, queries, "nonadmin@example.com")

	_ = credRepo.Create(ctx, adminID, "hash", true)
	_ = credRepo.Create(ctx, nonAdminID, "hash", false)

	isAdmin, err := repo.IsLocalAdmin(ctx, adminID)
	if err != nil {
		t.Fatalf("IsLocalAdmin(admin) error = %v", err)
	}
	if !isAdmin {
		t.Error("IsLocalAdmin(admin) = false, want true")
	}

	isAdmin, err = repo.IsLocalAdmin(ctx, nonAdminID)
	if err != nil {
		t.Fatalf("IsLocalAdmin(nonAdmin) error = %v", err)
	}
	if isAdmin {
		t.Error("IsLocalAdmin(nonAdmin) = true, want false")
	}
}

func TestAdminRepository_IsLocalAdmin_NoCredential(t *testing.T) {
	_, queries := testkit.NewTestDB(t, true)
	repo := sqlite.NewAdminRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "nocred@example.com")

	isAdmin, err := repo.IsLocalAdmin(ctx, userID)
	if err != nil {
		t.Fatalf("IsLocalAdmin() error = %v", err)
	}
	if isAdmin {
		t.Error("IsLocalAdmin() = true for user without credential, want false")
	}
}

func TestAdminRepository_RevokeAllAccess(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	userRepo := sqlite.NewUserRepository(queries)
	entitlementRepo := sqlite.NewEntitlementRepository(queries)
	repo := sqlite.NewAdminRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "revoke@example.com")

	// Grant some access
	_ = entitlementRepo.GrantFoundingMember(ctx, userID)
	_ = entitlementRepo.SetCollaborationAccess(ctx, userID, true)

	err := repo.RevokeAllAccess(ctx, userID)
	if err != nil {
		t.Fatalf("RevokeAllAccess() error = %v", err)
	}

	user, _ := userRepo.GetByID(ctx, userID)
	if user.IsFoundingMember {
		t.Error("IsFoundingMember = true after revoke, want false")
	}
	if user.HasCollaborationAccess {
		t.Error("HasCollaborationAccess = true after revoke, want false")
	}
}
