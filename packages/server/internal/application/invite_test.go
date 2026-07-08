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

// Helper to create services with all dependencies
func setupInviteTestServices(_ context.Context) (
	*application.UserService,
	*application.SpaceService,
	*application.EntitlementService,
	*fake.UserRepository,
	*fake.SpaceRepository,
) {
	userRepo := fake.NewUserRepository()
	spaceRepo := fake.NewSpaceRepository()
	entitlementRepo := fake.NewEntitlementRepository(userRepo)

	cfg := &config.Config{}
	userSvc := application.NewUserService(userRepo, spaceRepo, cfg)
	spaceSvc := application.NewSpaceService(spaceRepo)
	entitlementSvc := application.NewEntitlementService(entitlementRepo, userRepo, cfg)

	return userSvc, spaceSvc, entitlementSvc, userRepo, spaceRepo
}

func TestCreateInviteUsecase_Execute(t *testing.T) {
	ctx := context.Background()
	future := time.Now().Add(24 * time.Hour)

	tests := []struct {
		name         string
		setup        func(*fake.UserRepository, *fake.SpaceRepository)
		userID       string
		spaceID      string
		inviteeEmail string
		wantErr      error
	}{
		{
			name: "owner with subscription can create invite",
			setup: func(ur *fake.UserRepository, sr *fake.SpaceRepository) {
				_, _ = ur.Create(ctx, &domain.User{
					ID:                 "owner1",
					SubscriptionStatus: domain.SubscriptionActive,
				})
				_ = sr.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = sr.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "owner1",
					Role:             "owner",
					InvitationStatus: "accepted",
				})
			},
			userID:       "owner1",
			spaceID:      "space1",
			inviteeEmail: "friend@example.com",
			wantErr:      nil,
		},
		{
			name: "owner with founding member status can create invite",
			setup: func(ur *fake.UserRepository, sr *fake.SpaceRepository) {
				_, _ = ur.Create(ctx, &domain.User{
					ID:               "owner1",
					IsFoundingMember: true,
				})
				_ = sr.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = sr.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "owner1",
					Role:             "owner",
					InvitationStatus: "accepted",
				})
			},
			userID:       "owner1",
			spaceID:      "space1",
			inviteeEmail: "friend@example.com",
			wantErr:      nil,
		},
		{
			name: "user without workspace access cannot create invite",
			setup: func(ur *fake.UserRepository, sr *fake.SpaceRepository) {
				_, _ = ur.Create(ctx, &domain.User{
					ID:                 "owner1",
					SubscriptionStatus: domain.SubscriptionExpired,
				})
				_ = sr.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = sr.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "owner1",
					Role:             "owner",
					InvitationStatus: "accepted",
				})
			},
			userID:       "owner1",
			spaceID:      "space1",
			inviteeEmail: "friend@example.com",
			wantErr:      domain.ErrCollaborationRestricted,
		},
		{
			name: "non-owner cannot create invite",
			setup: func(ur *fake.UserRepository, sr *fake.SpaceRepository) {
				_, _ = ur.Create(ctx, &domain.User{
					ID:                 "member1",
					SubscriptionStatus: domain.SubscriptionActive,
				})
				_ = sr.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = sr.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "member1",
					Role:             "member",
					InvitationStatus: "accepted",
				})
			},
			userID:       "member1",
			spaceID:      "space1",
			inviteeEmail: "friend@example.com",
			wantErr:      domain.ErrSpaceAccessDenied,
		},
		{
			name: "user not in space cannot create invite",
			setup: func(ur *fake.UserRepository, sr *fake.SpaceRepository) {
				_, _ = ur.Create(ctx, &domain.User{
					ID:                 "outsider1",
					SubscriptionStatus: domain.SubscriptionActive,
				})
				_ = sr.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
			},
			userID:       "outsider1",
			spaceID:      "space1",
			inviteeEmail: "friend@example.com",
			wantErr:      domain.ErrSpaceAccessDenied,
		},
		{
			name: "non-existent user cannot create invite",
			setup: func(ur *fake.UserRepository, sr *fake.SpaceRepository) {
				_ = sr.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
			},
			userID:       "nonexistent",
			spaceID:      "space1",
			inviteeEmail: "friend@example.com",
			wantErr:      domain.ErrUserNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userSvc, spaceSvc, entitlementSvc, userRepo, spaceRepo := setupInviteTestServices(ctx)
			tt.setup(userRepo, spaceRepo)

			uc := application.NewCreateInviteUsecase(userSvc, spaceSvc, entitlementSvc)
			testSecretHash := "test-secret-hash"
			invite, err := uc.Execute(ctx, tt.userID, tt.spaceID, tt.inviteeEmail, testSecretHash, future)

			if tt.wantErr != nil {
				if err == nil {
					t.Errorf("Execute() expected error %v, got nil", tt.wantErr)
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

			if invite == nil {
				t.Fatal("Execute() returned nil invite")
				return
			}
			if invite.InviteSecret != testSecretHash {
				t.Errorf("Invite.InviteSecret = %v, want %v", invite.InviteSecret, testSecretHash)
			}
			if invite.InviteeEmail != tt.inviteeEmail {
				t.Errorf("Invite.InviteeEmail = %v, want %v", invite.InviteeEmail, tt.inviteeEmail)
			}
			if invite.InviterUserID != tt.userID {
				t.Errorf("Invite.InviterUserID = %v, want %v", invite.InviterUserID, tt.userID)
			}
		})
	}
}

func TestDeleteInviteUsecase_Execute(t *testing.T) {
	ctx := context.Background()
	future := time.Now().Add(24 * time.Hour)

	tests := []struct {
		name     string
		setup    func(*fake.SpaceRepository)
		userID   string
		inviteID string
		spaceID  string
		wantErr  error
	}{
		{
			name: "owner can delete invite",
			setup: func(sr *fake.SpaceRepository) {
				_ = sr.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = sr.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "owner1",
					Role:             "owner",
					InvitationStatus: "accepted",
				})
				_ = sr.CreateInvite(ctx, &domain.SpaceInvite{
					ID:           "invite1",
					SpaceID:      "space1",
					InviteSecret: "secret1",
					ExpiresAt:    &future,
				})
			},
			userID:   "owner1",
			inviteID: "invite1",
			spaceID:  "space1",
			wantErr:  nil,
		},
		{
			name: "non-owner cannot delete invite",
			setup: func(sr *fake.SpaceRepository) {
				_ = sr.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = sr.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "member1",
					Role:             "member",
					InvitationStatus: "accepted",
				})
				_ = sr.CreateInvite(ctx, &domain.SpaceInvite{
					ID:           "invite1",
					SpaceID:      "space1",
					InviteSecret: "secret1",
					ExpiresAt:    &future,
				})
			},
			userID:   "member1",
			inviteID: "invite1",
			spaceID:  "space1",
			wantErr:  domain.ErrSpaceAccessDenied,
		},
		{
			name: "user not in space cannot delete invite",
			setup: func(sr *fake.SpaceRepository) {
				_ = sr.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = sr.CreateInvite(ctx, &domain.SpaceInvite{
					ID:           "invite1",
					SpaceID:      "space1",
					InviteSecret: "secret1",
					ExpiresAt:    &future,
				})
			},
			userID:   "outsider1",
			inviteID: "invite1",
			spaceID:  "space1",
			wantErr:  domain.ErrSpaceAccessDenied,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)

			spaceSvc := application.NewSpaceService(spaceRepo)
			uc := application.NewDeleteInviteUsecase(spaceSvc)
			err := uc.Execute(ctx, tt.userID, tt.inviteID, tt.spaceID)

			if tt.wantErr != nil {
				if err == nil {
					t.Errorf("Execute() expected error %v, got nil", tt.wantErr)
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

			// Verify invite was deleted
			invites, _ := spaceRepo.ListInvites(ctx, tt.spaceID)
			for _, inv := range invites {
				if inv.ID == tt.inviteID {
					t.Error("Invite should have been deleted")
				}
			}
		})
	}
}

func TestListInvitesUsecase_Execute(t *testing.T) {
	ctx := context.Background()
	future := time.Now().Add(24 * time.Hour)

	tests := []struct {
		name        string
		setup       func(*fake.SpaceRepository)
		userID      string
		spaceID     string
		wantCount   int
		wantErr     error
	}{
		{
			name: "member can list invites",
			setup: func(sr *fake.SpaceRepository) {
				_ = sr.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = sr.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "member1",
					Role:             "member",
					InvitationStatus: "accepted",
				})
				_ = sr.CreateInvite(ctx, &domain.SpaceInvite{ID: "inv1", SpaceID: "space1", InviteSecret: "s1", ExpiresAt: &future})
				_ = sr.CreateInvite(ctx, &domain.SpaceInvite{ID: "inv2", SpaceID: "space1", InviteSecret: "s2", ExpiresAt: &future})
			},
			userID:    "member1",
			spaceID:   "space1",
			wantCount: 2,
			wantErr:   nil,
		},
		{
			name: "non-member cannot list invites",
			setup: func(sr *fake.SpaceRepository) {
				_ = sr.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = sr.CreateInvite(ctx, &domain.SpaceInvite{ID: "inv1", SpaceID: "space1", InviteSecret: "s1", ExpiresAt: &future})
			},
			userID:  "outsider1",
			spaceID: "space1",
			wantErr: domain.ErrSpaceAccessDenied,
		},
		{
			name: "empty space has no invites",
			setup: func(sr *fake.SpaceRepository) {
				_ = sr.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = sr.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "owner1",
					Role:             "owner",
					InvitationStatus: "accepted",
				})
			},
			userID:    "owner1",
			spaceID:   "space1",
			wantCount: 0,
			wantErr:   nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)

			spaceSvc := application.NewSpaceService(spaceRepo)
			uc := application.NewListInvitesUsecase(spaceSvc)
			invites, err := uc.Execute(ctx, tt.userID, tt.spaceID)

			if tt.wantErr != nil {
				if err == nil {
					t.Errorf("Execute() expected error %v, got nil", tt.wantErr)
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

			if len(invites) != tt.wantCount {
				t.Errorf("Execute() returned %d invites, want %d", len(invites), tt.wantCount)
			}
		})
	}
}

func TestCreateSpaceUsecase_Execute(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name        string
		setup       func(*fake.UserRepository)
		userID      string
		displayName string
		wantErr     error
	}{
		{
			name: "user with subscription can create space",
			setup: func(ur *fake.UserRepository) {
				_, _ = ur.Create(ctx, &domain.User{
					ID:                 "user1",
					SubscriptionStatus: domain.SubscriptionActive,
				})
			},
			userID:      "user1",
			displayName: "My Budget",
			wantErr:     nil,
		},
		{
			name: "user with trial can create space",
			setup: func(ur *fake.UserRepository) {
				future := time.Now().Add(24 * time.Hour)
				_, _ = ur.Create(ctx, &domain.User{
					ID:                 "user1",
					SubscriptionStatus: domain.SubscriptionTrialing,
					TrialEndsAt:        &future,
				})
			},
			userID:      "user1",
			displayName: "My Budget",
			wantErr:     nil,
		},
		{
			name: "founding member can create space",
			setup: func(ur *fake.UserRepository) {
				_, _ = ur.Create(ctx, &domain.User{
					ID:               "user1",
					IsFoundingMember: true,
				})
			},
			userID:      "user1",
			displayName: "My Budget",
			wantErr:     nil,
		},
		{
			name: "user with expired subscription cannot create space",
			setup: func(ur *fake.UserRepository) {
				_, _ = ur.Create(ctx, &domain.User{
					ID:                 "user1",
					SubscriptionStatus: domain.SubscriptionExpired,
				})
			},
			userID:      "user1",
			displayName: "My Budget",
			wantErr:     domain.ErrCollaborationRestricted,
		},
		{
			name: "user with expired trial cannot create space",
			setup: func(ur *fake.UserRepository) {
				past := time.Now().Add(-24 * time.Hour)
				_, _ = ur.Create(ctx, &domain.User{
					ID:                 "user1",
					SubscriptionStatus: domain.SubscriptionTrialing,
					TrialEndsAt:        &past,
				})
			},
			userID:      "user1",
			displayName: "My Budget",
			wantErr:     domain.ErrCollaborationRestricted,
		},
		{
			name:        "non-existent user cannot create space",
			setup:       func(ur *fake.UserRepository) {},
			userID:      "nonexistent",
			displayName: "My Budget",
			wantErr:     domain.ErrUserNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userSvc, spaceSvc, entitlementSvc, userRepo, _ := setupInviteTestServices(ctx)
			tt.setup(userRepo)

			uc := application.NewCreateSpaceUsecase(userSvc, spaceSvc, entitlementSvc)
			space, err := uc.Execute(ctx, tt.userID, tt.displayName)

			if tt.wantErr != nil {
				if err == nil {
					t.Errorf("Execute() expected error %v, got nil", tt.wantErr)
					return
				}
				// Check if error contains the expected error (might be wrapped)
				if !errors.Is(err, tt.wantErr) && !containsError(err, tt.wantErr) {
					t.Errorf("Execute() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("Execute() unexpected error: %v", err)
			}

			if space == nil {
				t.Fatal("Execute() returned nil space")
				return
			}
			if space.OwnerUserID != tt.userID {
				t.Errorf("Space.OwnerUserID = %v, want %v", space.OwnerUserID, tt.userID)
			}
			if space.DisplayName != tt.displayName {
				t.Errorf("Space.DisplayName = %v, want %v", space.DisplayName, tt.displayName)
			}
		})
	}
}

// Helper to check if error message contains expected error
func containsError(err, target error) bool {
	if err == nil || target == nil {
		return false
	}
	return errors.Is(err, target) ||
		(err.Error() == target.Error()) ||
		(len(err.Error()) > len(target.Error()) && err.Error()[len(err.Error())-len(target.Error()):] == target.Error())
}
