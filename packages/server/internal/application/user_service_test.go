package application_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/fake"
	"budgero-server/internal/application"
	"budgero-server/internal/config"
	"budgero-server/internal/domain"
)

func TestUserService_Create(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name          string
		userID        string
		userName      string
		email         string
		trialDays     int
		wantTrialDays int
	}{
		{
			name:          "create user with default trial",
			userID:        "user1",
			userName:      "John Doe",
			email:         "john@example.com",
			trialDays:     0, // use default
			wantTrialDays: 35,
		},
		{
			name:          "create user with custom trial",
			userID:        "user2",
			userName:      "Jane Doe",
			email:         "jane@example.com",
			trialDays:     30,
			wantTrialDays: 30,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userRepo := fake.NewUserRepository()
			spaceRepo := fake.NewSpaceRepository()

			cfg := &config.Config{}
			if tt.trialDays > 0 {
				cfg.Features.TrialDurationDays = tt.trialDays
			}

			svc := application.NewUserService(userRepo, spaceRepo, cfg)
			user, err := svc.Create(ctx, tt.userID, tt.userName, tt.email)

			if err != nil {
				t.Fatalf("Create() error = %v", err)
			}

			if user.ID != tt.userID {
				t.Errorf("ID = %v, want %v", user.ID, tt.userID)
			}
			if user.Name != tt.userName {
				t.Errorf("Name = %v, want %v", user.Name, tt.userName)
			}
			if user.Email != tt.email {
				t.Errorf("Email = %v, want %v", user.Email, tt.email)
			}
			if user.SubscriptionStatus != "trialing" {
				t.Errorf("SubscriptionStatus = %v, want trialing", user.SubscriptionStatus)
			}
			if user.TrialEndsAt == nil {
				t.Fatal("TrialEndsAt should not be nil")
			}

			// Check trial duration is approximately correct
			expectedEnd := time.Now().Add(time.Duration(tt.wantTrialDays) * 24 * time.Hour)
			diff := user.TrialEndsAt.Sub(expectedEnd)
			if diff > time.Minute || diff < -time.Minute {
				t.Errorf("TrialEndsAt diff from expected: %v", diff)
			}
		})
	}
}

func TestUserService_GetByID(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name    string
		userID  string
		setup   func(*fake.UserRepository)
		wantErr error
	}{
		{
			name:   "get existing user",
			userID: "user1",
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{ID: "user1", Name: "John", Email: "john@example.com"})
			},
			wantErr: nil,
		},
		{
			name:    "get non-existing user returns error",
			userID:  "missing",
			setup:   func(r *fake.UserRepository) {},
			wantErr: domain.ErrUserNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userRepo := fake.NewUserRepository()
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(userRepo)

			svc := application.NewUserService(userRepo, spaceRepo, &config.Config{})
			user, err := svc.GetByID(ctx, tt.userID)

			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("GetByID() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("GetByID() unexpected error: %v", err)
			}
			if user.ID != tt.userID {
				t.Errorf("ID = %v, want %v", user.ID, tt.userID)
			}
		})
	}
}

func TestUserService_Block(t *testing.T) {
	ctx := context.Background()

	userRepo := fake.NewUserRepository()
	spaceRepo := fake.NewSpaceRepository()
	_, _ = userRepo.Create(ctx, &domain.User{ID: "user1", IsBlocked: false})

	svc := application.NewUserService(userRepo, spaceRepo, &config.Config{})

	// Block user
	if err := svc.Block(ctx, "user1", true); err != nil {
		t.Fatalf("Block() error = %v", err)
	}

	blocked, err := svc.IsBlocked(ctx, "user1")
	if err != nil {
		t.Fatalf("IsBlocked() error = %v", err)
	}
	if !blocked {
		t.Error("Expected user to be blocked")
	}

	// Unblock user
	if blockErr := svc.Block(ctx, "user1", false); blockErr != nil {
		t.Fatalf("Block(false) error = %v", blockErr)
	}

	blocked, err = svc.IsBlocked(ctx, "user1")
	if err != nil {
		t.Fatalf("IsBlocked() error = %v", err)
	}
	if blocked {
		t.Error("Expected user to be unblocked")
	}
}

func TestUserService_UpdateBackupSettings(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name          string
		frequencyDays *int
		wantFrequency int
	}{
		{
			name:          "set valid frequency",
			frequencyDays: intPtr(30),
			wantFrequency: 30,
		},
		{
			name:          "negative frequency becomes 0",
			frequencyDays: intPtr(-5),
			wantFrequency: 0,
		},
		{
			name:          "frequency over 365 capped",
			frequencyDays: intPtr(500),
			wantFrequency: 365,
		},
		{
			name:          "nil frequency preserves existing value",
			frequencyDays: nil,
			wantFrequency: 7,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userRepo := fake.NewUserRepository()
			spaceRepo := fake.NewSpaceRepository()
			_, _ = userRepo.Create(ctx, &domain.User{ID: "user1", BackupReminderFrequencyDays: 7})

			svc := application.NewUserService(userRepo, spaceRepo, &config.Config{})
			user, err := svc.UpdateBackupSettings(ctx, "user1", tt.frequencyDays, nil)

			if err != nil {
				t.Fatalf("UpdateBackupSettings() error = %v", err)
			}

			if user.BackupReminderFrequencyDays != tt.wantFrequency {
				t.Errorf("BackupReminderFrequencyDays = %v, want %v", user.BackupReminderFrequencyDays, tt.wantFrequency)
			}
		})
	}
}

func TestUserService_UpdateBackupSettings_PreservesLastBackupWhenFrequencyChanges(t *testing.T) {
	ctx := context.Background()

	userRepo := fake.NewUserRepository()
	spaceRepo := fake.NewSpaceRepository()
	existingBackup := time.Now().Add(-2 * time.Hour).UTC()
	_, _ = userRepo.Create(ctx, &domain.User{
		ID:                          "user1",
		BackupReminderFrequencyDays: 7,
		LastUserDBBackup:            &existingBackup,
	})

	svc := application.NewUserService(userRepo, spaceRepo, &config.Config{})
	user, err := svc.UpdateBackupSettings(ctx, "user1", intPtr(30), nil)
	if err != nil {
		t.Fatalf("UpdateBackupSettings() error = %v", err)
	}

	if user.BackupReminderFrequencyDays != 30 {
		t.Errorf("BackupReminderFrequencyDays = %v, want 30", user.BackupReminderFrequencyDays)
	}
	if user.LastUserDBBackup == nil {
		t.Fatalf("LastUserDBBackup = nil, want preserved timestamp")
	}
	if !user.LastUserDBBackup.Equal(existingBackup) {
		t.Errorf("LastUserDBBackup = %v, want %v", user.LastUserDBBackup, existingBackup)
	}
}

func TestUserService_UpdateBackupSettings_PreservesFrequencyWhenRecordingBackup(t *testing.T) {
	ctx := context.Background()

	userRepo := fake.NewUserRepository()
	spaceRepo := fake.NewSpaceRepository()
	_, _ = userRepo.Create(ctx, &domain.User{
		ID:                          "user1",
		BackupReminderFrequencyDays: 30,
	})

	recordedBackup := time.Now().UTC()
	svc := application.NewUserService(userRepo, spaceRepo, &config.Config{})
	user, err := svc.UpdateBackupSettings(ctx, "user1", nil, &recordedBackup)
	if err != nil {
		t.Fatalf("UpdateBackupSettings() error = %v", err)
	}

	if user.BackupReminderFrequencyDays != 30 {
		t.Errorf("BackupReminderFrequencyDays = %v, want 30", user.BackupReminderFrequencyDays)
	}
	if user.LastUserDBBackup == nil {
		t.Fatalf("LastUserDBBackup = nil, want recorded timestamp")
	}
	if !user.LastUserDBBackup.Equal(recordedBackup) {
		t.Errorf("LastUserDBBackup = %v, want %v", user.LastUserDBBackup, recordedBackup)
	}
}

func TestUserService_Delete(t *testing.T) {
	ctx := context.Background()

	userRepo := fake.NewUserRepository()
	spaceRepo := fake.NewSpaceRepository()
	_, _ = userRepo.Create(ctx, &domain.User{ID: "user1", Name: "John"})

	svc := application.NewUserService(userRepo, spaceRepo, &config.Config{})

	if err := svc.Delete(ctx, "user1"); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	// Verify user is gone
	_, err := svc.GetByID(ctx, "user1")
	if !errors.Is(err, domain.ErrUserNotFound) {
		t.Errorf("Expected ErrUserNotFound after delete, got %v", err)
	}
}

func TestUserService_UpdatePreferences(t *testing.T) {
	ctx := context.Background()

	userRepo := fake.NewUserRepository()
	spaceRepo := fake.NewSpaceRepository()
	_, _ = userRepo.Create(ctx, &domain.User{ID: "user1", Email: "prefs@example.com"})

	svc := application.NewUserService(userRepo, spaceRepo, &config.Config{})

	prefs, err := svc.UpdatePreferences(ctx, "user1", domain.UserPreferencesPatch{
		ThemeMode:           strPtr("dark"),
		ThemePreset:         strPtr("obsidian"),
		HomePage:            strPtr("planning"),
		DesktopBudgetLayout: strPtr("compact"),
		CompactMobileLayout: boolPtr(true),
		MobileBudgetLayout:  strPtr("table"),
	})
	if err != nil {
		t.Fatalf("UpdatePreferences() error = %v", err)
	}

	if prefs.ThemeMode != "dark" {
		t.Errorf("ThemeMode = %v, want dark", prefs.ThemeMode)
	}
	if prefs.HomePage != "planning" {
		t.Errorf("HomePage = %v, want planning", prefs.HomePage)
	}
	if !prefs.CompactMobileLayout {
		t.Errorf("CompactMobileLayout = false, want true")
	}

	_, err = svc.UpdatePreferences(ctx, "user1", domain.UserPreferencesPatch{
		ThemeMode: strPtr("broken"),
	})
	if !errors.Is(err, domain.ErrInvalidUserPreferences) {
		t.Errorf("UpdatePreferences() error = %v, want ErrInvalidUserPreferences", err)
	}
}

func TestUserService_GetPreferences_Defaults(t *testing.T) {
	ctx := context.Background()

	userRepo := fake.NewUserRepository()
	spaceRepo := fake.NewSpaceRepository()
	_, _ = userRepo.Create(ctx, &domain.User{ID: "user1", Email: "defaults@example.com"})

	svc := application.NewUserService(userRepo, spaceRepo, &config.Config{})
	prefs, err := svc.GetPreferences(ctx, "user1")
	if err != nil {
		t.Fatalf("GetPreferences() error = %v", err)
	}

	if prefs.ThemeMode != "system" {
		t.Errorf("ThemeMode = %v, want system", prefs.ThemeMode)
	}
	if prefs.ThemePreset != "paper" {
		t.Errorf("ThemePreset = %v, want paper", prefs.ThemePreset)
	}
	if prefs.HomePage != "planning" {
		t.Errorf("HomePage = %v, want planning", prefs.HomePage)
	}
}

func intPtr(i int) *int {
	return &i
}

func strPtr(s string) *string {
	return &s
}

func boolPtr(v bool) *bool {
	return &v
}
