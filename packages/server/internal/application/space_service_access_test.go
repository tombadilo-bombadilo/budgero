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

const testOwnerID = "owner-1"

func TestSpaceServiceResolveSpaceID_SkipsLockedOwnedSpace(t *testing.T) {
	ctx := context.Background()
	spaceRepo := fake.NewSpaceRepository()
	userRepo := fake.NewUserRepository()
	svc := application.NewSpaceService(spaceRepo, userRepo, nil)

	now := time.Now()
	activeTrialEnd := now.Add(7 * 24 * time.Hour)

	userID := "user-1"
	ownerID := testOwnerID
	ownedSpaceID := "owned-space"
	sharedSpaceID := "shared-space"

	if _, err := userRepo.Create(ctx, &domain.User{
		ID:                 userID,
		Email:              "user@example.com",
		Name:               "User",
		SubscriptionStatus: domain.SubscriptionExpired,
	}); err != nil {
		t.Fatalf("failed to seed user: %v", err)
	}
	if _, err := userRepo.Create(ctx, &domain.User{
		ID:                 ownerID,
		Email:              "owner@example.com",
		Name:               "Owner",
		SubscriptionStatus: domain.SubscriptionTrialing,
		TrialEndsAt:        &activeTrialEnd,
	}); err != nil {
		t.Fatalf("failed to seed owner: %v", err)
	}

	if err := spaceRepo.Create(ctx, &domain.Space{SpaceID: ownedSpaceID, OwnerUserID: userID, DisplayName: "Owned"}); err != nil {
		t.Fatalf("failed to create owned space: %v", err)
	}
	if err := spaceRepo.Create(ctx, &domain.Space{SpaceID: sharedSpaceID, OwnerUserID: ownerID, DisplayName: "Shared"}); err != nil {
		t.Fatalf("failed to create shared space: %v", err)
	}
	if err := spaceRepo.CreateMember(ctx, &domain.SpaceMember{
		SpaceID:          ownedSpaceID,
		UserID:           userID,
		Role:             domain.RoleOwner,
		InvitationStatus: domain.InvitationAccepted,
		InvitedAt:        now,
		AcceptedAt:       &now,
	}); err != nil {
		t.Fatalf("failed to create owned membership: %v", err)
	}
	if err := spaceRepo.CreateMember(ctx, &domain.SpaceMember{
		SpaceID:          sharedSpaceID,
		UserID:           ownerID,
		Role:             domain.RoleOwner,
		InvitationStatus: domain.InvitationAccepted,
		InvitedAt:        now,
		AcceptedAt:       &now,
	}); err != nil {
		t.Fatalf("failed to create owner membership: %v", err)
	}
	if err := spaceRepo.CreateMember(ctx, &domain.SpaceMember{
		SpaceID:          sharedSpaceID,
		UserID:           userID,
		Role:             domain.RoleMember,
		InvitationStatus: domain.InvitationAccepted,
		InvitedAt:        now,
		AcceptedAt:       &now,
	}); err != nil {
		t.Fatalf("failed to create shared membership: %v", err)
	}

	resolvedID, err := svc.ResolveSpaceID(ctx, userID, "")
	if err != nil {
		t.Fatalf("ResolveSpaceID() error = %v", err)
	}
	if resolvedID != sharedSpaceID {
		t.Fatalf("ResolveSpaceID() = %q, want %q", resolvedID, sharedSpaceID)
	}
}

func TestSpaceServiceCreateInvite_EnforcesSeatLimit(t *testing.T) {
	ctx := context.Background()
	spaceRepo := fake.NewSpaceRepository()
	svc := application.NewSpaceService(spaceRepo)
	now := time.Now()
	spaceID := "space-limit"

	if err := spaceRepo.Create(ctx, &domain.Space{SpaceID: spaceID, OwnerUserID: testOwnerID, DisplayName: "Limited"}); err != nil {
		t.Fatalf("failed to create space: %v", err)
	}
	for i := 0; i < domain.MaxOwnedCollaboratorSeats-1; i++ {
		memberID := "member-" + string(rune('a'+i))
		if err := spaceRepo.CreateMember(ctx, &domain.SpaceMember{
			SpaceID:          spaceID,
			UserID:           memberID,
			Role:             domain.RoleMember,
			InvitationStatus: domain.InvitationAccepted,
			InvitedAt:        now,
			AcceptedAt:       &now,
		}); err != nil {
			t.Fatalf("failed to create member %d: %v", i, err)
		}
	}
	if err := spaceRepo.CreateInvite(ctx, &domain.SpaceInvite{
		ID:            "pending-1",
		SpaceID:       spaceID,
		InviterUserID: testOwnerID,
		InviteSecret:  "secret-1",
		Status:        domain.InvitationPending,
		CreatedAt:     now,
	}); err != nil {
		t.Fatalf("failed to create pending invite: %v", err)
	}

	_, err := svc.CreateInvite(ctx, spaceID, testOwnerID, "", "secret-2", now.Add(24*time.Hour))
	if err == nil {
		t.Fatal("expected seat limit error")
	}
	if !errors.Is(err, domain.ErrSpaceMemberLimitReached) {
		t.Fatalf("CreateInvite() error = %v, want %v", err, domain.ErrSpaceMemberLimitReached)
	}
}

func TestSpaceServiceRedeemInvite_FailsWhenSpaceBecomesFull(t *testing.T) {
	ctx := context.Background()
	spaceRepo := fake.NewSpaceRepository()
	svc := application.NewSpaceService(spaceRepo)
	now := time.Now()
	spaceID := "space-redeem-limit"

	if err := spaceRepo.Create(ctx, &domain.Space{SpaceID: spaceID, OwnerUserID: testOwnerID, DisplayName: "Limited"}); err != nil {
		t.Fatalf("failed to create space: %v", err)
	}
	for i := 0; i < domain.MaxOwnedCollaboratorSeats; i++ {
		memberID := "member-" + string(rune('a'+i))
		if err := spaceRepo.CreateMember(ctx, &domain.SpaceMember{
			SpaceID:          spaceID,
			UserID:           memberID,
			Role:             domain.RoleMember,
			InvitationStatus: domain.InvitationAccepted,
			InvitedAt:        now,
			AcceptedAt:       &now,
		}); err != nil {
			t.Fatalf("failed to create member %d: %v", i, err)
		}
	}

	invite := &domain.SpaceInvite{
		ID:              "invite-1",
		SpaceID:         spaceID,
		InviterUserID:   testOwnerID,
		InviteSecret:    "secret-1",
		EncryptedBundle: "bundle",
		Status:          domain.InvitationPending,
		CreatedAt:       now,
	}
	if err := spaceRepo.CreateInvite(ctx, invite); err != nil {
		t.Fatalf("failed to create invite: %v", err)
	}

	err := svc.RedeemInvite(ctx, invite, "late-user", "wrapped-key")
	if err == nil {
		t.Fatal("expected seat limit error")
	}
	if !errors.Is(err, domain.ErrSpaceMemberLimitReached) {
		t.Fatalf("RedeemInvite() error = %v, want %v", err, domain.ErrSpaceMemberLimitReached)
	}
}

func TestSpaceServiceCreateInvite_EnforcesOwnerWideSeatLimitAcrossWorkspaces(t *testing.T) {
	ctx := context.Background()
	spaceRepo := fake.NewSpaceRepository()
	svc := application.NewSpaceService(spaceRepo)
	now := time.Now()
	ownerID := testOwnerID
	spaceA := "space-a"
	spaceB := "space-b"

	if err := spaceRepo.Create(ctx, &domain.Space{SpaceID: spaceA, OwnerUserID: ownerID, DisplayName: "A"}); err != nil {
		t.Fatalf("failed to create space A: %v", err)
	}
	if err := spaceRepo.Create(ctx, &domain.Space{SpaceID: spaceB, OwnerUserID: ownerID, DisplayName: "B"}); err != nil {
		t.Fatalf("failed to create space B: %v", err)
	}

	for _, spaceID := range []string{spaceA, spaceB} {
		if err := spaceRepo.CreateMember(ctx, &domain.SpaceMember{
			SpaceID:          spaceID,
			UserID:           ownerID,
			Role:             domain.RoleOwner,
			InvitationStatus: domain.InvitationAccepted,
			InvitedAt:        now,
			AcceptedAt:       &now,
		}); err != nil {
			t.Fatalf("failed to create owner membership for %s: %v", spaceID, err)
		}
	}

	for i := 0; i < 4; i++ {
		memberID := "member-" + string(rune('a'+i))
		if err := spaceRepo.CreateMember(ctx, &domain.SpaceMember{
			SpaceID:          spaceA,
			UserID:           memberID,
			Role:             domain.RoleMember,
			InvitationStatus: domain.InvitationAccepted,
			InvitedAt:        now,
			AcceptedAt:       &now,
		}); err != nil {
			t.Fatalf("failed to create member %d: %v", i, err)
		}
	}
	if err := spaceRepo.CreateInvite(ctx, &domain.SpaceInvite{
		ID:            "pending-a",
		SpaceID:       spaceA,
		InviterUserID: ownerID,
		InviteSecret:  "secret-a",
		Status:        domain.InvitationPending,
		CreatedAt:     now,
	}); err != nil {
		t.Fatalf("failed to create pending invite: %v", err)
	}

	_, err := svc.CreateInvite(ctx, spaceB, ownerID, "", "secret-b", now.Add(24*time.Hour))
	if err == nil {
		t.Fatal("expected owner-wide seat limit error")
	}
	if !errors.Is(err, domain.ErrSpaceMemberLimitReached) {
		t.Fatalf("CreateInvite() error = %v, want %v", err, domain.ErrSpaceMemberLimitReached)
	}
}

func TestSpaceServiceCreateInvite_IgnoresRedeemedAndExpiredInvitesForOwnerWideLimit(t *testing.T) {
	ctx := context.Background()
	spaceRepo := fake.NewSpaceRepository()
	svc := application.NewSpaceService(spaceRepo)
	now := time.Now()
	ownerID := testOwnerID
	spaceID := "space-a"

	if err := spaceRepo.Create(ctx, &domain.Space{SpaceID: spaceID, OwnerUserID: ownerID, DisplayName: "A"}); err != nil {
		t.Fatalf("failed to create space: %v", err)
	}
	if err := spaceRepo.CreateMember(ctx, &domain.SpaceMember{
		SpaceID:          spaceID,
		UserID:           ownerID,
		Role:             domain.RoleOwner,
		InvitationStatus: domain.InvitationAccepted,
		InvitedAt:        now,
		AcceptedAt:       &now,
	}); err != nil {
		t.Fatalf("failed to create owner membership: %v", err)
	}
	for i := 0; i < 4; i++ {
		memberID := "member-" + string(rune('a'+i))
		if err := spaceRepo.CreateMember(ctx, &domain.SpaceMember{
			SpaceID:          spaceID,
			UserID:           memberID,
			Role:             domain.RoleMember,
			InvitationStatus: domain.InvitationAccepted,
			InvitedAt:        now,
			AcceptedAt:       &now,
		}); err != nil {
			t.Fatalf("failed to create member %d: %v", i, err)
		}
	}
	if err := spaceRepo.CreateInvite(ctx, &domain.SpaceInvite{
		ID:            "invite-redeemed",
		SpaceID:       spaceID,
		InviterUserID: ownerID,
		InviteSecret:  "secret-redeemed",
		Status:        "redeemed",
		CreatedAt:     now,
	}); err != nil {
		t.Fatalf("failed to create redeemed invite: %v", err)
	}
	if err := spaceRepo.CreateInvite(ctx, &domain.SpaceInvite{
		ID:            "invite-expired",
		SpaceID:       spaceID,
		InviterUserID: ownerID,
		InviteSecret:  "secret-expired",
		Status:        "expired",
		CreatedAt:     now,
	}); err != nil {
		t.Fatalf("failed to create expired invite: %v", err)
	}

	if _, err := svc.CreateInvite(ctx, spaceID, ownerID, "", "secret-new", now.Add(24*time.Hour)); err != nil {
		t.Fatalf("CreateInvite() unexpected error: %v", err)
	}
}
