package handler

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"budgero-server/internal/adapter/driven/mailerlite"
	"budgero-server/internal/domain"

	clerk "github.com/clerk/clerk-sdk-go/v2"
	clerkuser "github.com/clerk/clerk-sdk-go/v2/user"
	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"
)

const defaultAdminUserDetailsWindowDays = 365

// GetAdminStats returns dashboard statistics
func (h *Handlers) GetAdminStats(c echo.Context) error {
	if h.selfHostMode {
		return echo.NewHTTPError(http.StatusNotFound, "saas admin dashboard unavailable in self-host mode")
	}

	ctx := c.Request().Context()
	stats, err := h.services.Admin.GetStats(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get stats")
	}

	// Fetch MRR from LemonSqueezy via subscription service
	if revenueStats, err := h.subscriptionSvc.GetRevenueStats(); err != nil {
		log.Warn().Err(err).Msg("Failed to fetch revenue stats")
		stats.MRR = int(stats.PaidUsers) * 800
		stats.TotalRevenue = stats.MRR
	} else {
		stats.MRR = revenueStats.MRR
		stats.TotalRevenue = revenueStats.TotalRevenue
	}

	return c.JSON(http.StatusOK, stats)
}

// GetAdminUsers returns all users with detailed information
func (h *Handlers) GetAdminUsers(c echo.Context) error {
	if h.selfHostMode {
		return echo.NewHTTPError(http.StatusNotFound, "saas admin users unavailable in self-host mode")
	}

	ctx := c.Request().Context()
	users, err := h.services.Admin.ListUsers(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to query users")
	}

	return c.JSON(http.StatusOK, users)
}

// GetAdminUserDetails returns an aggregated admin details payload for a single SaaS user.
func (h *Handlers) GetAdminUserDetails(c echo.Context) error {
	if h.selfHostMode {
		return echo.NewHTTPError(http.StatusNotFound, "saas admin users unavailable in self-host mode")
	}

	windowDays := defaultAdminUserDetailsWindowDays
	if rawWindowDays := strings.TrimSpace(c.QueryParam("windowDays")); rawWindowDays != "" {
		parsed, err := strconv.Atoi(rawWindowDays)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid windowDays")
		}
		windowDays = parsed
	}

	details, err := h.services.Admin.GetUserDetails(c.Request().Context(), c.Param("id"), windowDays)
	if err != nil {
		return mapServiceError(err)
	}

	return c.JSON(http.StatusOK, details)
}

// GrantAdminFoundingMemberAccess grants lifetime access to a user (admin version)
func (h *Handlers) GrantAdminFoundingMemberAccess(c echo.Context) error {
	userID := c.Param("id")
	ctx := c.Request().Context()

	if err := h.services.Entitlement.GrantFoundingMember(ctx, userID); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to grant founding member access")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Founding member access granted",
	})
}

// GrantBetaAccess grants beta access to a user
func (h *Handlers) GrantBetaAccess(c echo.Context) error {
	userID := c.Param("id")
	ctx := c.Request().Context()

	var req struct {
		Days int `json:"days"`
	}
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request")
	}

	if req.Days <= 0 {
		req.Days = 30
	}

	expiresAt := time.Now().AddDate(0, 0, req.Days)
	if err := h.services.Entitlement.GrantBetaAccess(ctx, userID, expiresAt); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to grant beta access")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Beta access granted for %d days", req.Days),
	})
}

// RevokeUserAccess revokes all access for a user
func (h *Handlers) RevokeUserAccess(c echo.Context) error {
	userID := c.Param("id")
	ctx := c.Request().Context()

	if err := h.services.Admin.RevokeAllAccess(ctx, userID); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to revoke access")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Access revoked",
	})
}

// ResetUserData clears a user's stored data flags and deletes their database file.
func (h *Handlers) ResetUserData(c echo.Context) error {
	userID := c.Param("id")
	if userID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "user id is required")
	}

	ctx := c.Request().Context()
	spaceIDs, err := h.services.User.ResetData(ctx, userID)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "user not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to reset user data")
	}

	if h.syncHub != nil {
		for _, spaceID := range spaceIDs {
			if err := h.syncHub.ResetSpace(spaceID); err != nil {
				log.Error().Err(err).Str("user_id", userID).Str("space_id", spaceID).Msg("failed to reset sync state for space")
			}
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "User data reset successfully",
	})
}

// MakeAdminInstructions returns instructions for granting a user admin
// access. Admin status is derived from the ADMIN_EMAILS configuration, not
// persisted, so this handler only looks the user up and reports the email to
// add.
func (h *Handlers) MakeAdminInstructions(c echo.Context) error {
	userID := c.Param("id")
	ctx := c.Request().Context()

	user, err := h.services.User.GetByID(ctx, userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "user not found")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("To complete admin setup, add %s to ADMIN_EMAILS environment variable", user.Email),
	})
}

// BlockUser marks a user as blocked, preventing login/API access.
func (h *Handlers) BlockUser(c echo.Context) error {
	userID := c.Param("id")
	ctx := c.Request().Context()

	if err := h.services.User.Block(ctx, userID, true); err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "user not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to block user")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "User blocked",
	})
}

// UnblockUser removes the block flag from a user.
func (h *Handlers) UnblockUser(c echo.Context) error {
	userID := c.Param("id")
	ctx := c.Request().Context()

	if err := h.services.User.Block(ctx, userID, false); err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "user not found")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to unblock user")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "User unblocked",
	})
}

// SyncClerkUsers pulls users from Clerk and ensures local DB entries are created/updated.
func (h *Handlers) SyncClerkUsers(c echo.Context) error {
	ctx := c.Request().Context()
	res, err := h.syncClerkUsers(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, res)
}

// SyncMailerLiteWithClerkUsers ensures all Clerk users are subscribed in MailerLite.
func (h *Handlers) SyncMailerLiteWithClerkUsers(c echo.Context) error {
	if h.cfg.Auth.ClerkSecretKey == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "CLERK_SECRET_KEY not configured")
	}
	clerk.SetKey(h.cfg.Auth.ClerkSecretKey)

	if !h.cfg.HasMailerLite() {
		return echo.NewHTTPError(http.StatusBadRequest, "MAILERLITE_API_KEY not configured")
	}

	type Result struct {
		TotalClerkUsers   int `json:"totalClerkUsers"`
		Attempted         int `json:"attempted"`
		Subscribed        int `json:"subscribed"`
		AlreadySubscribed int `json:"alreadySubscribed"`
		Skipped           int `json:"skipped"`
		Failed            int `json:"failed"`
	}

	res := Result{}
	seenEmails := make(map[string]struct{})

	ctx := c.Request().Context()
	page := int64(0)
	limit := int64(100)

	for {
		params := &clerkuser.ListParams{}
		params.Limit = clerk.Int64(limit)
		params.Offset = clerk.Int64(page * limit)

		list, err := clerkuser.List(ctx, params)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, fmt.Sprintf("failed to list clerk users: %v", err))
		}
		if len(list.Users) == 0 {
			break
		}

		for _, cu := range list.Users {
			res.TotalClerkUsers++

			email := extractClerkEmail(cu)
			cleanEmail := strings.TrimSpace(email)
			lowerEmail := strings.ToLower(cleanEmail)
			if cleanEmail == "" || lowerEmail == "" || strings.HasSuffix(lowerEmail, "@clerk.user") {
				res.Skipped++
				continue
			}
			if _, exists := seenEmails[lowerEmail]; exists {
				res.Skipped++
				continue
			}
			seenEmails[lowerEmail] = struct{}{}

			name := extractClerkFullName(cu)

			res.Attempted++
			mlClient := mailerlite.NewClient(h.cfg.External.MailerLiteAPIKey, h.cfg.External.MailerLiteGroupID)
			status, err := mlClient.AddSubscriber(cleanEmail, name)
			if err != nil {
				if status == http.StatusConflict {
					res.AlreadySubscribed++
					continue
				}

				res.Failed++
				log.Warn().Err(err).
					Str("clerk_user_id", cu.ID).
					Str("email", cleanEmail).
					Int("status", status).
					Msg("Failed to sync Clerk user with MailerLite")
				continue
			}

			res.Subscribed++
		}

		page++
	}

	return c.JSON(http.StatusOK, res)
}

// SyncLemonSqueezy refreshes subscription status for users with a subscription ID.
func (h *Handlers) SyncLemonSqueezy(c echo.Context) error {
	if err := h.ensureSubscriptionsEnabled(); err != nil {
		return err
	}
	ctx := c.Request().Context()
	res, err := h.syncLemonSqueezySubscriptions(ctx)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	return c.JSON(http.StatusOK, res)
}

// MigrateInactiveToTrial migrates existing inactive users to the self-managed trial system.
func (h *Handlers) MigrateInactiveToTrial(c echo.Context) error {
	trialDays := h.cfg.Features.TrialDurationDays
	if trialDays <= 0 {
		trialDays = 35
	}

	ctx := c.Request().Context()
	rowsAffected, err := h.services.Admin.BackfillTrialForInactiveUsers(ctx, trialDays)
	if err != nil {
		log.Error().Err(err).Msg("Failed to migrate inactive users to trial")
		return echo.NewHTTPError(http.StatusInternalServerError, "migration failed: "+err.Error())
	}

	log.Info().Int64("users_migrated", rowsAffected).Int("trial_days", trialDays).Msg("Successfully migrated inactive users to trial")

	return c.JSON(http.StatusOK, map[string]interface{}{
		"status":         "ok",
		"users_migrated": rowsAffected,
		"trial_days":     trialDays,
	})
}

// Helper functions for Clerk user extraction
func extractClerkEmail(cu *clerk.User) string {
	if cu.PrimaryEmailAddressID != nil {
		for _, ea := range cu.EmailAddresses {
			if ea.ID == *cu.PrimaryEmailAddressID {
				return ea.EmailAddress
			}
		}
	}
	if len(cu.EmailAddresses) > 0 {
		return cu.EmailAddresses[0].EmailAddress
	}
	return cu.ID + "@clerk.user"
}

func extractClerkName(cu *clerk.User) string {
	if cu.FirstName != nil && *cu.FirstName != "" {
		return *cu.FirstName
	}
	if cu.Username != nil && *cu.Username != "" {
		return *cu.Username
	}
	return "User"
}

// GetAdminStickinessAnalytics returns DAU/MAU stickiness series + signup-
// cohort retention matrix. Query params:
//
//	from         RFC3339 timestamp. Defaults to 90 days ago.
//	to           RFC3339 timestamp. Defaults to now.
//	cohort       one of "daily" | "weekly" | "monthly". Defaults to "weekly".
//	max_day_n    integer 1..180. Defaults to 30.
//
// SaaS-only: returns 404 in self-host mode.
func (h *Handlers) GetAdminStickinessAnalytics(c echo.Context) error {
	if h.selfHostMode {
		return echo.NewHTTPError(http.StatusNotFound, "saas admin dashboard unavailable in self-host mode")
	}

	now := time.Now().UTC()
	from := now.Add(-90 * 24 * time.Hour)
	to := now
	cohortGranularity := domain.RewardsGranularityWeekly
	maxDayN := 30

	if s := c.QueryParam("from"); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid from: must be RFC3339")
		}
		from = t
	}
	if s := c.QueryParam("to"); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid to: must be RFC3339")
		}
		to = t
	}
	if s := c.QueryParam("cohort"); s != "" {
		g := domain.RewardsAnalyticsGranularity(strings.ToLower(s))
		if !g.IsValid() {
			return echo.NewHTTPError(http.StatusBadRequest, "cohort must be daily, weekly, or monthly")
		}
		cohortGranularity = g
	}
	if s := c.QueryParam("max_day_n"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > 180 {
			return echo.NewHTTPError(http.StatusBadRequest, "max_day_n must be an integer in [1,180]")
		}
		maxDayN = n
	}
	if !from.Before(to) {
		return echo.NewHTTPError(http.StatusBadRequest, "from must be before to")
	}

	out, err := h.services.Admin.GetStickinessAnalytics(c.Request().Context(), domain.StickinessAnalyticsParams{
		From:              from,
		To:                to,
		CohortGranularity: cohortGranularity,
		MaxDayN:           maxDayN,
	})
	if err != nil {
		log.Error().Err(err).Msg("stickiness analytics query failed")
		return echo.NewHTTPError(http.StatusInternalServerError, "analytics query failed")
	}
	return c.JSON(http.StatusOK, out)
}

// GetAdminRewardsAnalytics returns time-series and signup-cohort funnel
// data for the trial-rewards admin dashboard. Query params:
//
//	from         RFC3339 timestamp (inclusive). Defaults to 30 days ago.
//	to           RFC3339 timestamp (exclusive). Defaults to now.
//	granularity  one of "daily" | "weekly" | "monthly". Defaults to "daily".
//
// SaaS-only: returns 404 in self-host mode.
func (h *Handlers) GetAdminRewardsAnalytics(c echo.Context) error {
	if h.selfHostMode {
		return echo.NewHTTPError(http.StatusNotFound, "saas admin dashboard unavailable in self-host mode")
	}

	now := time.Now().UTC()
	from := now.Add(-30 * 24 * time.Hour)
	to := now
	granularity := domain.RewardsGranularityDaily

	if s := c.QueryParam("from"); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid from: must be RFC3339")
		}
		from = t
	}
	if s := c.QueryParam("to"); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid to: must be RFC3339")
		}
		to = t
	}
	if s := c.QueryParam("granularity"); s != "" {
		g := domain.RewardsAnalyticsGranularity(strings.ToLower(s))
		if !g.IsValid() {
			return echo.NewHTTPError(http.StatusBadRequest, "granularity must be daily, weekly, or monthly")
		}
		granularity = g
	}
	if !from.Before(to) {
		return echo.NewHTTPError(http.StatusBadRequest, "from must be before to")
	}

	out, err := h.services.Admin.GetRewardsAnalytics(c.Request().Context(), domain.RewardsAnalyticsParams{
		From:        from,
		To:          to,
		Granularity: granularity,
	})
	if err != nil {
		log.Error().Err(err).Msg("rewards analytics query failed")
		return echo.NewHTTPError(http.StatusInternalServerError, "analytics query failed")
	}
	return c.JSON(http.StatusOK, out)
}

func extractClerkFullName(cu *clerk.User) string {
	name := ""
	if cu.FirstName != nil && strings.TrimSpace(*cu.FirstName) != "" {
		name = strings.TrimSpace(*cu.FirstName)
	}
	if cu.LastName != nil && strings.TrimSpace(*cu.LastName) != "" {
		if name == "" {
			name = strings.TrimSpace(*cu.LastName)
		} else {
			name = strings.TrimSpace(name + " " + *cu.LastName)
		}
	}
	if name == "" && cu.Username != nil {
		name = strings.TrimSpace(*cu.Username)
	}
	if name == "" {
		name = "User"
	}
	return name
}
