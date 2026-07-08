package application_test

import (
	"context"
	"testing"

	"budgero-server/internal/adapter/driven/fake"
	"budgero-server/internal/application"
	"budgero-server/internal/domain"
)

func TestGeneratePushTokenUsecase_Success(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	spaceRepo := fake.NewSpaceRepository()
	pushRepo := fake.NewPushRepository()

	userSvc := application.NewUserService(userRepo, spaceRepo, nil)
	pushSvc := application.NewPushService(pushRepo)

	uc := application.NewGeneratePushTokenUsecase(userSvc, pushSvc)

	// Create user with primary space
	_, _ = userRepo.Create(ctx, &domain.User{
		ID:             "user1",
		Email:          "user@example.com",
		PrimarySpaceID: testSpaceID,
	})

	token, spaceID, err := uc.Execute(ctx, "user1")
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}

	if token == "" {
		t.Error("Execute() returned empty token")
	}
	if spaceID != testSpaceID {
		t.Errorf("Execute() spaceID = %v, want %s", spaceID, testSpaceID)
	}
}

func TestGeneratePushTokenUsecase_UserNotFound(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	spaceRepo := fake.NewSpaceRepository()
	pushRepo := fake.NewPushRepository()

	userSvc := application.NewUserService(userRepo, spaceRepo, nil)
	pushSvc := application.NewPushService(pushRepo)

	uc := application.NewGeneratePushTokenUsecase(userSvc, pushSvc)

	_, _, err := uc.Execute(ctx, "nonexistent")
	if err == nil {
		t.Error("Execute() expected error for nonexistent user")
	}
}

func TestGeneratePushTokenUsecase_NoPrimarySpace(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	spaceRepo := fake.NewSpaceRepository()
	pushRepo := fake.NewPushRepository()

	userSvc := application.NewUserService(userRepo, spaceRepo, nil)
	pushSvc := application.NewPushService(pushRepo)

	uc := application.NewGeneratePushTokenUsecase(userSvc, pushSvc)

	// Create user without primary space
	_, _ = userRepo.Create(ctx, &domain.User{
		ID:             "user1",
		Email:          "user@example.com",
		PrimarySpaceID: "", // No primary space
	})

	_, _, err := uc.Execute(ctx, "user1")
	if err == nil {
		t.Error("Execute() expected error for user without primary space")
	}
}

func TestGetPushEncryptionInfoUsecase_Success(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	spaceRepo := fake.NewSpaceRepository()
	pushRepo := fake.NewPushRepository()

	userSvc := application.NewUserService(userRepo, spaceRepo, nil)
	pushSvc := application.NewPushService(pushRepo)

	uc := application.NewGetPushEncryptionInfoUsecase(userSvc, pushSvc)

	// Create user with primary space
	_, _ = userRepo.Create(ctx, &domain.User{
		ID:             "user1",
		Email:          "user@example.com",
		PrimarySpaceID: testSpaceID,
	})

	// Create a push token
	_, _ = pushSvc.GenerateAndSaveToken(ctx, "user1", testSpaceID)

	spaceID, hasToken, err := uc.Execute(ctx, "user1")
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}

	if spaceID != testSpaceID {
		t.Errorf("Execute() spaceID = %v, want %s", spaceID, testSpaceID)
	}
	if !hasToken {
		t.Error("Execute() hasToken = false, want true")
	}
}

func TestGetPushEncryptionInfoUsecase_NoToken(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	spaceRepo := fake.NewSpaceRepository()
	pushRepo := fake.NewPushRepository()

	userSvc := application.NewUserService(userRepo, spaceRepo, nil)
	pushSvc := application.NewPushService(pushRepo)

	uc := application.NewGetPushEncryptionInfoUsecase(userSvc, pushSvc)

	// Create user with primary space but no token
	_, _ = userRepo.Create(ctx, &domain.User{
		ID:             "user1",
		Email:          "user@example.com",
		PrimarySpaceID: testSpaceID,
	})

	spaceID, hasToken, err := uc.Execute(ctx, "user1")
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}

	if spaceID != testSpaceID {
		t.Errorf("Execute() spaceID = %v, want %s", spaceID, testSpaceID)
	}
	if hasToken {
		t.Error("Execute() hasToken = true, want false")
	}
}

func TestGetPushEncryptionInfoUsecase_UserNotFound(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	spaceRepo := fake.NewSpaceRepository()
	pushRepo := fake.NewPushRepository()

	userSvc := application.NewUserService(userRepo, spaceRepo, nil)
	pushSvc := application.NewPushService(pushRepo)

	uc := application.NewGetPushEncryptionInfoUsecase(userSvc, pushSvc)

	_, _, err := uc.Execute(ctx, "nonexistent")
	if err == nil {
		t.Error("Execute() expected error for nonexistent user")
	}
}

func TestGetPushEncryptionInfoUsecase_NoPrimarySpace(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	spaceRepo := fake.NewSpaceRepository()
	pushRepo := fake.NewPushRepository()

	userSvc := application.NewUserService(userRepo, spaceRepo, nil)
	pushSvc := application.NewPushService(pushRepo)

	uc := application.NewGetPushEncryptionInfoUsecase(userSvc, pushSvc)

	// Create user without primary space
	_, _ = userRepo.Create(ctx, &domain.User{
		ID:             "user1",
		Email:          "user@example.com",
		PrimarySpaceID: "",
	})

	_, _, err := uc.Execute(ctx, "user1")
	if err == nil {
		t.Error("Execute() expected error for user without primary space")
	}
}

func TestGetPushEncryptionInfoUsecase_DisabledToken(t *testing.T) {
	ctx := context.Background()
	userRepo := fake.NewUserRepository()
	spaceRepo := fake.NewSpaceRepository()
	pushRepo := fake.NewPushRepository()

	userSvc := application.NewUserService(userRepo, spaceRepo, nil)
	pushSvc := application.NewPushService(pushRepo)

	uc := application.NewGetPushEncryptionInfoUsecase(userSvc, pushSvc)

	// Create user with primary space
	_, _ = userRepo.Create(ctx, &domain.User{
		ID:             "user1",
		Email:          "user@example.com",
		PrimarySpaceID: testSpaceID,
	})

	// Create and then disable the token
	_, _ = pushSvc.GenerateAndSaveToken(ctx, "user1", testSpaceID)
	_ = pushSvc.SetTokenEnabled(ctx, "user1", false)

	spaceID, hasToken, err := uc.Execute(ctx, "user1")
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}

	if spaceID != testSpaceID {
		t.Errorf("Execute() spaceID = %v, want %s", spaceID, testSpaceID)
	}
	// hasToken should be false when token is disabled
	if hasToken {
		t.Error("Execute() hasToken = true for disabled token, want false")
	}
}
