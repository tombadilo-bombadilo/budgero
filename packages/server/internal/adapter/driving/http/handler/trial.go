package handler

import (
	"net/http"
	"time"

	"budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/domain"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"
)

// TrialSignalRequest is the body of POST /api/v1/trial/signal.
type TrialSignalRequest struct {
	Kind string `json:"kind"`
	// Month is YYYY-MM, required for the *_in_month signal kinds (assignment_in_month,
	// transaction_in_month). Ignored for other kinds.
	Month string `json:"month,omitempty"`
}

// RecordTrialSignal accepts a behavior signal from the client and forwards
// it to the trial-rewards service. Validates the signal kind against the
// strict allowlist; the service silently drops signals from analytics-
// disabled users or users without an active trial.
func (h *Handlers) RecordTrialSignal(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	var req TrialSignalRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	kind := domain.SignalKind(req.Kind)
	if !kind.IsValid() {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid signal kind")
	}

	if err := h.services.TrialRewards.RecordSignal(c.Request().Context(), userID, kind, time.Now(), req.Month); err != nil {
		log.Error().Err(err).
			Str("user_id", userID).
			Str("kind", string(kind)).
			Str("month", req.Month).
			Msg("failed to record trial signal")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to record signal")
	}

	return c.NoContent(http.StatusNoContent)
}

// TrialProgressResponse is the body of GET /api/v1/trial/progress.
type TrialProgressResponse struct {
	Progress *domain.TrialProgress  `json:"progress"`
	Codes    []domain.DiscountCode  `json:"codes"`
	Tiers    []TrialTierDescription `json:"tiers"`
	Counts   TrialProgressCounts    `json:"counts"`
}

// TrialProgressCounts is derived from trial_signals (not stored on the
// progress row). Powers per-criterion progress display for T3.
type TrialProgressCounts struct {
	AssignmentDistinctMonths  int `json:"assignment_distinct_months"`
	TransactionDistinctMonths int `json:"transaction_distinct_months"`
	// TransactionCount is the total transactions logged — powers the Tier 1
	// progress display ("X/5 transactions").
	TransactionCount int `json:"transaction_count"`
}

// TrialTierDescription is a static catalog entry the client can render
// without hard-coding tier metadata. Returned alongside progress.
type TrialTierDescription struct {
	Tier       int    `json:"tier"`
	PercentOff int    `json:"percent_off"`
	Name       string `json:"name"`
}

// GetTrialProgress returns the user's tier progress and earned codes.
func (h *Handlers) GetTrialProgress(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	progress, codes, err := h.services.TrialRewards.GetProgress(c.Request().Context(), userID)
	if err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("failed to get trial progress")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to load progress")
	}

	if codes == nil {
		codes = []domain.DiscountCode{}
	}

	assignmentMonths, transactionMonths, transactionCount, err := h.services.TrialRewards.GetProgressCounts(c.Request().Context(), userID)
	if err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("failed to get trial progress counts")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to load progress")
	}

	return c.JSON(http.StatusOK, TrialProgressResponse{
		Progress: progress,
		Codes:    codes,
		Tiers:    trialTierCatalog(),
		Counts: TrialProgressCounts{
			AssignmentDistinctMonths:  assignmentMonths,
			TransactionDistinctMonths: transactionMonths,
			TransactionCount:          transactionCount,
		},
	})
}

// TrialValidateCodeRequest is the body of POST /api/v1/trial/codes/validate.
type TrialValidateCodeRequest struct {
	Code string `json:"code"`
}

// TrialValidateCodeResponse describes an approved code returned to the
// client. Sensitive fields like LSDiscountID are intentionally omitted.
type TrialValidateCodeResponse struct {
	Code       string    `json:"code"`
	Tier       int       `json:"tier"`
	PercentOff int       `json:"percent_off"`
	ValidUntil time.Time `json:"valid_until"`
}

// ValidateTrialCode confirms a code belongs to the requesting user and is
// in its validity window. Returns 200 with the code metadata or 400 with a
// reason. Used by the client right before kicking off checkout.
func (h *Handlers) ValidateTrialCode(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	var req TrialValidateCodeRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if req.Code == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "code is required")
	}

	code, err := h.services.TrialRewards.ValidateCodeForUser(c.Request().Context(), userID, req.Code)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	return c.JSON(http.StatusOK, TrialValidateCodeResponse{
		Code:       code.Code,
		Tier:       int(code.Tier),
		PercentOff: code.PercentOff,
		ValidUntil: code.ValidUntil,
	})
}

// DevTrialUnlockRequest is the body of POST /api/v1/trial/dev/unlock.
type DevTrialUnlockRequest struct {
	Tier int `json:"tier"`
}

// DevForceUnlockTrialTier force-unlocks a tier for the calling user without
// criteria. Route is gated by DEV_TOOLS_ENABLED at the routes layer; reaching
// this handler in production is a configuration mistake.
func (h *Handlers) DevForceUnlockTrialTier(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	var req DevTrialUnlockRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	tier := domain.RewardTier(req.Tier)
	if !tier.IsValid() {
		return echo.NewHTTPError(http.StatusBadRequest, "tier must be 1, 2, or 3")
	}
	if err := h.services.TrialRewards.DevForceUnlock(c.Request().Context(), userID, tier); err != nil {
		log.Error().Err(err).Str("user_id", userID).Int("tier", req.Tier).
			Msg("dev: force-unlock failed")
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.NoContent(http.StatusNoContent)
}

// DevResetTrialState wipes the calling user's rewards state.
func (h *Handlers) DevResetTrialState(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	if err := h.services.TrialRewards.DevReset(c.Request().Context(), userID); err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("dev: reset failed")
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.NoContent(http.StatusNoContent)
}

func trialTierCatalog() []TrialTierDescription {
	return []TrialTierDescription{
		{Tier: int(domain.RewardTier1), PercentOff: domain.RewardTier1.PercentOff(), Name: "Foundation"},
		{Tier: int(domain.RewardTier2), PercentOff: domain.RewardTier2.PercentOff(), Name: "Habit"},
		{Tier: int(domain.RewardTier3), PercentOff: domain.RewardTier3.PercentOff(), Name: "Mastery"},
	}
}
