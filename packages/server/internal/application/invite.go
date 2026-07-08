package application

import (
	"context"
	"fmt"
	"time"

	"budgero-server/internal/domain"
	"budgero-server/internal/port/driving"

	"github.com/rs/zerolog/log"
)

// CreateInviteUsecase orchestrates invite creation with access checks.
type CreateInviteUsecase struct {
	users        driving.UserService
	spaces       driving.SpaceService
	entitlements driving.EntitlementService
}

// NewCreateInviteUsecase creates a new CreateInviteUsecase.
func NewCreateInviteUsecase(users driving.UserService, spaces driving.SpaceService, entitlements driving.EntitlementService) *CreateInviteUsecase {
	return &CreateInviteUsecase{
		users:        users,
		spaces:       spaces,
		entitlements: entitlements,
	}
}

// Execute creates an invite after checking ownership and entitlements.
func (uc *CreateInviteUsecase) Execute(ctx context.Context, userID, spaceID, inviteeEmail, inviteSecretHash string, expiresAt time.Time) (*domain.SpaceInvite, error) {
	// Check user entitlements
	user, err := uc.users.GetByID(ctx, userID)
	if err != nil {
		return nil, err
	}

	if !uc.entitlements.HasWorkspaceAccess(user) {
		return nil, domain.ErrCollaborationRestricted
	}

	// Verify ownership
	resolvedID, err := uc.spaces.ResolveSpaceID(ctx, userID, spaceID)
	if err != nil {
		return nil, err
	}

	isOwner, err := uc.spaces.IsOwner(ctx, userID, resolvedID)
	if err != nil {
		return nil, err
	}

	if !isOwner {
		return nil, domain.ErrSpaceAccessDenied
	}

	return uc.spaces.CreateInvite(ctx, resolvedID, userID, inviteeEmail, inviteSecretHash, expiresAt)
}

// DeleteInviteUsecase orchestrates invite deletion with ownership check.
type DeleteInviteUsecase struct {
	spaces driving.SpaceService
}

// NewDeleteInviteUsecase creates a new DeleteInviteUsecase.
func NewDeleteInviteUsecase(spaces driving.SpaceService) *DeleteInviteUsecase {
	return &DeleteInviteUsecase{
		spaces: spaces,
	}
}

// Execute deletes an invite after checking ownership.
func (uc *DeleteInviteUsecase) Execute(ctx context.Context, userID, inviteID, spaceID string) error {
	// Verify ownership
	resolvedID, err := uc.spaces.ResolveSpaceID(ctx, userID, spaceID)
	if err != nil {
		return err
	}

	isOwner, err := uc.spaces.IsOwner(ctx, userID, resolvedID)
	if err != nil {
		return err
	}

	if !isOwner {
		return domain.ErrSpaceAccessDenied
	}

	return uc.spaces.DeleteInvite(ctx, inviteID, resolvedID)
}

// ListInvitesUsecase orchestrates listing invites with access check.
type ListInvitesUsecase struct {
	spaces driving.SpaceService
}

// NewListInvitesUsecase creates a new ListInvitesUsecase.
func NewListInvitesUsecase(spaces driving.SpaceService) *ListInvitesUsecase {
	return &ListInvitesUsecase{
		spaces: spaces,
	}
}

// Execute lists invites for a space after checking access.
func (uc *ListInvitesUsecase) Execute(ctx context.Context, userID, spaceID string) ([]domain.SpaceInvite, error) {
	resolvedID, err := uc.spaces.ResolveSpaceID(ctx, userID, spaceID)
	if err != nil {
		return nil, err
	}

	return uc.spaces.ListInvites(ctx, resolvedID)
}

// UpdateInviteBundleUsecase orchestrates updating invite bundles with access check.
type UpdateInviteBundleUsecase struct {
	spaces driving.SpaceService
}

// NewUpdateInviteBundleUsecase creates a new UpdateInviteBundleUsecase.
func NewUpdateInviteBundleUsecase(spaces driving.SpaceService) *UpdateInviteBundleUsecase {
	return &UpdateInviteBundleUsecase{
		spaces: spaces,
	}
}

// Execute updates an invite's encrypted bundle after checking access.
func (uc *UpdateInviteBundleUsecase) Execute(ctx context.Context, userID, inviteID, spaceID, bundle string) error {
	resolvedID, err := uc.spaces.ResolveSpaceID(ctx, userID, spaceID)
	if err != nil {
		return err
	}

	// Consistent with create/delete invite: only the owner may modify invites.
	isOwner, err := uc.spaces.IsOwner(ctx, userID, resolvedID)
	if err != nil {
		return err
	}
	if !isOwner {
		return domain.ErrSpaceAccessDenied
	}

	return uc.spaces.UpdateInviteBundle(ctx, inviteID, resolvedID, bundle)
}

// CreateSpaceUsecase orchestrates space creation with entitlement checks.
type CreateSpaceUsecase struct {
	users        driving.UserService
	spaces       driving.SpaceService
	entitlements driving.EntitlementService
}

// NewCreateSpaceUsecase creates a new CreateSpaceUsecase.
func NewCreateSpaceUsecase(users driving.UserService, spaces driving.SpaceService, entitlements driving.EntitlementService) *CreateSpaceUsecase {
	return &CreateSpaceUsecase{
		users:        users,
		spaces:       spaces,
		entitlements: entitlements,
	}
}

// Execute creates a new space after checking user entitlements.
func (uc *CreateSpaceUsecase) Execute(ctx context.Context, userID, displayName string) (*domain.SpaceSummary, error) {
	user, err := uc.users.GetByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	if !uc.entitlements.HasWorkspaceAccess(user) {
		return nil, domain.ErrCollaborationRestricted
	}

	space, err := uc.spaces.Create(ctx, userID, displayName)
	if err != nil {
		return nil, err
	}

	// Set as primary space if user doesn't have one
	if user.PrimarySpaceID == "" {
		if err := uc.users.SetPrimarySpace(ctx, userID, space.SpaceID); err != nil {
			log.Warn().Err(err).Str("user_id", userID).Str("space_id", space.SpaceID).Msg("failed to set primary space")
		}
	}

	return space, nil
}

// DeleteSpaceUsecase orchestrates deleting an owned workspace.
type DeleteSpaceUsecase struct {
	spaces driving.SpaceService
}

// NewDeleteSpaceUsecase creates a new DeleteSpaceUsecase.
func NewDeleteSpaceUsecase(spaces driving.SpaceService) *DeleteSpaceUsecase {
	return &DeleteSpaceUsecase{spaces: spaces}
}

// Execute permanently deletes an owned workspace.
func (uc *DeleteSpaceUsecase) Execute(ctx context.Context, userID, spaceID string) error {
	return uc.spaces.Delete(ctx, userID, spaceID)
}
