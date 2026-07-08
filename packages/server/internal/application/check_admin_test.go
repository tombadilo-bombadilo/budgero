package application_test

import (
	"context"
	"testing"

	"budgero-server/internal/adapter/driven/fake"
	"budgero-server/internal/application"
	"budgero-server/internal/config"
	"budgero-server/internal/domain"
)

func TestCheckAdminUsecase_CloudMode_AdminEmail(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	credRepo := fake.NewCredentialRepository()
	adminRepo := fake.NewAdminRepository(userRepo, credRepo)
	userSvc := application.NewUserService(userRepo, fake.NewSpaceRepository(), nil)
	adminSvc := application.NewAdminService(adminRepo)

	cfg := &config.Config{
		Auth: config.AuthConfig{
			SelfHostable: false,
			AdminEmails:  []string{"admin@example.com", "superadmin@example.com"},
		},
	}

	uc := application.NewCheckAdminUsecase(userSvc, adminSvc, cfg)

	// Create admin user
	_, _ = userRepo.Create(ctx, &domain.User{
		ID:    "admin1",
		Email: "admin@example.com",
	})

	isAdmin, err := uc.Execute(ctx, "admin1")
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if !isAdmin {
		t.Error("Execute() = false, want true for admin email")
	}
}

func TestCheckAdminUsecase_CloudMode_NotAdmin(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	credRepo := fake.NewCredentialRepository()
	adminRepo := fake.NewAdminRepository(userRepo, credRepo)
	userSvc := application.NewUserService(userRepo, fake.NewSpaceRepository(), nil)
	adminSvc := application.NewAdminService(adminRepo)

	cfg := &config.Config{
		Auth: config.AuthConfig{
			SelfHostable: false,
			AdminEmails:  []string{"admin@example.com"},
		},
	}

	uc := application.NewCheckAdminUsecase(userSvc, adminSvc, cfg)

	// Create regular user
	_, _ = userRepo.Create(ctx, &domain.User{
		ID:    "user1",
		Email: "user@example.com",
	})

	isAdmin, err := uc.Execute(ctx, "user1")
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if isAdmin {
		t.Error("Execute() = true, want false for non-admin email")
	}
}

func TestCheckAdminUsecase_SelfHostMode_LocalAdmin(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	credRepo := fake.NewCredentialRepository()
	adminRepo := fake.NewAdminRepository(userRepo, credRepo)
	userSvc := application.NewUserService(userRepo, fake.NewSpaceRepository(), nil)
	adminSvc := application.NewAdminService(adminRepo)

	cfg := &config.Config{
		Auth: config.AuthConfig{
			SelfHostable: true,
		},
	}

	uc := application.NewCheckAdminUsecase(userSvc, adminSvc, cfg)

	// Create user with local admin credentials
	_, _ = userRepo.Create(ctx, &domain.User{
		ID:    "admin1",
		Email: "admin@example.com",
	})
	_ = credRepo.Create(ctx, "admin1", "hash", true)

	isAdmin, err := uc.Execute(ctx, "admin1")
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if !isAdmin {
		t.Error("Execute() = false, want true for local admin")
	}
}

func TestCheckAdminUsecase_SelfHostMode_NotLocalAdmin(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	credRepo := fake.NewCredentialRepository()
	adminRepo := fake.NewAdminRepository(userRepo, credRepo)
	userSvc := application.NewUserService(userRepo, fake.NewSpaceRepository(), nil)
	adminSvc := application.NewAdminService(adminRepo)

	cfg := &config.Config{
		Auth: config.AuthConfig{
			SelfHostable: true,
		},
	}

	uc := application.NewCheckAdminUsecase(userSvc, adminSvc, cfg)

	// Create user without admin credentials
	_, _ = userRepo.Create(ctx, &domain.User{
		ID:    "user1",
		Email: "user@example.com",
	})
	_ = credRepo.Create(ctx, "user1", "hash", false)

	isAdmin, err := uc.Execute(ctx, "user1")
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if isAdmin {
		t.Error("Execute() = true, want false for non-admin user")
	}
}

func TestCheckAdminUsecase_UserNotFound(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	credRepo := fake.NewCredentialRepository()
	adminRepo := fake.NewAdminRepository(userRepo, credRepo)
	userSvc := application.NewUserService(userRepo, fake.NewSpaceRepository(), nil)
	adminSvc := application.NewAdminService(adminRepo)

	cfg := &config.Config{
		Auth: config.AuthConfig{
			SelfHostable: false,
			AdminEmails:  []string{"admin@example.com"},
		},
	}

	uc := application.NewCheckAdminUsecase(userSvc, adminSvc, cfg)

	_, err := uc.Execute(ctx, "nonexistent")
	if err == nil {
		t.Error("Execute() expected error for non-existent user")
	}
}
