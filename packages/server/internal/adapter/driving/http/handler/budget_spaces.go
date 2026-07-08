package handler

import (
	"context"
	"net/http"
	"strings"
	"time"

	"budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/domain"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"
)

type createSpaceRequest struct {
	DisplayName string `json:"display_name"`
}

type inviteMemberRequest struct {
	Email        string     `json:"email"`
	InviteSecret string     `json:"invite_secret"`
	ExpiresAt    *time.Time `json:"expires_at"`
}

type updateSpaceRequest struct {
	DisplayName *string `json:"display_name"`
}

type attachInviteBundleRequest struct {
	EncryptedBundle string `json:"encrypted_bundle"`
}

type updateEncryptedKeyRequest struct {
	EncryptedSpaceKey string `json:"encrypted_space_key"`
}

type inviteSecretRequest struct {
	InviteSecret string `json:"invite_secret"`
}

type redeemInviteRequest struct {
	InviteSecret      string `json:"invite_secret"`
	EncryptedSpaceKey string `json:"encrypted_space_key"`
}

// GetBudgetSpaces returns all spaces the authenticated user belongs to.
func (h *Handlers) GetBudgetSpaces(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	spaces, err := h.services.Space.ListForUser(ctx, userID)
	if err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("failed to list budget spaces")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to list budget spaces")
	}

	return c.JSON(http.StatusOK, spaces)
}

// CreateBudgetSpace creates a new shared space owned by the current user.
func (h *Handlers) CreateBudgetSpace(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	var req createSpaceRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	ctx := c.Request().Context()
	space, err := h.usecases.CreateSpace.Execute(ctx, userID, req.DisplayName)
	if err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("failed to create budget space")
		return mapServiceError(err)
	}

	return c.JSON(http.StatusCreated, space)
}

// DeleteBudgetSpace permanently deletes an owned workspace.
func (h *Handlers) DeleteBudgetSpace(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	spaceID := c.Param("spaceID")
	if spaceID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "space id is required")
	}

	ctx := c.Request().Context()
	if err := h.usecases.DeleteSpace.Execute(ctx, userID, spaceID); err != nil {
		return mapServiceError(err)
	}

	// Clear the mutation log and disconnect any live sockets for the deleted
	// space; otherwise connected clients keep streaming into a dead space.
	if h.syncHub != nil {
		if err := h.syncHub.ResetSpace(spaceID); err != nil {
			log.Error().Err(err).Str("space_id", spaceID).Msg("failed to reset sync state after space deletion")
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to reset sync state")
		}
	}

	return c.JSON(http.StatusOK, map[string]any{"success": true})
}

// UpdateBudgetSpace updates mutable attributes like the display name.
func (h *Handlers) UpdateBudgetSpace(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	spaceID := c.Param("spaceID")
	if spaceID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "space id is required")
	}

	var req updateSpaceRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	ctx := c.Request().Context()
	if req.DisplayName != nil {
		if err := h.services.Space.UpdateDisplayName(ctx, userID, spaceID, *req.DisplayName); err != nil {
			return mapServiceError(err)
		}
	}

	return c.JSON(http.StatusOK, map[string]any{"success": true})
}

// GetBudgetSpaceMembers lists all members for a space.
func (h *Handlers) GetBudgetSpaceMembers(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	spaceID := c.Param("spaceID")
	if spaceID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "space id is required")
	}

	ctx := c.Request().Context()
	members, err := h.services.Space.ListMembers(ctx, userID, spaceID)
	if err != nil {
		return mapServiceError(err)
	}

	return c.JSON(http.StatusOK, members)
}

// InviteBudgetSpaceMember creates a new invite for the space.
func (h *Handlers) InviteBudgetSpaceMember(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	spaceID := c.Param("spaceID")
	if spaceID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "space id is required")
	}

	var req inviteMemberRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	ctx := c.Request().Context()
	expiresAt := time.Now().AddDate(0, 0, 7) // Default 7 days
	if req.ExpiresAt != nil {
		expiresAt = *req.ExpiresAt
	}

	if req.InviteSecret == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "invite_secret is required")
	}

	invite, err := h.usecases.CreateInvite.Execute(
		ctx,
		userID,
		spaceID,
		req.Email,
		req.InviteSecret,
		expiresAt,
	)
	if err != nil {
		return mapServiceError(err)
	}

	return c.JSON(http.StatusCreated, map[string]any{
		"id":            invite.ID,
		"space_id":      invite.SpaceID,
		"invitee_email": invite.InviteeEmail,
		"expires_at":    invite.ExpiresAt,
		"status":        invite.Status,
	})
}

// ListBudgetSpaceInvites returns outstanding invites for a space.
func (h *Handlers) ListBudgetSpaceInvites(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	spaceID := c.Param("spaceID")
	if spaceID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "space id is required")
	}

	ctx := c.Request().Context()
	invites, err := h.usecases.ListInvites.Execute(ctx, userID, spaceID)
	if err != nil {
		return mapServiceError(err)
	}

	return c.JSON(http.StatusOK, invites)
}

// CancelBudgetSpaceInvite cancels a pending invite.
func (h *Handlers) CancelBudgetSpaceInvite(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	spaceID := c.Param("spaceID")
	inviteID := c.Param("inviteID")
	if spaceID == "" || inviteID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "space id and invite id are required")
	}

	ctx := c.Request().Context()
	if err := h.usecases.DeleteInvite.Execute(ctx, userID, inviteID, spaceID); err != nil {
		return mapServiceError(err)
	}

	return c.JSON(http.StatusOK, map[string]any{"success": true})
}

// RemoveBudgetSpaceMember removes a member from the space.
func (h *Handlers) RemoveBudgetSpaceMember(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	spaceID := c.Param("spaceID")
	memberID := c.Param("memberID")
	if spaceID == "" || memberID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "space id and member id are required")
	}

	ctx := c.Request().Context()
	if err := h.services.Space.RemoveMember(ctx, userID, spaceID, memberID); err != nil {
		return mapServiceError(err)
	}

	// Revoked members must not keep a live mutation stream for the space.
	if h.syncHub != nil {
		h.syncHub.CloseUserClients(spaceID, memberID)
	}

	if err := h.reconcileCollaborationAccessAfterMemberRemoval(ctx, memberID); err != nil {
		return err
	}

	return c.JSON(http.StatusOK, map[string]any{"success": true})
}

func (h *Handlers) reconcileCollaborationAccessAfterMemberRemoval(ctx context.Context, memberID string) error {
	spaces, err := h.services.Space.ListForUser(ctx, memberID)
	if err != nil {
		log.Error().Err(err).Str("member_id", memberID).Msg("failed to list spaces during collaboration access reconciliation")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to reconcile collaboration access")
	}

	for i := range spaces {
		if spaces[i].Role == domain.RoleMember &&
			strings.EqualFold(spaces[i].InvitationStatus, domain.InvitationAccepted) {
			return nil
		}
	}

	if err := h.services.Entitlement.SetCollaborationAccess(ctx, memberID, false); err != nil {
		log.Error().Err(err).Str("member_id", memberID).Msg("failed to revoke collaboration access after member removal")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update collaboration access")
	}

	return nil
}

// AttachInviteBundle stores the encrypted invite bundle for a pending invite.
func (h *Handlers) AttachInviteBundle(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	spaceID := c.Param("spaceID")
	inviteID := c.Param("inviteID")
	if spaceID == "" || inviteID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "space id and invite id are required")
	}

	var req attachInviteBundleRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	ctx := c.Request().Context()
	if err := h.usecases.UpdateBundle.Execute(ctx, userID, inviteID, spaceID, req.EncryptedBundle); err != nil {
		return mapServiceError(err)
	}

	return c.JSON(http.StatusOK, map[string]any{"success": true})
}

// InspectInvite reveals invite metadata for the provided invite secret.
func (h *Handlers) InspectInvite(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	var req inviteSecretRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	ctx := c.Request().Context()
	info, err := h.services.Space.GetInviteBySecret(ctx, req.InviteSecret)
	if err != nil {
		return mapServiceError(err)
	}

	return c.JSON(http.StatusOK, info)
}

// RedeemInvite allows an authenticated user to join a workspace using an invite secret.
func (h *Handlers) RedeemInvite(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	var req redeemInviteRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	ctx := c.Request().Context()
	invite, err := h.services.Space.GetInviteBySecret(ctx, req.InviteSecret)
	if err != nil {
		return mapServiceError(err)
	}

	if err := h.services.Space.RedeemInvite(ctx, invite, userID, req.EncryptedSpaceKey); err != nil {
		return mapServiceError(err)
	}
	if err := h.services.Entitlement.SetCollaborationAccess(ctx, userID, true); err != nil {
		log.Error().Err(err).Str("user_id", userID).Str("space_id", invite.SpaceID).Msg("failed to grant collaboration access after invite redemption")
		return mapServiceError(err)
	}

	return c.JSON(http.StatusOK, map[string]any{
		"space_id":     invite.SpaceID,
		"display_name": invite.SpaceDisplayName,
	})
}

// UpdateMyEncryptedSpaceKey updates the encrypted key for the current user in the specified workspace.
func (h *Handlers) UpdateMyEncryptedSpaceKey(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	spaceID := c.Param("spaceID")
	if spaceID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "space id is required")
	}

	var req updateEncryptedKeyRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	ctx := c.Request().Context()
	if err := h.services.Space.UpdateMemberEncryptedKey(ctx, userID, spaceID, req.EncryptedSpaceKey); err != nil {
		return mapServiceError(err)
	}

	return c.JSON(http.StatusOK, map[string]any{"success": true})
}
