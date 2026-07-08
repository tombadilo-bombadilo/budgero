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

func TestCreateLocalUserUsecase_Execute(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name        string
		setup       func(*fake.UserRepository)
		userName    string
		email       string
		password    string
		isAdmin     bool
		wantErr     bool
		wantErrText string
	}{
		{
			name:     "create user successfully",
			setup:    func(ur *fake.UserRepository) {},
			userName: "Test User",
			email:    "test@example.com",
			password: "SecurePass123",
			isAdmin:  false,
			wantErr:  false,
		},
		{
			name:     "create admin user",
			setup:    func(ur *fake.UserRepository) {},
			userName: "Admin User",
			email:    "admin@example.com",
			password: "AdminPass123",
			isAdmin:  true,
			wantErr:  false,
		},
		{
			name:        "empty email fails",
			setup:       func(ur *fake.UserRepository) {},
			userName:    "Test User",
			email:       "",
			password:    "SecurePass123",
			isAdmin:     false,
			wantErr:     true,
			wantErrText: "email required",
		},
		{
			name:        "whitespace-only email fails",
			setup:       func(ur *fake.UserRepository) {},
			userName:    "Test User",
			email:       "   ",
			password:    "SecurePass123",
			isAdmin:     false,
			wantErr:     true,
			wantErrText: "email required",
		},
		{
			name:        "short password fails",
			setup:       func(ur *fake.UserRepository) {},
			userName:    "Test User",
			email:       "test@example.com",
			password:    "Short1",
			isAdmin:     false,
			wantErr:     true,
			wantErrText: "password must be at least 8 characters",
		},
		{
			name:        "7 character password fails",
			setup:       func(ur *fake.UserRepository) {},
			userName:    "Test User",
			email:       "test@example.com",
			password:    "Pass123",
			isAdmin:     false,
			wantErr:     true,
			wantErrText: "password must be at least 8 characters",
		},
		{
			name:     "8 character password succeeds",
			setup:    func(ur *fake.UserRepository) {},
			userName: "Test User",
			email:    "test@example.com",
			password: "Pass1234",
			isAdmin:  false,
			wantErr:  false,
		},
		{
			name:     "email is normalized to lowercase",
			setup:    func(ur *fake.UserRepository) {},
			userName: "Test User",
			email:    "TEST@EXAMPLE.COM",
			password: "SecurePass123",
			isAdmin:  false,
			wantErr:  false,
		},
		{
			name:     "email whitespace is trimmed",
			setup:    func(ur *fake.UserRepository) {},
			userName: "Test User",
			email:    "  test@example.com  ",
			password: "SecurePass123",
			isAdmin:  false,
			wantErr:  false,
		},
		{
			name: "duplicate email fails",
			setup: func(ur *fake.UserRepository) {
				_, _ = ur.Create(ctx, &domain.User{
					ID:    "existing",
					Email: "test@example.com",
				})
			},
			userName: "Test User",
			email:    "test@example.com",
			password: "SecurePass123",
			isAdmin:  false,
			wantErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userRepo := fake.NewUserRepository()
			credRepo := fake.NewCredentialRepository()
			spaceRepo := fake.NewSpaceRepository()
			cfg := &config.Config{}

			tt.setup(userRepo)

			userSvc := application.NewUserService(userRepo, spaceRepo, cfg)
			credSvc := application.NewCredentialService(credRepo, cfg)

			uc := application.NewCreateLocalUserUsecase(userSvc, credSvc)
			user, err := uc.Execute(ctx, tt.userName, tt.email, tt.password, tt.isAdmin)

			if tt.wantErr {
				if err == nil {
					t.Error("Execute() expected error, got nil")
					return
				}
				if tt.wantErrText != "" && err.Error() != tt.wantErrText {
					t.Errorf("Execute() error = %v, want %v", err.Error(), tt.wantErrText)
				}
				return
			}

			if err != nil {
				t.Fatalf("Execute() unexpected error: %v", err)
			}

			if user == nil {
				t.Fatal("Execute() returned nil user")
				return
			}
			if user.ID == "" {
				t.Error("User.ID should be set")
			}
			if user.Name != tt.userName {
				t.Errorf("User.Name = %v, want %v", user.Name, tt.userName)
			}

			// Verify credential was created
			cred, err := credRepo.Get(ctx, user.ID)
			if err != nil {
				t.Fatalf("Credential not created: %v", err)
			}
			if cred.IsAdmin != tt.isAdmin {
				t.Errorf("Credential.IsAdmin = %v, want %v", cred.IsAdmin, tt.isAdmin)
			}
		})
	}
}

func TestAuthenticateLocalUserUsecase_Execute(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name      string
		setup     func(*fake.UserRepository, *fake.CredentialRepository)
		email     string
		password  string
		wantUser  bool
		wantAdmin bool
		wantErr   error
	}{
		{
			name: "successful authentication",
			setup: func(ur *fake.UserRepository, cr *fake.CredentialRepository) {
				userRepo := ur
				credRepo := cr
				spaceRepo := fake.NewSpaceRepository()
				cfg := &config.Config{}
				userSvc := application.NewUserService(userRepo, spaceRepo, cfg)
				credSvc := application.NewCredentialService(credRepo, cfg)
				uc := application.NewCreateLocalUserUsecase(userSvc, credSvc)
				_, _ = uc.Execute(ctx, "Test User", "test@example.com", "SecurePass123", false)
			},
			email:     "test@example.com",
			password:  "SecurePass123",
			wantUser:  true,
			wantAdmin: false,
			wantErr:   nil,
		},
		{
			name: "admin user authentication",
			setup: func(ur *fake.UserRepository, cr *fake.CredentialRepository) {
				userRepo := ur
				credRepo := cr
				spaceRepo := fake.NewSpaceRepository()
				cfg := &config.Config{}
				userSvc := application.NewUserService(userRepo, spaceRepo, cfg)
				credSvc := application.NewCredentialService(credRepo, cfg)
				uc := application.NewCreateLocalUserUsecase(userSvc, credSvc)
				_, _ = uc.Execute(ctx, "Admin User", "admin@example.com", "AdminPass123", true)
			},
			email:     "admin@example.com",
			password:  "AdminPass123",
			wantUser:  true,
			wantAdmin: true,
			wantErr:   nil,
		},
		{
			name: "wrong password fails",
			setup: func(ur *fake.UserRepository, cr *fake.CredentialRepository) {
				userRepo := ur
				credRepo := cr
				spaceRepo := fake.NewSpaceRepository()
				cfg := &config.Config{}
				userSvc := application.NewUserService(userRepo, spaceRepo, cfg)
				credSvc := application.NewCredentialService(credRepo, cfg)
				uc := application.NewCreateLocalUserUsecase(userSvc, credSvc)
				_, _ = uc.Execute(ctx, "Test User", "test@example.com", "SecurePass123", false)
			},
			email:    "test@example.com",
			password: "WrongPassword",
			wantErr:  domain.ErrInvalidCredentials,
		},
		{
			name:     "non-existent user fails",
			setup:    func(ur *fake.UserRepository, cr *fake.CredentialRepository) {},
			email:    "nonexistent@example.com",
			password: "SomePassword123",
			wantErr:  domain.ErrInvalidCredentials,
		},
		{
			name:     "empty email fails",
			setup:    func(ur *fake.UserRepository, cr *fake.CredentialRepository) {},
			email:    "",
			password: "SomePassword123",
			wantErr:  domain.ErrInvalidCredentials,
		},
		{
			name: "empty password fails",
			setup: func(ur *fake.UserRepository, cr *fake.CredentialRepository) {
				userRepo := ur
				credRepo := cr
				spaceRepo := fake.NewSpaceRepository()
				cfg := &config.Config{}
				userSvc := application.NewUserService(userRepo, spaceRepo, cfg)
				credSvc := application.NewCredentialService(credRepo, cfg)
				uc := application.NewCreateLocalUserUsecase(userSvc, credSvc)
				_, _ = uc.Execute(ctx, "Test User", "test@example.com", "SecurePass123", false)
			},
			email:    "test@example.com",
			password: "",
			wantErr:  domain.ErrInvalidCredentials,
		},
		{
			name: "blocked user cannot authenticate",
			setup: func(ur *fake.UserRepository, cr *fake.CredentialRepository) {
				userRepo := ur
				credRepo := cr
				spaceRepo := fake.NewSpaceRepository()
				cfg := &config.Config{}
				userSvc := application.NewUserService(userRepo, spaceRepo, cfg)
				credSvc := application.NewCredentialService(credRepo, cfg)
				uc := application.NewCreateLocalUserUsecase(userSvc, credSvc)
				user, _ := uc.Execute(ctx, "Blocked User", "blocked@example.com", "SecurePass123", false)
				_ = ur.SetBlocked(ctx, user.ID, true)
			},
			email:    "blocked@example.com",
			password: "SecurePass123",
			wantErr:  domain.ErrInvalidCredentials,
		},
		{
			name: "case insensitive email matching",
			setup: func(ur *fake.UserRepository, cr *fake.CredentialRepository) {
				userRepo := ur
				credRepo := cr
				spaceRepo := fake.NewSpaceRepository()
				cfg := &config.Config{}
				userSvc := application.NewUserService(userRepo, spaceRepo, cfg)
				credSvc := application.NewCredentialService(credRepo, cfg)
				uc := application.NewCreateLocalUserUsecase(userSvc, credSvc)
				_, _ = uc.Execute(ctx, "Test User", "test@example.com", "SecurePass123", false)
			},
			email:     "TEST@EXAMPLE.COM",
			password:  "SecurePass123",
			wantUser:  true,
			wantAdmin: false,
			wantErr:   nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userRepo := fake.NewUserRepository()
			credRepo := fake.NewCredentialRepository()
			spaceRepo := fake.NewSpaceRepository()
			cfg := &config.Config{}

			tt.setup(userRepo, credRepo)

			userSvc := application.NewUserService(userRepo, spaceRepo, cfg)
			credSvc := application.NewCredentialService(credRepo, cfg)

			uc := application.NewAuthenticateLocalUserUsecase(userSvc, credSvc)
			user, isAdmin, err := uc.Execute(ctx, tt.email, tt.password)

			if tt.wantErr != nil {
				if err == nil {
					t.Error("Execute() expected error, got nil")
					return
				}
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("Execute() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("Execute() unexpected error: %v", err)
			}

			if tt.wantUser && user == nil {
				t.Error("Execute() expected user, got nil")
			}
			if isAdmin != tt.wantAdmin {
				t.Errorf("Execute() isAdmin = %v, want %v", isAdmin, tt.wantAdmin)
			}
		})
	}
}

func TestAuthenticateLocalUserUsecase_MarksLogin(t *testing.T) {
	ctx := context.Background()

	userRepo := fake.NewUserRepository()
	credRepo := fake.NewCredentialRepository()
	spaceRepo := fake.NewSpaceRepository()
	cfg := &config.Config{}

	userSvc := application.NewUserService(userRepo, spaceRepo, cfg)
	credSvc := application.NewCredentialService(credRepo, cfg)

	// Create user
	createUc := application.NewCreateLocalUserUsecase(userSvc, credSvc)
	user, _ := createUc.Execute(ctx, "Test User", "test@example.com", "SecurePass123", false)

	// Verify no login recorded yet
	cred, _ := credRepo.Get(ctx, user.ID)
	if cred.LastLoginAt != nil {
		t.Error("LastLoginAt should be nil before authentication")
	}

	// Authenticate
	authUc := application.NewAuthenticateLocalUserUsecase(userSvc, credSvc)
	_, _, err := authUc.Execute(ctx, "test@example.com", "SecurePass123")
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}

	// Verify login was recorded
	cred, _ = credRepo.Get(ctx, user.ID)
	if cred.LastLoginAt == nil {
		t.Error("LastLoginAt should be set after authentication")
	}
}
