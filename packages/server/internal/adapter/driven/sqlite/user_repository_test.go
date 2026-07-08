package sqlite_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/sqlite"
	"budgero-server/internal/domain"
	"budgero-server/internal/testkit"
)

// Adapter integration tests: Real database, verify SQL works correctly

func TestUserRepository_Create(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	user := &domain.User{
		ID:                 testkit.GenerateID(),
		Name:               "Test User",
		Email:              "test@example.com",
		SubscriptionStatus: "trialing",
		CreatedAt:          time.Now(),
	}

	created, err := repo.Create(ctx, user)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if created.ID != user.ID {
		t.Errorf("Create() ID = %v, want %v", created.ID, user.ID)
	}
	if created.Email != user.Email {
		t.Errorf("Create() Email = %v, want %v", created.Email, user.Email)
	}
	if created.Name != user.Name {
		t.Errorf("Create() Name = %v, want %v", created.Name, user.Name)
	}
}

func TestUserRepository_Create_DuplicateEmail(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	email := "duplicate@example.com"

	// Create first user
	user1 := &domain.User{
		ID:    testkit.GenerateID(),
		Name:  "User 1",
		Email: email,
	}
	_, err := repo.Create(ctx, user1)
	if err != nil {
		t.Fatalf("Create() first user error = %v", err)
	}

	// Try to create second user with same email
	user2 := &domain.User{
		ID:    testkit.GenerateID(),
		Name:  "User 2",
		Email: email,
	}
	_, err = repo.Create(ctx, user2)
	if !errors.Is(err, domain.ErrEmailAlreadyExists) {
		t.Errorf("Create() error = %v, want ErrEmailAlreadyExists", err)
	}
}

func TestUserRepository_GetByID(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	// Seed a user
	userID := testkit.SeedUser(t, queries, "getbyid@example.com")

	// Retrieve by ID
	user, err := repo.GetByID(ctx, userID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}

	if user.ID != userID {
		t.Errorf("GetByID() ID = %v, want %v", user.ID, userID)
	}
	if user.Email != "getbyid@example.com" {
		t.Errorf("GetByID() Email = %v, want getbyid@example.com", user.Email)
	}
}

func TestUserRepository_GetByID_NotFound(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	_, err := repo.GetByID(ctx, "nonexistent")
	if !errors.Is(err, domain.ErrUserNotFound) {
		t.Errorf("expected ErrUserNotFound, got %v", err)
	}
}

func TestUserRepository_GetByEmail(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	email := "getbyemail@example.com"
	userID := testkit.SeedUser(t, queries, email)

	user, err := repo.GetByEmail(ctx, email)
	if err != nil {
		t.Fatalf("GetByEmail() error = %v", err)
	}

	if user.ID != userID {
		t.Errorf("GetByEmail() ID = %v, want %v", user.ID, userID)
	}
	if user.Email != email {
		t.Errorf("GetByEmail() Email = %v, want %v", user.Email, email)
	}
}

func TestUserRepository_GetByEmail_NotFound(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	_, err := repo.GetByEmail(ctx, "nonexistent@example.com")
	if !errors.Is(err, domain.ErrUserNotFound) {
		t.Errorf("expected ErrUserNotFound, got %v", err)
	}
}

func TestUserRepository_GetByCustomerID(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	// Seed user and set customer ID via raw SQL
	userID := testkit.SeedUser(t, queries, "customer@example.com")
	customerID := "cust_12345"
	_, err := sqlDB.ExecContext(ctx, "UPDATE users SET customer_id = ? WHERE id = ?", customerID, userID)
	if err != nil {
		t.Fatalf("failed to set customer_id: %v", err)
	}

	user, err := repo.GetByCustomerID(ctx, customerID)
	if err != nil {
		t.Fatalf("GetByCustomerID() error = %v", err)
	}

	if user.ID != userID {
		t.Errorf("GetByCustomerID() ID = %v, want %v", user.ID, userID)
	}
}

func TestUserRepository_GetByCustomerID_NotFound(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	_, err := repo.GetByCustomerID(ctx, "nonexistent_customer")
	if !errors.Is(err, domain.ErrUserNotFound) {
		t.Errorf("expected ErrUserNotFound, got %v", err)
	}
}

func TestUserRepository_Update(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "update@example.com")

	// Update name and email
	newName := "Updated Name"
	newEmail := "updated@example.com"
	err := repo.Update(ctx, userID, newName, newEmail)
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	// Verify update
	user, err := repo.GetByID(ctx, userID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}
	if user.Name != newName {
		t.Errorf("Update() Name = %v, want %v", user.Name, newName)
	}
	if user.Email != newEmail {
		t.Errorf("Update() Email = %v, want %v", user.Email, newEmail)
	}
}

func TestUserRepository_Update_DuplicateEmail(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	// Create two users
	testkit.SeedUser(t, queries, "existing@example.com")
	userID2 := testkit.SeedUser(t, queries, "toupdate@example.com")

	// Try to update second user to use first user's email
	err := repo.Update(ctx, userID2, "Name", "existing@example.com")
	if !errors.Is(err, domain.ErrEmailAlreadyExists) {
		t.Errorf("Update() error = %v, want ErrEmailAlreadyExists", err)
	}
}

func TestUserRepository_Delete(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "delete@example.com")

	// Delete user
	err := repo.Delete(ctx, userID)
	if err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	// Verify deleted
	_, err = repo.GetByID(ctx, userID)
	if !errors.Is(err, domain.ErrUserNotFound) {
		t.Errorf("expected ErrUserNotFound after delete, got %v", err)
	}
}

func TestUserRepository_SetBlocked(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "block@example.com")

	// Block user
	err := repo.SetBlocked(ctx, userID, true)
	if err != nil {
		t.Fatalf("SetBlocked(true) error = %v", err)
	}

	// Verify blocked
	blocked, err := repo.IsBlocked(ctx, userID)
	if err != nil {
		t.Fatalf("IsBlocked() error = %v", err)
	}
	if !blocked {
		t.Error("IsBlocked() = false, want true")
	}

	// Unblock user
	err = repo.SetBlocked(ctx, userID, false)
	if err != nil {
		t.Fatalf("SetBlocked(false) error = %v", err)
	}

	// Verify unblocked
	blocked, err = repo.IsBlocked(ctx, userID)
	if err != nil {
		t.Fatalf("IsBlocked() error = %v", err)
	}
	if blocked {
		t.Error("IsBlocked() = true, want false")
	}
}

func TestUserRepository_IsBlocked_NotFound(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	_, err := repo.IsBlocked(ctx, "nonexistent")
	if !errors.Is(err, domain.ErrUserNotFound) {
		t.Errorf("IsBlocked() error = %v, want ErrUserNotFound", err)
	}
}

func TestUserRepository_SetMasterPasswordStatus(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "password@example.com")

	// Set master password as configured
	err := repo.SetMasterPasswordStatus(ctx, userID, true)
	if err != nil {
		t.Fatalf("SetMasterPasswordStatus(true) error = %v", err)
	}

	// Verify status
	user, err := repo.GetByID(ctx, userID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}
	if !user.IsMasterPasswordSet {
		t.Error("IsMasterPasswordSet = false, want true")
	}

	// Unset master password
	err = repo.SetMasterPasswordStatus(ctx, userID, false)
	if err != nil {
		t.Fatalf("SetMasterPasswordStatus(false) error = %v", err)
	}

	// Verify status
	user, err = repo.GetByID(ctx, userID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}
	if user.IsMasterPasswordSet {
		t.Error("IsMasterPasswordSet = true, want false")
	}
}

func TestUserRepository_SetOnboardingState(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "onboarding@example.com")

	completedAt := time.Now()
	snoozedUntil := time.Now().Add(24 * time.Hour)

	err := repo.SetOnboardingState(ctx, userID, "completed", &completedAt, &snoozedUntil)
	if err != nil {
		t.Fatalf("SetOnboardingState() error = %v", err)
	}

	// Verify state
	user, err := repo.GetByID(ctx, userID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}
	if user.OnboardingStatus != "completed" {
		t.Errorf("OnboardingStatus = %v, want completed", user.OnboardingStatus)
	}
	if user.OnboardingCompletedAt == nil {
		t.Error("OnboardingCompletedAt = nil, want non-nil")
	}
	if user.OnboardingSnoozedUntil == nil {
		t.Error("OnboardingSnoozedUntil = nil, want non-nil")
	}
}

func TestUserRepository_SetOnboardingState_NilDates(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "onboarding2@example.com")

	err := repo.SetOnboardingState(ctx, userID, "in_progress", nil, nil)
	if err != nil {
		t.Fatalf("SetOnboardingState() error = %v", err)
	}

	user, err := repo.GetByID(ctx, userID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}
	if user.OnboardingStatus != "in_progress" {
		t.Errorf("OnboardingStatus = %v, want in_progress", user.OnboardingStatus)
	}
}

func TestUserRepository_UpdateBackupSettings(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "backup@example.com")

	frequencyDays := 7
	lastBackup := time.Now()

	err := repo.UpdateBackupSettings(ctx, userID, frequencyDays, &lastBackup)
	if err != nil {
		t.Fatalf("UpdateBackupSettings() error = %v", err)
	}

	// Verify settings
	user, err := repo.GetByID(ctx, userID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}
	if user.BackupReminderFrequencyDays != frequencyDays {
		t.Errorf("BackupReminderFrequencyDays = %v, want %v", user.BackupReminderFrequencyDays, frequencyDays)
	}
	if user.LastUserDBBackup == nil {
		t.Error("LastUserDBBackup = nil, want non-nil")
	}
}

func TestUserRepository_UpdateBackupSettings_NilLastBackup(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "backup2@example.com")

	err := repo.UpdateBackupSettings(ctx, userID, 14, nil)
	if err != nil {
		t.Fatalf("UpdateBackupSettings() error = %v", err)
	}

	user, err := repo.GetByID(ctx, userID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}
	if user.BackupReminderFrequencyDays != 14 {
		t.Errorf("BackupReminderFrequencyDays = %v, want 14", user.BackupReminderFrequencyDays)
	}
}

func TestUserRepository_ResetUserData(t *testing.T) {
	sqlDB, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "reset@example.com")

	// Set some data first
	_ = repo.SetMasterPasswordStatus(ctx, userID, true)
	_ = repo.UpdateBackupSettings(ctx, userID, 30, nil)

	// Also set a primary space
	spaceID := testkit.SeedSpace(t, sqlDB, queries, userID, "Test Space")
	_, _ = sqlDB.ExecContext(ctx, "UPDATE users SET primary_space_id = ? WHERE id = ?", spaceID, userID)

	// Reset user data
	err := repo.ResetUserData(ctx, userID)
	if err != nil {
		t.Fatalf("ResetUserData() error = %v", err)
	}

	// Verify reset
	user, err := repo.GetByID(ctx, userID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}
	if user.IsMasterPasswordSet {
		t.Error("IsMasterPasswordSet = true after reset, want false")
	}
	// Primary space should be cleared
	if user.PrimarySpaceID != "" {
		t.Errorf("PrimarySpaceID = %v after reset, want empty", user.PrimarySpaceID)
	}
}

func TestUserRepository_UserPreferences(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "prefs@example.com")

	// Missing row should not error.
	missing, err := repo.GetPreferences(ctx, userID)
	if err != nil {
		t.Fatalf("GetPreferences() missing row error = %v", err)
	}
	if missing != nil {
		t.Fatalf("GetPreferences() missing row = %#v, want nil", missing)
	}

	// Upsert and verify retrieval.
	err = repo.UpsertPreferences(ctx, &domain.UserPreferences{
		UserID:              userID,
		ThemeMode:           "dark",
		ThemePreset:         "obsidian",
		ClassicFont:         "roboto",
		HomePage:            "planning",
		DesktopBudgetLayout: "compact",
		CompactMobileLayout: true,
		MobileBudgetLayout:  "table",
	})
	if err != nil {
		t.Fatalf("UpsertPreferences() error = %v", err)
	}

	prefs, err := repo.GetPreferences(ctx, userID)
	if err != nil {
		t.Fatalf("GetPreferences() error = %v", err)
	}
	if prefs == nil {
		t.Fatal("GetPreferences() = nil, want non-nil")
		return
	}
	if prefs.ThemeMode != "dark" {
		t.Errorf("ThemeMode = %v, want dark", prefs.ThemeMode)
	}
	if prefs.ThemePreset != "obsidian" {
		t.Errorf("ThemePreset = %v, want obsidian", prefs.ThemePreset)
	}
	if prefs.HomePage != "planning" {
		t.Errorf("HomePage = %v, want planning", prefs.HomePage)
	}
	if !prefs.CompactMobileLayout {
		t.Errorf("CompactMobileLayout = false, want true")
	}
}
