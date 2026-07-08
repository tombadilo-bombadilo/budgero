package application_test

import (
	"context"
	"errors"
	"testing"

	"budgero-server/internal/adapter/driven/fake"
	"budgero-server/internal/application"
	"budgero-server/internal/config"
	"budgero-server/internal/domain"
)

func TestCredentialService_CreateAndVerify(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name           string
		userID         string
		password       string
		isAdmin        bool
		verifyPassword string
		wantVerifyErr  bool
	}{
		{
			name:           "create and verify correct password",
			userID:         "user1",
			password:       "SecurePass123",
			isAdmin:        false,
			verifyPassword: "SecurePass123",
			wantVerifyErr:  false,
		},
		{
			name:           "create and verify wrong password",
			userID:         "user2",
			password:       "SecurePass123",
			isAdmin:        false,
			verifyPassword: "WrongPassword",
			wantVerifyErr:  true,
		},
		{
			name:           "create admin and verify",
			userID:         "admin1",
			password:       "AdminPass123",
			isAdmin:        true,
			verifyPassword: "AdminPass123",
			wantVerifyErr:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			credRepo := fake.NewCredentialRepository()
			svc := application.NewCredentialService(credRepo, &config.Config{})

			// Create credential
			err := svc.Create(ctx, tt.userID, tt.password, tt.isAdmin)
			if err != nil {
				t.Fatalf("Create() error = %v", err)
			}

			// Verify password
			err = svc.Verify(ctx, tt.userID, tt.verifyPassword)
			if tt.wantVerifyErr {
				if err == nil {
					t.Error("Verify() expected error, got nil")
				}
			} else {
				if err != nil {
					t.Errorf("Verify() unexpected error = %v", err)
				}
			}

			// Check admin status
			if svc.IsAdmin(ctx, tt.userID) != tt.isAdmin {
				t.Errorf("IsAdmin() = %v, want %v", svc.IsAdmin(ctx, tt.userID), tt.isAdmin)
			}
		})
	}
}

func TestCredentialService_Verify_NonExistentUser(t *testing.T) {
	ctx := context.Background()
	credRepo := fake.NewCredentialRepository()
	svc := application.NewCredentialService(credRepo, &config.Config{})

	err := svc.Verify(ctx, "nonexistent", "password")
	if !errors.Is(err, domain.ErrInvalidCredentials) {
		t.Errorf("Verify() error = %v, want %v", err, domain.ErrInvalidCredentials)
	}
}

func TestCredentialService_SetPassword_Validation(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name     string
		password string
		wantErr  string
	}{
		{
			name:     "password too short",
			password: "Ab1",
			wantErr:  "password too short",
		},
		{
			name:     "password missing uppercase",
			password: "abcdefgh1",
			wantErr:  "password must contain uppercase, lowercase, and digit",
		},
		{
			name:     "password missing lowercase",
			password: "ABCDEFGH1",
			wantErr:  "password must contain uppercase, lowercase, and digit",
		},
		{
			name:     "password missing digit",
			password: "AbcDefGhi",
			wantErr:  "password must contain uppercase, lowercase, and digit",
		},
		{
			name:     "valid password",
			password: "SecurePass123",
			wantErr:  "",
		},
		{
			name:     "minimum valid password",
			password: "Abcdefg1",
			wantErr:  "",
		},
		{
			name:     "password with special chars",
			password: "P@ssw0rd!",
			wantErr:  "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			credRepo := fake.NewCredentialRepository()
			svc := application.NewCredentialService(credRepo, &config.Config{})

			err := svc.SetPassword(ctx, "user1", tt.password, false)

			if tt.wantErr != "" {
				if err == nil {
					t.Error("SetPassword() expected error, got nil")
					return
				}
				if err.Error() != tt.wantErr {
					t.Errorf("SetPassword() error = %v, want %v", err.Error(), tt.wantErr)
				}
			} else if err != nil {
				t.Errorf("SetPassword() unexpected error = %v", err)
			}
		})
	}
}

func TestCredentialService_ResetPassword_PreservesAdminStatus(t *testing.T) {
	ctx := context.Background()
	credRepo := fake.NewCredentialRepository()
	svc := application.NewCredentialService(credRepo, &config.Config{})

	// Create admin user
	err := svc.Create(ctx, "admin1", "OldPassword123", true)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	// Verify is admin
	if !svc.IsAdmin(ctx, "admin1") {
		t.Error("Expected user to be admin before reset")
	}

	// Reset password
	err = svc.ResetPassword(ctx, "admin1", "NewPassword123")
	if err != nil {
		t.Fatalf("ResetPassword() error = %v", err)
	}

	// Verify still admin after reset
	if !svc.IsAdmin(ctx, "admin1") {
		t.Error("Expected user to still be admin after password reset")
	}

	// Verify new password works
	err = svc.Verify(ctx, "admin1", "NewPassword123")
	if err != nil {
		t.Errorf("Verify() with new password failed: %v", err)
	}

	// Verify old password no longer works
	err = svc.Verify(ctx, "admin1", "OldPassword123")
	if err == nil {
		t.Error("Verify() with old password should fail")
	}
}

func TestCredentialService_SetAdmin(t *testing.T) {
	ctx := context.Background()
	credRepo := fake.NewCredentialRepository()
	svc := application.NewCredentialService(credRepo, &config.Config{})

	// Create regular user
	err := svc.Create(ctx, "user1", "Password123", false)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	// Verify not admin
	if svc.IsAdmin(ctx, "user1") {
		t.Error("Expected user to not be admin initially")
	}

	// Promote to admin
	err = svc.SetAdmin(ctx, "user1", true)
	if err != nil {
		t.Fatalf("SetAdmin() error = %v", err)
	}

	// Verify is now admin
	if !svc.IsAdmin(ctx, "user1") {
		t.Error("Expected user to be admin after promotion")
	}

	// Demote from admin
	err = svc.SetAdmin(ctx, "user1", false)
	if err != nil {
		t.Fatalf("SetAdmin(false) error = %v", err)
	}

	// Verify no longer admin
	if svc.IsAdmin(ctx, "user1") {
		t.Error("Expected user to not be admin after demotion")
	}
}

func TestCredentialService_UpdatePassword(t *testing.T) {
	ctx := context.Background()
	credRepo := fake.NewCredentialRepository()
	svc := application.NewCredentialService(credRepo, &config.Config{})

	// Create user
	err := svc.Create(ctx, "user1", "OldPassword123", false)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	// Update password (no validation in UpdatePassword)
	err = svc.UpdatePassword(ctx, "user1", "NewPassword")
	if err != nil {
		t.Fatalf("UpdatePassword() error = %v", err)
	}

	// Verify new password works
	err = svc.Verify(ctx, "user1", "NewPassword")
	if err != nil {
		t.Errorf("Verify() with new password failed: %v", err)
	}
}

func TestCredentialService_IsAdmin_NonExistentUser(t *testing.T) {
	ctx := context.Background()
	credRepo := fake.NewCredentialRepository()
	svc := application.NewCredentialService(credRepo, &config.Config{})

	// Non-existent user should return false for IsAdmin
	if svc.IsAdmin(ctx, "nonexistent") {
		t.Error("IsAdmin() for non-existent user should return false")
	}
}

func TestCredentialService_MarkLogin(t *testing.T) {
	ctx := context.Background()
	credRepo := fake.NewCredentialRepository()
	svc := application.NewCredentialService(credRepo, &config.Config{})

	// Create user
	err := svc.Create(ctx, "user1", "Password123", false)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	// Get credential before login
	cred, err := svc.Get(ctx, "user1")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if cred.LastLoginAt != nil {
		t.Error("LastLoginAt should be nil before first login mark")
	}

	// Mark login
	err = svc.MarkLogin(ctx, "user1")
	if err != nil {
		t.Fatalf("MarkLogin() error = %v", err)
	}

	// Get credential after login
	cred, err = svc.Get(ctx, "user1")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if cred.LastLoginAt == nil {
		t.Error("LastLoginAt should be set after MarkLogin")
	}
}

func TestCredentialService_Get_NotFound(t *testing.T) {
	ctx := context.Background()
	credRepo := fake.NewCredentialRepository()
	svc := application.NewCredentialService(credRepo, &config.Config{})

	_, err := svc.Get(ctx, "nonexistent")
	if !errors.Is(err, domain.ErrCredentialNotFound) {
		t.Errorf("Get() error = %v, want %v", err, domain.ErrCredentialNotFound)
	}
}
