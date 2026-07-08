package handler

import (
	"errors"
	"net/http"
	"strings"

	"budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/application"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driving"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"
)

// SubmitFeedbackRequest is the body of POST /api/v1/feedback.
type SubmitFeedbackRequest struct {
	Category    string `json:"category"`
	Body        string `json:"body"`
	ContactBack bool   `json:"contact_back"`
	// ScreenPath is the in-app route the user was on when they hit Send.
	// Client-supplied because the server only sees /api/v1/feedback.
	ScreenPath string `json:"screen_path"`
	// AppVersion is the build constant baked in at app build time.
	AppVersion string `json:"app_version"`
}

// SubmitFeedbackResponse confirms the row landed; the client uses it to
// flip to the "Got it. Thank you." state.
type SubmitFeedbackResponse struct {
	ID        string `json:"id"`
	CreatedAt string `json:"created_at"`
}

// truncate caps a string to n bytes — used for ScreenPath / AppVersion /
// UserAgent so a hostile client can't fill rows with megabytes of metadata.
// Body is enforced by the service (`maxFeedbackBodyLen`).
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// SubmitFeedback records a feedback submission from the authenticated user.
// SaaS-only at the route layer (self-host doesn't register this endpoint).
func (h *Handlers) SubmitFeedback(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	var req SubmitFeedbackRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	fb, err := h.services.Feedback.Submit(c.Request().Context(), userID, &driving.FeedbackSubmission{
		Category:    domain.FeedbackCategory(strings.ToLower(strings.TrimSpace(req.Category))),
		Body:        req.Body,
		ContactBack: req.ContactBack,
		ScreenPath:  truncate(req.ScreenPath, 256),
		AppVersion:  truncate(req.AppVersion, 64),
		UserAgent:   truncate(c.Request().UserAgent(), 512),
	})
	if err != nil {
		switch {
		case errors.Is(err, application.ErrFeedbackCategoryInvalid):
			return echo.NewHTTPError(http.StatusBadRequest, "invalid category")
		case errors.Is(err, application.ErrFeedbackBodyEmpty):
			return echo.NewHTTPError(http.StatusBadRequest, "body is required")
		case errors.Is(err, application.ErrFeedbackBodyTooLong):
			return echo.NewHTTPError(http.StatusBadRequest, "body too long")
		}
		log.Error().Err(err).Str("user_id", userID).Msg("failed to submit feedback")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to submit feedback")
	}

	return c.JSON(http.StatusCreated, SubmitFeedbackResponse{
		ID:        fb.ID,
		CreatedAt: fb.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	})
}
