package middleware

import (
	"context"
	"net/http"
	"strings"

	"budgero-server/internal/config"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driving"

	"github.com/labstack/echo/v4"
)

// BlockedUserMiddleware denies requests for accounts that have been blocked.
func BlockedUserMiddleware(userService driving.UserService) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			userID := GetUserIDFromContext(c)
			if userID == "" {
				return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
			}
			ctx := c.Request().Context()
			blocked, err := userService.IsBlocked(ctx, userID)
			if err == nil && blocked {
				return echo.NewHTTPError(http.StatusForbidden, "account is blocked")
			}
			return next(c)
		}
	}
}

// CheckWorkspaceAccess resolves a workspace and applies the canonical SaaS access policy.
func CheckWorkspaceAccess(
	ctx context.Context,
	userID string,
	requestedSpaceID string,
	userService driving.UserService,
	spaceService driving.SpaceService,
) (string, *domain.SpaceSummary, error) {
	user, err := userService.GetByID(ctx, userID)
	if err != nil {
		return "", nil, echo.NewHTTPError(http.StatusUnauthorized, "user not found")
	}

	spaces, err := spaceService.ListForUser(ctx, userID)
	if err != nil {
		return "", nil, echo.NewHTTPError(http.StatusForbidden, "space access denied")
	}

	if requestedSpaceID == "" {
		for i := range spaces {
			if strings.EqualFold(spaces[i].InvitationStatus, domain.InvitationAccepted) &&
				spaces[i].IsAccessible {
				return "", nil, nil
			}
		}

		if user.HasOwnerWorkspaceSubscription() {
			return "", nil, nil
		}

		for i := range spaces {
			space := spaces[i]
			if strings.EqualFold(space.Role, domain.RoleMember) &&
				strings.EqualFold(space.InvitationStatus, domain.InvitationAccepted) &&
				space.AccessReason == domain.SpaceAccessReasonSharedOwnerInactive {
				return "", nil, echo.NewHTTPError(
					http.StatusPaymentRequired,
					"Shared workspace access is unavailable until the owner renews their subscription",
				)
			}
		}

		return "", nil, echo.NewHTTPError(http.StatusPaymentRequired, "Active subscription required")
	}

	resolvedID, err := spaceService.ResolveSpaceID(ctx, userID, requestedSpaceID)
	if err != nil {
		return "", nil, echo.NewHTTPError(http.StatusForbidden, "space access denied")
	}

	var summary *domain.SpaceSummary
	for i := range spaces {
		if spaces[i].SpaceID == resolvedID {
			summary = &spaces[i]
			break
		}
	}
	if summary == nil {
		return "", nil, echo.NewHTTPError(http.StatusForbidden, "space access denied")
	}

	if summary.IsAccessible {
		return resolvedID, summary, nil
	}

	if strings.EqualFold(summary.Role, domain.RoleOwner) {
		return "", summary, echo.NewHTTPError(
			http.StatusPaymentRequired,
			"Active subscription required for owned workspaces",
		)
	}

	if strings.EqualFold(summary.InvitationStatus, domain.InvitationAccepted) &&
		summary.AccessReason == domain.SpaceAccessReasonSharedOwnerInactive {
		return "", summary, echo.NewHTTPError(
			http.StatusPaymentRequired,
			"Shared workspace access is unavailable until the owner renews their subscription",
		)
	}

	return "", summary, echo.NewHTTPError(http.StatusForbidden, "space access denied")
}

func resolveWorkspaceHint(c echo.Context) string {
	spaceHint := strings.TrimSpace(c.QueryParam("space_id"))
	if spaceHint == "" {
		spaceHint = strings.TrimSpace(c.Param("spaceID"))
	}
	return spaceHint
}

func checkWorkspaceBlobExportAccess(
	ctx context.Context,
	userID string,
	requestedSpaceID string,
	userService driving.UserService,
	spaceService driving.SpaceService,
) (string, *domain.SpaceSummary, error) {
	requested := strings.TrimSpace(requestedSpaceID)
	if requested == "" {
		return CheckWorkspaceAccess(ctx, userID, requestedSpaceID, userService, spaceService)
	}

	spaces, err := spaceService.ListForUser(ctx, userID)
	if err != nil {
		return "", nil, echo.NewHTTPError(http.StatusForbidden, "space access denied")
	}

	var summary *domain.SpaceSummary
	for i := range spaces {
		space := spaces[i]
		if space.SpaceID == requested {
			summary = &spaces[i]
			break
		}
	}
	if summary == nil {
		return "", nil, echo.NewHTTPError(http.StatusForbidden, "space access denied")
	}

	if !strings.EqualFold(summary.InvitationStatus, domain.InvitationAccepted) {
		return "", summary, echo.NewHTTPError(http.StatusForbidden, "space access denied")
	}

	if summary.IsAccessible {
		return requested, summary, nil
	}

	if strings.EqualFold(summary.Role, domain.RoleOwner) {
		return requested, summary, nil
	}

	if summary.AccessReason == domain.SpaceAccessReasonSharedOwnerInactive {
		return "", summary, echo.NewHTTPError(
			http.StatusPaymentRequired,
			"Shared workspace access is unavailable until the owner renews their subscription",
		)
	}

	return "", summary, echo.NewHTTPError(http.StatusForbidden, "space access denied")
}

// RequireActiveSubscription enforces owner subscription requirements and
// allows collaboration-only users on member workspaces.
func RequireActiveSubscription(
	userService driving.UserService,
	spaceService driving.SpaceService,
) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			userID := GetUserIDFromContext(c)
			if userID == "" {
				return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
			}

			ctx := c.Request().Context()
			if _, _, err := CheckWorkspaceAccess(
				ctx,
				userID,
				resolveWorkspaceHint(c),
				userService,
				spaceService,
			); err != nil {
				return err
			}

			return next(c)
		}
	}
}

// RequireWorkspaceWriteAccess applies the same access policy as
// RequireActiveSubscription for workspace write operations.
func RequireWorkspaceWriteAccess(
	userService driving.UserService,
	spaceService driving.SpaceService,
) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			userID := GetUserIDFromContext(c)
			if userID == "" {
				return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
			}

			ctx := c.Request().Context()
			if _, _, err := CheckWorkspaceAccess(
				ctx,
				userID,
				resolveWorkspaceHint(c),
				userService,
				spaceService,
			); err != nil {
				return err
			}

			return next(c)
		}
	}
}

// RequireWorkspaceBlobExportAccess allows encrypted blob download for
// accepted owner workspaces even when the owner's subscription has lapsed,
// so they can recover/export their data without restoring full app access.
func RequireWorkspaceBlobExportAccess(
	userService driving.UserService,
	spaceService driving.SpaceService,
) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			userID := GetUserIDFromContext(c)
			if userID == "" {
				return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
			}

			ctx := c.Request().Context()
			if _, _, err := checkWorkspaceBlobExportAccess(
				ctx,
				userID,
				resolveWorkspaceHint(c),
				userService,
				spaceService,
			); err != nil {
				return err
			}

			return next(c)
		}
	}
}

// AdminMiddleware checks if the current user is an admin.
func AdminMiddleware(cfg *config.Config, userService driving.UserService, credentialService driving.CredentialService) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			userID := GetUserIDFromContext(c)
			if userID == "" {
				return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
			}

			ctx := c.Request().Context()

			// Check if user exists
			user, err := userService.GetByID(ctx, userID)
			if err != nil {
				return echo.NewHTTPError(http.StatusUnauthorized, "user not found")
			}

			// Check admin status
			var isAdmin bool
			if cfg.Auth.SelfHostable {
				isAdmin = IsSelfHostAdminFromContext(c) || credentialService.IsAdmin(ctx, userID)
			} else {
				isAdmin = cfg.IsAdmin(user.Email)
			}

			if !isAdmin {
				return echo.NewHTTPError(http.StatusForbidden, "admin access required")
			}

			return next(c)
		}
	}
}
