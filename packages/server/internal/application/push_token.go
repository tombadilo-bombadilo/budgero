package application

import (
	"context"
	"fmt"

	"budgero-server/internal/port/driving"
)

// GeneratePushTokenUsecase orchestrates push token generation.
type GeneratePushTokenUsecase struct {
	users driving.UserService
	push  driving.PushService
}

// NewGeneratePushTokenUsecase creates a new GeneratePushTokenUsecase.
func NewGeneratePushTokenUsecase(users driving.UserService, push driving.PushService) *GeneratePushTokenUsecase {
	return &GeneratePushTokenUsecase{
		users: users,
		push:  push,
	}
}

// Execute generates a new push token for a user.
func (uc *GeneratePushTokenUsecase) Execute(ctx context.Context, userID string) (token, spaceID string, err error) {
	user, err := uc.users.GetByID(ctx, userID)
	if err != nil {
		return "", "", err
	}

	if user.PrimarySpaceID == "" {
		return "", "", fmt.Errorf("no primary space configured")
	}

	token, err = uc.push.GenerateAndSaveToken(ctx, userID, user.PrimarySpaceID)
	if err != nil {
		return "", "", err
	}

	return token, user.PrimarySpaceID, nil
}

// GetPushEncryptionInfoUsecase orchestrates getting push encryption info.
type GetPushEncryptionInfoUsecase struct {
	users driving.UserService
	push  driving.PushService
}

// NewGetPushEncryptionInfoUsecase creates a new GetPushEncryptionInfoUsecase.
func NewGetPushEncryptionInfoUsecase(users driving.UserService, push driving.PushService) *GetPushEncryptionInfoUsecase {
	return &GetPushEncryptionInfoUsecase{
		users: users,
		push:  push,
	}
}

// Execute returns encryption info for the push API.
func (uc *GetPushEncryptionInfoUsecase) Execute(ctx context.Context, userID string) (spaceID string, hasToken bool, err error) {
	user, err := uc.users.GetByID(ctx, userID)
	if err != nil {
		return "", false, err
	}

	if user.PrimarySpaceID == "" {
		return "", false, fmt.Errorf("no primary space configured")
	}

	status, err := uc.push.GetTokenStatus(ctx, userID)
	if err != nil {
		return "", false, err
	}

	return user.PrimarySpaceID, status.HasToken && status.IsEnabled, nil
}
