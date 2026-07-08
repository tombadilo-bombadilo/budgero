// Package application provides application use cases that orchestrate domain services.
package application

import (
	"budgero-server/internal/config"
	"budgero-server/internal/port/driving"
)

// Usecases contains all use case instances.
// Use cases orchestrate domain services for complex operations.
type Usecases struct {
	// Space usecases
	CreateSpace *CreateSpaceUsecase
	DeleteSpace *DeleteSpaceUsecase

	// Invite usecases
	CreateInvite *CreateInviteUsecase
	DeleteInvite *DeleteInviteUsecase
	ListInvites  *ListInvitesUsecase
	UpdateBundle *UpdateInviteBundleUsecase

	// Auth usecases
	ClerkSync         *ClerkSyncUsecase
	CreateLocalUser   *CreateLocalUserUsecase
	AuthenticateLocal *AuthenticateLocalUserUsecase
	CheckAdmin        *CheckAdminUsecase

	// Push usecases
	GeneratePushToken     *GeneratePushTokenUsecase
	GetPushEncryptionInfo *GetPushEncryptionInfoUsecase
}

// NewUsecases creates all use cases with their dependencies.
func NewUsecases(
	userSvc driving.UserService,
	spaceSvc driving.SpaceService,
	credSvc driving.CredentialService,
	entitlementSvc driving.EntitlementService,
	pushSvc driving.PushService,
	adminSvc driving.AdminService,
	cfg *config.Config,
) *Usecases {
	return &Usecases{
		// Space usecases
		CreateSpace: NewCreateSpaceUsecase(userSvc, spaceSvc, entitlementSvc),
		DeleteSpace: NewDeleteSpaceUsecase(spaceSvc),

		// Invite usecases
		CreateInvite: NewCreateInviteUsecase(userSvc, spaceSvc, entitlementSvc),
		DeleteInvite: NewDeleteInviteUsecase(spaceSvc),
		ListInvites:  NewListInvitesUsecase(spaceSvc),
		UpdateBundle: NewUpdateInviteBundleUsecase(spaceSvc),

		// Auth usecases
		ClerkSync:         NewClerkSyncUsecase(userSvc, adminSvc, cfg),
		CreateLocalUser:   NewCreateLocalUserUsecase(userSvc, credSvc),
		AuthenticateLocal: NewAuthenticateLocalUserUsecase(userSvc, credSvc),
		CheckAdmin:        NewCheckAdminUsecase(userSvc, adminSvc, cfg),

		// Push usecases
		GeneratePushToken:     NewGeneratePushTokenUsecase(userSvc, pushSvc),
		GetPushEncryptionInfo: NewGetPushEncryptionInfoUsecase(userSvc, pushSvc),
	}
}
