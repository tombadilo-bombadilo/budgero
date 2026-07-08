package application_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/fake"
	"budgero-server/internal/application"
	"budgero-server/internal/domain"
)

const testSpaceID2 = "space2"

func TestSpaceService_Create(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name        string
		userID      string
		displayName string
		wantName    string
	}{
		{
			name:        "create with custom name",
			userID:      "user1",
			displayName: "My Budget",
			wantName:    "My Budget",
		},
		{
			name:        "create with empty name uses default",
			userID:      "user1",
			displayName: "",
			wantName:    "Shared Budget",
		},
		{
			name:        "create with whitespace name uses default",
			userID:      "user1",
			displayName: "   ",
			wantName:    "Shared Budget",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			svc := application.NewSpaceService(spaceRepo)

			summary, err := svc.Create(ctx, tt.userID, tt.displayName)
			if err != nil {
				t.Fatalf("Create() error = %v", err)
			}

			if summary.DisplayName != tt.wantName {
				t.Errorf("DisplayName = %v, want %v", summary.DisplayName, tt.wantName)
			}
			if summary.OwnerUserID != tt.userID {
				t.Errorf("OwnerUserID = %v, want %v", summary.OwnerUserID, tt.userID)
			}
			if summary.Role != "owner" {
				t.Errorf("Role = %v, want owner", summary.Role)
			}
			if summary.InvitationStatus != "accepted" {
				t.Errorf("InvitationStatus = %v, want accepted", summary.InvitationStatus)
			}
		})
	}
}

func TestSpaceService_ResolveSpaceID(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name    string
		userID  string
		spaceID string
		setup   func(*fake.SpaceRepository)
		wantID  string
		wantErr error
	}{
		{
			name:    "resolve explicit space ID with accepted membership",
			userID:  "user1",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "user1",
					InvitationStatus: "accepted",
				})
			},
			wantID: "space1",
		},
		{
			name:    "resolve explicit space ID with pending membership fails",
			userID:  "user1",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "user1",
					InvitationStatus: "pending",
				})
			},
			wantErr: domain.ErrSpaceAccessDenied,
		},
		{
			name:    "resolve empty space ID returns first accepted membership",
			userID:  "user1",
			spaceID: "",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "user1",
					InvitationStatus: "accepted",
				})
			},
			wantID: "space1",
		},
		{
			name:    "user with no memberships fails",
			userID:  "user1",
			spaceID: "",
			setup:   func(r *fake.SpaceRepository) {},
			wantErr: domain.ErrSpaceAccessDenied,
		},
		{
			name:    "non-member cannot access space",
			userID:  "user1",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner"})
			},
			wantErr: domain.ErrSpaceAccessDenied,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)
			svc := application.NewSpaceService(spaceRepo)

			got, err := svc.ResolveSpaceID(ctx, tt.userID, tt.spaceID)

			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("ResolveSpaceID() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("ResolveSpaceID() unexpected error: %v", err)
			}
			if got != tt.wantID {
				t.Errorf("ResolveSpaceID() = %v, want %v", got, tt.wantID)
			}
		})
	}
}

func TestSpaceService_UpdateDisplayName(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name        string
		actorID     string
		spaceID     string
		displayName string
		setup       func(*fake.SpaceRepository)
		wantErr     string
	}{
		{
			name:        "owner can update display name",
			actorID:     "owner1",
			spaceID:     "space1",
			displayName: "New Name",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1", DisplayName: "Old Name"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "owner1",
					Role:             "owner",
					InvitationStatus: "accepted",
				})
			},
			wantErr: "",
		},
		{
			name:        "non-owner cannot update display name",
			actorID:     "member1",
			spaceID:     "space1",
			displayName: "New Name",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1", DisplayName: "Old Name"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "member1",
					Role:             "member",
					InvitationStatus: "accepted",
				})
			},
			wantErr: domain.ErrSpaceAccessDenied.Error(),
		},
		{
			name:        "empty display name fails",
			actorID:     "owner1",
			spaceID:     "space1",
			displayName: "",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "owner1",
					Role:             "owner",
					InvitationStatus: "accepted",
				})
			},
			wantErr: "display name cannot be empty",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)
			svc := application.NewSpaceService(spaceRepo)

			err := svc.UpdateDisplayName(ctx, tt.actorID, tt.spaceID, tt.displayName)

			if tt.wantErr != "" {
				if err == nil {
					t.Errorf("UpdateDisplayName() expected error, got nil")
					return
				}
				if err.Error() != tt.wantErr {
					t.Errorf("UpdateDisplayName() error = %v, want %v", err.Error(), tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("UpdateDisplayName() unexpected error: %v", err)
			}
		})
	}
}

func TestSpaceService_RemoveMember(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name     string
		actorID  string
		spaceID  string
		memberID string
		setup    func(*fake.SpaceRepository)
		wantErr  string
	}{
		{
			name:     "owner can remove member",
			actorID:  "owner1",
			spaceID:  "space1",
			memberID: "member1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "owner1",
					Role:             "owner",
					InvitationStatus: "accepted",
				})
				_ = r.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "member1",
					Role:             "member",
					InvitationStatus: "accepted",
				})
			},
			wantErr: "",
		},
		{
			name:     "member can leave space",
			actorID:  "member1",
			spaceID:  "space1",
			memberID: "member1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "owner1",
					Role:             "owner",
					InvitationStatus: "accepted",
				})
				_ = r.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "member1",
					Role:             "member",
					InvitationStatus: "accepted",
				})
			},
			wantErr: "",
		},
		{
			name:     "member cannot remove another member",
			actorID:  "member1",
			spaceID:  "space1",
			memberID: "member2",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "member1",
					Role:             "member",
					InvitationStatus: "accepted",
				})
				_ = r.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "member2",
					Role:             "member",
					InvitationStatus: "accepted",
				})
			},
			wantErr: domain.ErrSpaceAccessDenied.Error(),
		},
		{
			name:     "owner cannot remove themselves",
			actorID:  "owner1",
			spaceID:  "space1",
			memberID: "owner1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "owner1",
					Role:             "owner",
					InvitationStatus: "accepted",
				})
			},
			wantErr: "owners must transfer ownership before leaving",
		},
		{
			name:     "non-owner cannot remove members even with owner role",
			actorID:  "admin1",
			spaceID:  "space1",
			memberID: "member1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "owner1",
					Role:             "owner",
					InvitationStatus: "accepted",
				})
				_ = r.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "admin1",
					Role:             "owner", // has owner role but not THE owner
					InvitationStatus: "accepted",
				})
				_ = r.CreateMember(ctx, &domain.SpaceMember{
					SpaceID:          "space1",
					UserID:           "member1",
					Role:             "member",
					InvitationStatus: "accepted",
				})
			},
			wantErr: domain.ErrSpaceAccessDenied.Error(),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)
			svc := application.NewSpaceService(spaceRepo)

			err := svc.RemoveMember(ctx, tt.actorID, tt.spaceID, tt.memberID)

			if tt.wantErr != "" {
				if err == nil {
					t.Errorf("RemoveMember() expected error, got nil")
					return
				}
				if err.Error() != tt.wantErr {
					t.Errorf("RemoveMember() error = %v, want %v", err.Error(), tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("RemoveMember() unexpected error: %v", err)
			}

			// Verify member was removed
			members, _ := spaceRepo.ListMembers(ctx, tt.spaceID)
			for _, m := range members {
				if m.UserID == tt.memberID {
					t.Errorf("Member %s should have been removed", tt.memberID)
				}
			}
		})
	}
}

func TestSpaceService_RedeemInvite(t *testing.T) {
	ctx := context.Background()
	future := time.Now().Add(24 * time.Hour)
	past := time.Now().Add(-24 * time.Hour)
	now := time.Now()

	tests := []struct {
		name    string
		userID  string
		invite  *domain.SpaceInvite
		wantErr error
	}{
		{
			name:   "redeem valid invite creates membership",
			userID: "user1",
			invite: &domain.SpaceInvite{
				ID:              "inv1",
				SpaceID:         "space1",
				ExpiresAt:       &future,
				EncryptedBundle: "encrypted-bundle",
			},
			wantErr: nil,
		},
		{
			name:   "redeem expired invite fails",
			userID: "user1",
			invite: &domain.SpaceInvite{
				ID:              "inv1",
				SpaceID:         "space1",
				ExpiresAt:       &past,
				EncryptedBundle: "encrypted-bundle",
			},
			wantErr: domain.ErrInviteExpired,
		},
		{
			name:   "redeem invite without bundle fails",
			userID: "user1",
			invite: &domain.SpaceInvite{
				ID:              "inv1",
				SpaceID:         "space1",
				ExpiresAt:       &future,
				EncryptedBundle: "",
			},
			wantErr: domain.ErrInviteMissingBundle,
		},
		{
			name:   "redeem already used invite fails",
			userID: "user1",
			invite: &domain.SpaceInvite{
				ID:              "inv1",
				SpaceID:         "space1",
				ExpiresAt:       &future,
				EncryptedBundle: "encrypted-bundle",
				RedeemedAt:      &now,
				RedeemedBy:      ptr("someone"),
			},
			wantErr: domain.ErrInviteAlreadyUsed,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			_ = spaceRepo.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner"})
			if tt.invite != nil {
				_ = spaceRepo.CreateInvite(ctx, tt.invite)
			}

			svc := application.NewSpaceService(spaceRepo)
			err := svc.RedeemInvite(ctx, tt.invite, tt.userID, "encrypted-key")

			if tt.wantErr != nil {
				if err == nil {
					t.Errorf("RedeemInvite() expected error %v, got nil", tt.wantErr)
					return
				}
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("RedeemInvite() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("RedeemInvite() unexpected error: %v", err)
			}

			// Verify membership was created
			members, _ := spaceRepo.ListMembers(ctx, tt.invite.SpaceID)
			found := false
			for _, m := range members {
				if m.UserID == tt.userID {
					found = true
					if m.Role != "member" {
						t.Errorf("Role = %v, want member", m.Role)
					}
					if m.InvitationStatus != "accepted" {
						t.Errorf("InvitationStatus = %v, want accepted", m.InvitationStatus)
					}
				}
			}
			if !found {
				t.Error("Expected membership to be created")
			}
		})
	}
}

func TestSpaceService_ListForUser(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name       string
		userID     string
		setup      func(*fake.SpaceRepository)
		wantCount  int
		wantSpaces []string
	}{
		{
			name:   "list multiple accepted spaces",
			userID: "user1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "user1", DisplayName: "Space 1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "user1", InvitationStatus: "accepted", Role: "owner"})
				_ = r.Create(ctx, &domain.Space{SpaceID: "space2", OwnerUserID: "other", DisplayName: "Space 2"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space2", UserID: "user1", InvitationStatus: "accepted", Role: "member"})
			},
			wantCount:  2,
			wantSpaces: []string{"space1", "space2"},
		},
		{
			name:   "excludes pending memberships",
			userID: "user1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "user1", DisplayName: "Space 1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "user1", InvitationStatus: "accepted", Role: "owner"})
				_ = r.Create(ctx, &domain.Space{SpaceID: "space2", OwnerUserID: "other", DisplayName: "Space 2"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space2", UserID: "user1", InvitationStatus: "pending", Role: "member"})
			},
			wantCount:  1,
			wantSpaces: []string{"space1"},
		},
		{
			name:   "empty list for user with no memberships",
			userID: "user1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "other", DisplayName: "Space 1"})
			},
			wantCount:  0,
			wantSpaces: []string{},
		},
		{
			name:   "user sees only their own spaces",
			userID: "user1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "user1", DisplayName: "Space 1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "user1", InvitationStatus: "accepted", Role: "owner"})
				_ = r.Create(ctx, &domain.Space{SpaceID: "space2", OwnerUserID: "user2", DisplayName: "Space 2"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space2", UserID: "user2", InvitationStatus: "accepted", Role: "owner"})
			},
			wantCount:  1,
			wantSpaces: []string{"space1"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)
			svc := application.NewSpaceService(spaceRepo)

			spaces, err := svc.ListForUser(ctx, tt.userID)
			if err != nil {
				t.Fatalf("ListForUser() unexpected error: %v", err)
			}

			if len(spaces) != tt.wantCount {
				t.Errorf("ListForUser() returned %d spaces, want %d", len(spaces), tt.wantCount)
			}

			// Verify expected spaces are present
			for _, wantID := range tt.wantSpaces {
				found := false
				for _, s := range spaces {
					if s.SpaceID == wantID {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("ListForUser() missing space %s", wantID)
				}
			}
		})
	}
}

func TestSpaceService_ListMembers(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name        string
		requestorID string
		spaceID     string
		setup       func(*fake.SpaceRepository)
		wantCount   int
		wantErr     error
	}{
		{
			name:        "owner can list all members",
			requestorID: "owner1",
			spaceID:     "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "member1", InvitationStatus: "accepted", Role: "member"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "member2", InvitationStatus: "accepted", Role: "member"})
			},
			wantCount: 3,
		},
		{
			name:        "member can list all members",
			requestorID: "member1",
			spaceID:     "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "member1", InvitationStatus: "accepted", Role: "member"})
			},
			wantCount: 2,
		},
		{
			name:        "non-member cannot list members",
			requestorID: "outsider",
			spaceID:     "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
			},
			wantErr: domain.ErrSpaceAccessDenied,
		},
		{
			name:        "pending member cannot list members",
			requestorID: "pending1",
			spaceID:     "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "pending1", InvitationStatus: "pending", Role: "member"})
			},
			wantErr: domain.ErrSpaceAccessDenied,
		},
		{
			name:        "empty space has no members",
			requestorID: "owner1",
			spaceID:     "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
			},
			wantCount: 1, // Just the owner
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)
			svc := application.NewSpaceService(spaceRepo)

			members, err := svc.ListMembers(ctx, tt.requestorID, tt.spaceID)

			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("ListMembers() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("ListMembers() unexpected error: %v", err)
			}

			if len(members) != tt.wantCount {
				t.Errorf("ListMembers() returned %d members, want %d", len(members), tt.wantCount)
			}
		})
	}
}

func TestSpaceService_UpdateMemberEncryptedKey(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name         string
		userID       string
		spaceID      string
		encryptedKey string
		setup        func(*fake.SpaceRepository)
		wantErr      error
	}{
		{
			name:         "member can update their own key",
			userID:       "member1",
			spaceID:      "space1",
			encryptedKey: "new-encrypted-key",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "member1", InvitationStatus: "accepted", Role: "member", EncryptedSpaceKey: "old-key"})
			},
		},
		{
			name:         "owner can update their own key",
			userID:       "owner1",
			spaceID:      "space1",
			encryptedKey: "owner-new-key",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
			},
		},
		{
			name:         "non-member cannot update key",
			userID:       "outsider",
			spaceID:      "space1",
			encryptedKey: "hacked-key",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
			},
			wantErr: domain.ErrSpaceAccessDenied,
		},
		{
			name:         "pending member cannot update key",
			userID:       "pending1",
			spaceID:      "space1",
			encryptedKey: "pending-key",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "pending1", InvitationStatus: "pending", Role: "member"})
			},
			wantErr: domain.ErrSpaceAccessDenied,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)
			svc := application.NewSpaceService(spaceRepo)

			err := svc.UpdateMemberEncryptedKey(ctx, tt.userID, tt.spaceID, tt.encryptedKey)

			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("UpdateMemberEncryptedKey() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("UpdateMemberEncryptedKey() unexpected error: %v", err)
			}

			// Verify key was updated
			members, _ := spaceRepo.ListMembers(ctx, tt.spaceID)
			for _, m := range members {
				if m.UserID == tt.userID && m.EncryptedSpaceKey != tt.encryptedKey {
					t.Errorf("EncryptedSpaceKey = %v, want %v", m.EncryptedSpaceKey, tt.encryptedKey)
				}
			}
		})
	}
}

func TestSpaceService_IsOwner(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name    string
		userID  string
		spaceID string
		setup   func(*fake.SpaceRepository)
		want    bool
		wantErr error
	}{
		{
			name:    "returns true for space owner",
			userID:  "owner1",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
			},
			want: true,
		},
		{
			name:    "returns false for member",
			userID:  "member1",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "member1", InvitationStatus: "accepted", Role: "member"})
			},
			want: false,
		},
		{
			name:    "returns false for non-member",
			userID:  "outsider",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
			},
			want: false,
		},
		{
			name:    "returns error for non-existent space",
			userID:  "user1",
			spaceID: "nonexistent",
			setup:   func(r *fake.SpaceRepository) {},
			wantErr: domain.ErrSpaceNotFound,
		},
		{
			name:    "member with owner role is not THE owner",
			userID:  "admin1",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "admin1", InvitationStatus: "accepted", Role: "owner"})
			},
			want: false, // Has owner role but is not THE owner
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)
			svc := application.NewSpaceService(spaceRepo)

			got, err := svc.IsOwner(ctx, tt.userID, tt.spaceID)

			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("IsOwner() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("IsOwner() unexpected error: %v", err)
			}

			if got != tt.want {
				t.Errorf("IsOwner() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSpaceService_GetBlobMetadata(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name       string
		userID     string
		spaceID    string
		setup      func(*fake.SpaceRepository)
		wantPath   string
		wantErr    error
	}{
		{
			name:    "member can get blob metadata",
			userID:  "member1",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "member1", InvitationStatus: "accepted", Role: "member"})
				_ = r.CreateBlob(ctx, "space1", "data/space1.db")
			},
			wantPath: "data/space1.db",
		},
		{
			name:    "owner can get blob metadata",
			userID:  "owner1",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
				_ = r.CreateBlob(ctx, "space1", "data/space1.db")
			},
			wantPath: "data/space1.db",
		},
		{
			name:    "non-member cannot get blob metadata",
			userID:  "outsider",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateBlob(ctx, "space1", "data/space1.db")
			},
			wantErr: domain.ErrSpaceAccessDenied,
		},
		{
			name:    "returns error when blob doesn't exist",
			userID:  "owner1",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
				// No blob created
			},
			wantErr: domain.ErrSpaceNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)
			svc := application.NewSpaceService(spaceRepo)

			blob, err := svc.GetBlobMetadata(ctx, tt.userID, tt.spaceID)

			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("GetBlobMetadata() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("GetBlobMetadata() unexpected error: %v", err)
			}

			if blob.BlobPath != tt.wantPath {
				t.Errorf("BlobPath = %v, want %v", blob.BlobPath, tt.wantPath)
			}
		})
	}
}

func TestSpaceService_GetSyncState(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name        string
		userID      string
		spaceID     string
		setup       func(*fake.SpaceRepository)
		wantVersion int64
		wantHash    string
		wantErr     error
	}{
		{
			name:    "member can get sync state",
			userID:  "member1",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "member1", InvitationStatus: "accepted", Role: "member"})
				_ = r.CreateBlob(ctx, "space1", "data/space1.db")
				_, _ = r.UpdateSyncState(ctx, "space1", "abc123", 1024, 0)
			},
			wantVersion: 1,
			wantHash:    "abc123",
		},
		{
			name:    "initial state has zero version and empty hash",
			userID:  "owner1",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
				_ = r.CreateBlob(ctx, "space1", "data/space1.db")
			},
			wantVersion: 0,
			wantHash:    "",
		},
		{
			name:    "non-member cannot get sync state",
			userID:  "outsider",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateBlob(ctx, "space1", "data/space1.db")
			},
			wantErr: domain.ErrSpaceAccessDenied,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)
			svc := application.NewSpaceService(spaceRepo)

			state, err := svc.GetSyncState(ctx, tt.userID, tt.spaceID)

			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("GetSyncState() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("GetSyncState() unexpected error: %v", err)
			}

			if state.Version != tt.wantVersion {
				t.Errorf("Version = %d, want %d", state.Version, tt.wantVersion)
			}
			if state.Hash != tt.wantHash {
				t.Errorf("Hash = %v, want %v", state.Hash, tt.wantHash)
			}
			if state.SpaceID != tt.spaceID {
				t.Errorf("SpaceID = %v, want %v", state.SpaceID, tt.spaceID)
			}
		})
	}
}

func TestSpaceService_GetDatabaseHash(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name     string
		userID   string
		spaceID  string
		setup    func(*fake.SpaceRepository)
		wantHash string
		wantErr  error
	}{
		{
			name:    "returns current hash",
			userID:  "member1",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "member1", InvitationStatus: "accepted", Role: "member"})
				_ = r.CreateBlob(ctx, "space1", "data/space1.db")
				_, _ = r.UpdateSyncState(ctx, "space1", "hash123", 1024, 0)
			},
			wantHash: "hash123",
		},
		{
			name:    "returns empty string for uninitialized blob",
			userID:  "owner1",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
				_ = r.CreateBlob(ctx, "space1", "data/space1.db")
			},
			wantHash: "",
		},
		{
			name:    "non-member cannot get hash",
			userID:  "outsider",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateBlob(ctx, "space1", "data/space1.db")
			},
			wantErr: domain.ErrSpaceAccessDenied,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)
			svc := application.NewSpaceService(spaceRepo)

			hash, err := svc.GetDatabaseHash(ctx, tt.userID, tt.spaceID)

			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("GetDatabaseHash() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("GetDatabaseHash() unexpected error: %v", err)
			}

			if hash != tt.wantHash {
				t.Errorf("GetDatabaseHash() = %v, want %v", hash, tt.wantHash)
			}
		})
	}
}

func TestSpaceService_UpdateSyncState(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name        string
		userID      string
		spaceID     string
		hash        string
		sizeBytes   int64
		setup       func(*fake.SpaceRepository)
		wantVersion int64
		wantErr     error
	}{
		{
			name:      "first update returns version 1",
			userID:    "member1",
			spaceID:   "space1",
			hash:      "newhash",
			sizeBytes: 2048,
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "member1", InvitationStatus: "accepted", Role: "member"})
				_ = r.CreateBlob(ctx, "space1", "data/space1.db")
			},
			wantVersion: 1,
		},
		{
			name:      "subsequent updates increment version",
			userID:    "member1",
			spaceID:   "space1",
			hash:      "thirdHash",
			sizeBytes: 4096,
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "member1", InvitationStatus: "accepted", Role: "member"})
				_ = r.CreateBlob(ctx, "space1", "data/space1.db")
				_, _ = r.UpdateSyncState(ctx, "space1", "firstHash", 1024, 0)
				_, _ = r.UpdateSyncState(ctx, "space1", "secondHash", 2048, 0)
			},
			wantVersion: 3, // Started at 0, two previous updates made it 2, this update makes it 3
		},
		{
			name:      "non-member cannot update sync state",
			userID:    "outsider",
			spaceID:   "space1",
			hash:      "hackhash",
			sizeBytes: 1024,
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateBlob(ctx, "space1", "data/space1.db")
			},
			wantErr: domain.ErrSpaceAccessDenied,
		},
		{
			name:      "owner can update sync state",
			userID:    "owner1",
			spaceID:   "space1",
			hash:      "ownerhash",
			sizeBytes: 3072,
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
				_ = r.CreateBlob(ctx, "space1", "data/space1.db")
			},
			wantVersion: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)
			svc := application.NewSpaceService(spaceRepo)

			version, err := svc.UpdateSyncState(ctx, tt.userID, tt.spaceID, tt.hash, tt.sizeBytes, 7)

			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("UpdateSyncState() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("UpdateSyncState() unexpected error: %v", err)
			}

			if version != tt.wantVersion {
				t.Errorf("UpdateSyncState() version = %d, want %d", version, tt.wantVersion)
			}

			// Verify blob was updated
			blob, _ := spaceRepo.GetBlob(ctx, tt.spaceID)
			if blob.CurrentHash != tt.hash {
				t.Errorf("CurrentHash = %v, want %v", blob.CurrentHash, tt.hash)
			}
			if blob.SizeBytes != tt.sizeBytes {
				t.Errorf("SizeBytes = %d, want %d", blob.SizeBytes, tt.sizeBytes)
			}
		})
	}
}

func TestSpaceService_CreateInvite(t *testing.T) {
	ctx := context.Background()
	future := time.Now().Add(24 * time.Hour)

	tests := []struct {
		name         string
		spaceID      string
		inviterID    string
		inviteeEmail string
		expiresAt    time.Time
		setup        func(*fake.SpaceRepository)
	}{
		{
			name:         "create basic invite",
			spaceID:      "space1",
			inviterID:    "owner1",
			inviteeEmail: "invitee@example.com",
			expiresAt:    future,
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
			},
		},
		{
			name:         "create invite with empty email",
			spaceID:      "space1",
			inviterID:    "owner1",
			inviteeEmail: "", // Linkable invite without specific email
			expiresAt:    future,
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)
			svc := application.NewSpaceService(spaceRepo)

			testSecretHash := "test-secret-hash-from-client"
			invite, err := svc.CreateInvite(ctx, tt.spaceID, tt.inviterID, tt.inviteeEmail, testSecretHash, tt.expiresAt)

			if err != nil {
				t.Fatalf("CreateInvite() unexpected error: %v", err)
			}

			if invite == nil {
				t.Fatal("CreateInvite() returned nil invite")
				return
			}
			if invite.InviteSecret != testSecretHash {
				t.Errorf("InviteSecret = %v, want %v", invite.InviteSecret, testSecretHash)
			}
			if invite.SpaceID != tt.spaceID {
				t.Errorf("SpaceID = %v, want %v", invite.SpaceID, tt.spaceID)
			}
			if invite.InviterUserID != tt.inviterID {
				t.Errorf("InviterUserID = %v, want %v", invite.InviterUserID, tt.inviterID)
			}
			if invite.InviteeEmail != tt.inviteeEmail {
				t.Errorf("InviteeEmail = %v, want %v", invite.InviteeEmail, tt.inviteeEmail)
			}
			if invite.Status != "pending" {
				t.Errorf("Status = %v, want pending", invite.Status)
			}
			if invite.ID == "" {
				t.Error("ID should not be empty")
			}
			if invite.InviteSecret != testSecretHash {
				t.Errorf("InviteSecret = %v, want %v", invite.InviteSecret, testSecretHash)
			}
		})
	}
}

func TestSpaceService_GetInviteBySecret(t *testing.T) {
	ctx := context.Background()
	future := time.Now().Add(24 * time.Hour)

	tests := []struct {
		name    string
		secret  string
		setup   func(*fake.SpaceRepository)
		wantErr error
	}{
		{
			name:   "get existing invite",
			secret: "valid-secret",
			setup: func(r *fake.SpaceRepository) {
				_ = r.CreateInvite(ctx, &domain.SpaceInvite{
					ID:           "inv1",
					SpaceID:      "space1",
					InviteSecret: "valid-secret",
					ExpiresAt:    &future,
				})
			},
		},
		{
			name:    "non-existent secret returns error",
			secret:  "invalid-secret",
			setup:   func(r *fake.SpaceRepository) {},
			wantErr: domain.ErrInviteNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)
			svc := application.NewSpaceService(spaceRepo)

			invite, err := svc.GetInviteBySecret(ctx, tt.secret)

			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("GetInviteBySecret() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("GetInviteBySecret() unexpected error: %v", err)
			}

			if invite.InviteSecret != tt.secret {
				t.Errorf("InviteSecret = %v, want %v", invite.InviteSecret, tt.secret)
			}
		})
	}
}

func TestSpaceService_UpdateInviteBundle(t *testing.T) {
	ctx := context.Background()
	future := time.Now().Add(24 * time.Hour)

	tests := []struct {
		name     string
		inviteID string
		spaceID  string
		bundle   string
		setup    func(*fake.SpaceRepository)
		wantErr  error
	}{
		{
			name:     "update bundle successfully",
			inviteID: "inv1",
			spaceID:  "space1",
			bundle:   "encrypted-bundle-data",
			setup: func(r *fake.SpaceRepository) {
				_ = r.CreateInvite(ctx, &domain.SpaceInvite{
					ID:           "inv1",
					SpaceID:      "space1",
					InviteSecret: "secret",
					ExpiresAt:    &future,
				})
			},
		},
		{
			name:     "non-existent invite returns error",
			inviteID: "nonexistent",
			spaceID:  "space1",
			bundle:   "bundle",
			setup:    func(r *fake.SpaceRepository) {},
			wantErr:  domain.ErrInviteNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)
			svc := application.NewSpaceService(spaceRepo)

			err := svc.UpdateInviteBundle(ctx, tt.inviteID, tt.spaceID, tt.bundle)

			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("UpdateInviteBundle() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("UpdateInviteBundle() unexpected error: %v", err)
			}

			// Verify bundle was updated
			invites, _ := spaceRepo.ListInvites(ctx, tt.spaceID)
			for _, inv := range invites {
				if inv.ID == tt.inviteID && inv.EncryptedBundle != tt.bundle {
					t.Errorf("EncryptedBundle = %v, want %v", inv.EncryptedBundle, tt.bundle)
				}
			}
		})
	}
}

func TestSpaceService_DeleteInvite(t *testing.T) {
	ctx := context.Background()
	future := time.Now().Add(24 * time.Hour)

	tests := []struct {
		name     string
		inviteID string
		spaceID  string
		setup    func(*fake.SpaceRepository)
	}{
		{
			name:     "delete existing invite",
			inviteID: "inv1",
			spaceID:  "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.CreateInvite(ctx, &domain.SpaceInvite{
					ID:           "inv1",
					SpaceID:      "space1",
					InviteSecret: "secret",
					ExpiresAt:    &future,
				})
			},
		},
		{
			name:     "delete non-existent invite (no error)",
			inviteID: "nonexistent",
			spaceID:  "space1",
			setup:    func(r *fake.SpaceRepository) {},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)
			svc := application.NewSpaceService(spaceRepo)

			err := svc.DeleteInvite(ctx, tt.inviteID, tt.spaceID)

			if err != nil {
				t.Fatalf("DeleteInvite() unexpected error: %v", err)
			}

			// Verify invite was deleted
			invites, _ := spaceRepo.ListInvites(ctx, tt.spaceID)
			for _, inv := range invites {
				if inv.ID == tt.inviteID {
					t.Errorf("Invite %s should have been deleted", tt.inviteID)
				}
			}
		})
	}
}

func TestSpaceService_ListInvites(t *testing.T) {
	ctx := context.Background()
	future := time.Now().Add(24 * time.Hour)

	tests := []struct {
		name      string
		spaceID   string
		setup     func(*fake.SpaceRepository)
		wantCount int
	}{
		{
			name:    "list multiple invites for space",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.CreateInvite(ctx, &domain.SpaceInvite{ID: "inv1", SpaceID: "space1", InviteSecret: "s1", ExpiresAt: &future})
				_ = r.CreateInvite(ctx, &domain.SpaceInvite{ID: "inv2", SpaceID: "space1", InviteSecret: "s2", ExpiresAt: &future})
				_ = r.CreateInvite(ctx, &domain.SpaceInvite{ID: "inv3", SpaceID: "space1", InviteSecret: "s3", ExpiresAt: &future})
			},
			wantCount: 3,
		},
		{
			name:    "empty list for space with no invites",
			spaceID: "space1",
			setup:   func(r *fake.SpaceRepository) {},
			wantCount: 0,
		},
		{
			name:    "only returns invites for specified space",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.CreateInvite(ctx, &domain.SpaceInvite{ID: "inv1", SpaceID: "space1", InviteSecret: "s1", ExpiresAt: &future})
				_ = r.CreateInvite(ctx, &domain.SpaceInvite{ID: "inv2", SpaceID: "space2", InviteSecret: "s2", ExpiresAt: &future})
			},
			wantCount: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)
			svc := application.NewSpaceService(spaceRepo)

			invites, err := svc.ListInvites(ctx, tt.spaceID)

			if err != nil {
				t.Fatalf("ListInvites() unexpected error: %v", err)
			}

			if len(invites) != tt.wantCount {
				t.Errorf("ListInvites() returned %d invites, want %d", len(invites), tt.wantCount)
			}
		})
	}
}

// Edge case tests

func TestSpaceService_ResolveSpaceID_EmptySpaceIDWithMultipleSpaces(t *testing.T) {
	ctx := context.Background()
	spaceRepo := fake.NewSpaceRepository()

	// Create multiple spaces for user
	_ = spaceRepo.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
	_ = spaceRepo.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "user1", InvitationStatus: "accepted"})
	_ = spaceRepo.Create(ctx, &domain.Space{SpaceID: "space2", OwnerUserID: "owner2"})
	_ = spaceRepo.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space2", UserID: "user1", InvitationStatus: "accepted"})

	svc := application.NewSpaceService(spaceRepo)

	// When spaceID is empty, should return first accepted membership
	spaceID, err := svc.ResolveSpaceID(ctx, "user1", "")
	if err != nil {
		t.Fatalf("ResolveSpaceID() unexpected error: %v", err)
	}

	// Should return one of the spaces (implementation may vary)
	if spaceID != testSpaceID && spaceID != testSpaceID2 {
		t.Errorf("ResolveSpaceID() = %v, want %s or %s", spaceID, testSpaceID, testSpaceID2)
	}
}

func TestSpaceService_CreateAndRedeemInviteFlow(t *testing.T) {
	ctx := context.Background()
	spaceRepo := fake.NewSpaceRepository()
	svc := application.NewSpaceService(spaceRepo)

	// Create a space
	summary, err := svc.Create(ctx, "owner1", "Test Space")
	if err != nil {
		t.Fatalf("Create() error: %v", err)
	}

	// Create an invite (client provides secret hash)
	secretHash := "client-provided-secret-hash"
	invite, err := svc.CreateInvite(ctx, summary.SpaceID, "owner1", "invitee@example.com", secretHash, time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatalf("CreateInvite() error: %v", err)
	}

	// Update the bundle (simulating owner providing encrypted key)
	err = svc.UpdateInviteBundle(ctx, invite.ID, summary.SpaceID, "encrypted-bundle")
	if err != nil {
		t.Fatalf("UpdateInviteBundle() error: %v", err)
	}

	// Get invite by secret hash (simulating invitee accessing invite link)
	fetchedInvite, err := svc.GetInviteBySecret(ctx, secretHash)
	if err != nil {
		t.Fatalf("GetInviteBySecret() error: %v", err)
	}

	// Redeem the invite
	err = svc.RedeemInvite(ctx, fetchedInvite, "invitee1", "invitee-encrypted-key")
	if err != nil {
		t.Fatalf("RedeemInvite() error: %v", err)
	}

	// Verify the new member can access the space
	spaces, err := svc.ListForUser(ctx, "invitee1")
	if err != nil {
		t.Fatalf("ListForUser() error: %v", err)
	}

	if len(spaces) != 1 {
		t.Errorf("Expected 1 space for invitee, got %d", len(spaces))
	}
	if len(spaces) > 0 && spaces[0].SpaceID != summary.SpaceID {
		t.Errorf("SpaceID = %v, want %v", spaces[0].SpaceID, summary.SpaceID)
	}

	// Verify member count
	members, err := svc.ListMembers(ctx, "invitee1", summary.SpaceID)
	if err != nil {
		t.Fatalf("ListMembers() error: %v", err)
	}
	if len(members) != 2 {
		t.Errorf("Expected 2 members (owner + invitee), got %d", len(members))
	}
}

func TestSpaceService_SyncStateConsistency(t *testing.T) {
	ctx := context.Background()
	spaceRepo := fake.NewSpaceRepository()
	svc := application.NewSpaceService(spaceRepo)

	// Create a space
	summary, _ := svc.Create(ctx, "owner1", "Sync Test")

	// Initial state should have version 0
	state, err := svc.GetSyncState(ctx, "owner1", summary.SpaceID)
	if err != nil {
		t.Fatalf("GetSyncState() error: %v", err)
	}
	if state.Version != 0 {
		t.Errorf("Initial version = %d, want 0", state.Version)
	}

	// Update sync state multiple times
	for i := 1; i <= 5; i++ {
		version, updateErr := svc.UpdateSyncState(ctx, "owner1", summary.SpaceID, "hash"+string(rune('0'+i)), int64(i*1024), int64(i))
		if updateErr != nil {
			t.Fatalf("UpdateSyncState() iteration %d error: %v", i, updateErr)
		}
		if version != int64(i) {
			t.Errorf("Version after update %d = %d, want %d", i, version, i)
		}
	}

	// Final state check
	state, err = svc.GetSyncState(ctx, "owner1", summary.SpaceID)
	if err != nil {
		t.Fatalf("GetSyncState() error: %v", err)
	}
	if state.Version != 5 {
		t.Errorf("Final version = %d, want 5", state.Version)
	}
	if state.Hash != "hash5" {
		t.Errorf("Final hash = %v, want hash5", state.Hash)
	}
}

func TestSpaceService_MemberRemovalCascade(t *testing.T) {
	ctx := context.Background()
	spaceRepo := fake.NewSpaceRepository()
	svc := application.NewSpaceService(spaceRepo)

	// Create space with owner
	summary, _ := svc.Create(ctx, "owner1", "Cascade Test")

	// Add members
	_ = spaceRepo.CreateMember(ctx, &domain.SpaceMember{
		SpaceID: summary.SpaceID, UserID: "member1",
		InvitationStatus: "accepted", Role: "member",
	})
	_ = spaceRepo.CreateMember(ctx, &domain.SpaceMember{
		SpaceID: summary.SpaceID, UserID: "member2",
		InvitationStatus: "accepted", Role: "member",
	})

	// Verify 3 members
	members, _ := svc.ListMembers(ctx, "owner1", summary.SpaceID)
	if len(members) != 3 {
		t.Errorf("Expected 3 members, got %d", len(members))
	}

	// Remove member1
	err := svc.RemoveMember(ctx, "owner1", summary.SpaceID, "member1")
	if err != nil {
		t.Fatalf("RemoveMember() error: %v", err)
	}

	// Verify 2 members remaining
	members, _ = svc.ListMembers(ctx, "owner1", summary.SpaceID)
	if len(members) != 2 {
		t.Errorf("Expected 2 members after removal, got %d", len(members))
	}

	// Removed member should not have access
	_, err = svc.ListMembers(ctx, "member1", summary.SpaceID)
	if !errors.Is(err, domain.ErrSpaceAccessDenied) {
		t.Errorf("Removed member should not have access, got error: %v", err)
	}
}

func TestSpaceService_IncrementEncryptionKeyVersion(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name        string
		userID      string
		spaceID     string
		setup       func(*fake.SpaceRepository)
		wantVersion int64
		wantErr     error
	}{
		{
			name:    "owner can increment encryption key version",
			userID:  "owner1",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
				_ = r.CreateBlob(ctx, "space1", "data/space1.db")
			},
			wantVersion: 2, // Initial is 1, after increment becomes 2
		},
		{
			name:    "member can increment encryption key version",
			userID:  "member1",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "member1", InvitationStatus: "accepted", Role: "member"})
				_ = r.CreateBlob(ctx, "space1", "data/space1.db")
			},
			wantVersion: 2,
		},
		{
			name:    "non-member cannot increment encryption key version",
			userID:  "outsider",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
				_ = r.CreateBlob(ctx, "space1", "data/space1.db")
			},
			wantErr: domain.ErrSpaceAccessDenied,
		},
		{
			name:    "pending member cannot increment encryption key version",
			userID:  "pending1",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "pending1", InvitationStatus: "pending", Role: "member"})
				_ = r.CreateBlob(ctx, "space1", "data/space1.db")
			},
			wantErr: domain.ErrSpaceAccessDenied,
		},
		{
			name:    "returns error for non-existent space",
			userID:  "user1",
			spaceID: "nonexistent",
			setup:   func(r *fake.SpaceRepository) {},
			wantErr: domain.ErrSpaceAccessDenied,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)
			svc := application.NewSpaceService(spaceRepo)

			version, err := svc.IncrementEncryptionKeyVersion(ctx, tt.userID, tt.spaceID)

			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("IncrementEncryptionKeyVersion() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("IncrementEncryptionKeyVersion() unexpected error: %v", err)
			}

			if version != tt.wantVersion {
				t.Errorf("IncrementEncryptionKeyVersion() = %d, want %d", version, tt.wantVersion)
			}
		})
	}
}

func TestSpaceService_IncrementEncryptionKeyVersion_MultipleIncrements(t *testing.T) {
	ctx := context.Background()
	spaceRepo := fake.NewSpaceRepository()
	svc := application.NewSpaceService(spaceRepo)

	// Create a space
	summary, _ := svc.Create(ctx, "owner1", "Key Version Test")

	// Increment multiple times
	for i := 2; i <= 5; i++ {
		version, err := svc.IncrementEncryptionKeyVersion(ctx, "owner1", summary.SpaceID)
		if err != nil {
			t.Fatalf("IncrementEncryptionKeyVersion() iteration %d error: %v", i, err)
		}
		if version != int64(i) {
			t.Errorf("IncrementEncryptionKeyVersion() iteration %d = %d, want %d", i, version, i)
		}
	}

	// Verify final state includes the key version
	state, err := svc.GetSyncState(ctx, "owner1", summary.SpaceID)
	if err != nil {
		t.Fatalf("GetSyncState() error: %v", err)
	}
	if state.EncryptionKeyVersion != 5 {
		t.Errorf("EncryptionKeyVersion = %d, want 5", state.EncryptionKeyVersion)
	}
}

func TestSpaceService_GetSyncState_IncludesEncryptionKeyVersion(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name               string
		userID             string
		spaceID            string
		setup              func(*fake.SpaceRepository)
		wantKeyVersion     int64
		wantErr            error
	}{
		{
			name:    "returns initial encryption key version of 1",
			userID:  "owner1",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
				_ = r.CreateBlob(ctx, "space1", "data/space1.db")
			},
			wantKeyVersion: 1,
		},
		{
			name:    "returns updated encryption key version after increment",
			userID:  "owner1",
			spaceID: "space1",
			setup: func(r *fake.SpaceRepository) {
				_ = r.Create(ctx, &domain.Space{SpaceID: "space1", OwnerUserID: "owner1"})
				_ = r.CreateMember(ctx, &domain.SpaceMember{SpaceID: "space1", UserID: "owner1", InvitationStatus: "accepted", Role: "owner"})
				_ = r.CreateBlob(ctx, "space1", "data/space1.db")
				// Simulate incrementing the key version
				_, _ = r.IncrementEncryptionKeyVersion(ctx, "space1")
				_, _ = r.IncrementEncryptionKeyVersion(ctx, "space1")
			},
			wantKeyVersion: 3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spaceRepo := fake.NewSpaceRepository()
			tt.setup(spaceRepo)
			svc := application.NewSpaceService(spaceRepo)

			state, err := svc.GetSyncState(ctx, tt.userID, tt.spaceID)

			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("GetSyncState() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("GetSyncState() unexpected error: %v", err)
			}

			if state.EncryptionKeyVersion != tt.wantKeyVersion {
				t.Errorf("EncryptionKeyVersion = %d, want %d", state.EncryptionKeyVersion, tt.wantKeyVersion)
			}
		})
	}
}
