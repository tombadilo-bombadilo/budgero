package handler

import (
	"net/http"

	"budgero-server/internal/adapter/driving/http/middleware"

	"github.com/labstack/echo/v4"
)

// GrantFoundingMemberAccess grants founding member status (admin only)
func (h *Handlers) GrantFoundingMemberAccess(c echo.Context) error {
	// Admin check
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	user, err := h.services.User.GetByID(ctx, userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not found")
	}
	if !h.checkIsAdmin(ctx, user) {
		return echo.NewHTTPError(http.StatusForbidden, "admin access required")
	}

	var req struct {
		UserID string `json:"user_id" validate:"required"`
	}

	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request")
	}

	if err := h.services.Entitlement.GrantFoundingMember(ctx, req.UserID); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to grant founding member access")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"message": "Founding member access granted",
		"user_id": req.UserID,
	})
}
