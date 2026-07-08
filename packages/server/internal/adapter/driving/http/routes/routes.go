// Package routes configures API endpoint routing.
package routes

import (
	"budgero-server/internal/adapter/driving/http/handler"
	"budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/application"
	"budgero-server/internal/config"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"
)

// Options configures route setup.
type Options struct {
	SelfHost bool
	Config   *config.Config
}

// SetupRoutes configures all API routes on the Echo instance.
func SetupRoutes(e *echo.Echo, h *handler.Handlers, services *application.Services, opts Options) {
	log.Info().Msg("Setting up routes")

	// API routes
	api := e.Group("/api/v1")

	// Public routes (no auth required)
	api.GET("/health", h.HealthCheck)
	api.HEAD("/health", h.HealthCheck)
	api.GET("/config", h.GetAppConfig)
	api.GET("/version/latest", h.GetLatestVersion)

	// Newsletter signup (public)
	api.POST("/newsletter/subscribe", h.NewsletterSignup)
	// Currency proxy/cache is public to support unauthenticated exchange-rate fetches from clients
	api.GET("/exchange-rates", h.GetExchangeRates)

	if opts.SelfHost {
		api.POST("/auth/local/login", h.SelfHostLogin)
		api.POST("/auth/local/register", h.SelfHostRegister)
	}

	// Webhook route (public, verified by signature)
	if !opts.SelfHost {
		api.POST("/webhooks/lemonsqueezy", h.HandleLemonSqueezyWebhook)
	} else {
		log.Info().Msg("Self-host mode: skipping LemonSqueezy webhook route")
	}

	// WebSocket route (handles auth via query param)
	log.Info().Msg("Registering WebSocket route: /api/v1/ws/sync")
	api.GET("/ws/sync", h.WebSocketHandler)

	// Auth-only routes (JWT required, no subscription check)
	authOnly := api.Group("")
	authOnly.Use(middleware.JWTMiddleware(opts.Config))
	authOnly.Use(middleware.BlockedUserMiddleware(services.User))

	// User profile and subscription management (accessible without active subscription)
	authOnly.GET("/profile", h.GetProfile)
	authOnly.PUT("/profile", h.UpdateProfile)
	authOnly.PUT("/profile/analytics", h.SetAnalyticsDisabled)
	authOnly.PUT("/profile/trial-signals", h.SetTrialSignalsDisabled)
	authOnly.GET("/profile/preferences", h.GetUserPreferences)
	authOnly.PUT("/profile/preferences", h.UpdateUserPreferences)
	authOnly.POST("/profile/onboarding", h.UpdateOnboardingState)
	if !opts.SelfHost {
		authOnly.POST("/profile/activity/heartbeat", h.RecordActivityHeartbeat)
	}
	// In-app feedback widget (SaaS only). Self-host has no central inbox;
	// the button isn't rendered there either, but we gate the route too as
	// a defense in depth.
	if !opts.SelfHost {
		authOnly.POST("/feedback", h.SubmitFeedback)
	} else {
		log.Info().Msg("Self-host mode: skipping feedback route")
	}
	if !opts.SelfHost {
		authOnly.POST("/trial/signal", h.RecordTrialSignal)
		authOnly.GET("/trial/progress", h.GetTrialProgress)
		authOnly.POST("/trial/codes/validate", h.ValidateTrialCode)
		// Dev-only tier manipulation. Gated behind DEV_TOOLS_ENABLED so the
		// routes don't even register in production.
		if opts.Config != nil && opts.Config.Features.DevToolsEnabled {
			log.Warn().Msg("DEV_TOOLS_ENABLED is on — dev trial endpoints registered. DO NOT USE IN PROD.")
			authOnly.POST("/trial/dev/unlock", h.DevForceUnlockTrialTier)
			authOnly.POST("/trial/dev/reset", h.DevResetTrialState)
		}
	}

	if !opts.SelfHost {
		authOnly.GET("/subscription/status", h.GetSubscriptionStatus)
		authOnly.GET("/subscription/details", h.GetSubscriptionDetails)
		authOnly.GET("/subscription/plans", h.GetAvailablePlans)
		authOnly.POST("/subscription/checkout", h.CreateCheckoutSession)
		authOnly.GET("/subscription/portal", h.GetCustomerPortal)
		authOnly.POST("/subscription/cancel", h.CancelSubscription)
		authOnly.POST("/subscription/resume", h.ResumeSubscription)
		authOnly.POST("/subscription/update", h.UpdateSubscriptionPlan)
		authOnly.GET("/subscription/invoices", h.GetSubscriptionInvoices)
	} else {
		log.Info().Msg("Self-host mode: skipping subscription management routes")
	}

	if opts.SelfHost {
		authOnly.POST("/auth/local/password", h.SelfHostUpdatePassword)
	}

	authOnly.POST("/beta/founding-member", h.GrantFoundingMemberAccess) // Admin only
	authOnly.POST("/budget-space-invites/inspect", h.InspectInvite)
	authOnly.POST("/budget-space-invites/redeem", h.RedeemInvite)

	// Budget spaces list (auth only - needed for data export)
	authOnly.GET("/budget-spaces", h.GetBudgetSpaces)

	// Workspace blob export recovery route. Locked owners may still download
	// their encrypted workspace blob so they can export/recover their data.
	workspaceExport := api.Group("")
	workspaceExport.Use(middleware.JWTMiddleware(opts.Config))
	workspaceExport.Use(middleware.BlockedUserMiddleware(services.User))
	if !opts.SelfHost {
		workspaceExport.Use(middleware.RequireWorkspaceBlobExportAccess(services.User, services.Space))
	} else {
		log.Info().Msg("Self-host mode: skipping RequireWorkspaceBlobExportAccess middleware")
	}
	workspaceExport.GET("/database/blob", h.GetDatabaseBlob) // Download encrypted database blob

	// Workspace write routes (allow collaboration-only users to sync/edit shared data)
	workspaceWrite := api.Group("")
	workspaceWrite.Use(middleware.JWTMiddleware(opts.Config))
	workspaceWrite.Use(middleware.BlockedUserMiddleware(services.User))
	if !opts.SelfHost {
		workspaceWrite.Use(middleware.RequireWorkspaceWriteAccess(services.User, services.Space))
	} else {
		log.Info().Msg("Self-host mode: skipping RequireWorkspaceWriteAccess middleware")
	}
	workspaceWrite.PUT("/profile/master-password", h.SetMasterPasswordStatus)
	workspaceWrite.POST("/profile/master-password/reset", h.ResetMasterPassword)
	workspaceWrite.PUT("/profile/backup-settings", h.UpdateBackupSettings)
	workspaceWrite.POST("/profile/backup/record", h.RecordDatabaseBackup)
	workspaceWrite.POST("/database/blob", h.PostDatabaseBlob) // Upload encrypted database blob
	workspaceWrite.POST("/database/upload", h.UploadDatabase) // Legacy upload route

	// Protected routes (require JWT auth AND active subscription)
	protected := api.Group("")
	protected.Use(middleware.JWTMiddleware(opts.Config))
	protected.Use(middleware.BlockedUserMiddleware(services.User))
	if !opts.SelfHost {
		protected.Use(middleware.RequireActiveSubscription(services.User, services.Space))
	} else {
		log.Info().Msg("Self-host mode: skipping RequireActiveSubscription middleware")
	}

	// Budget space management
	// Note: GET /budget-spaces is in authOnly group so users can always export their data
	protected.POST("/budget-spaces", h.CreateBudgetSpace)
	protected.DELETE("/budget-spaces/:spaceID", h.DeleteBudgetSpace)
	protected.PUT("/budget-spaces/:spaceID", h.UpdateBudgetSpace)
	protected.GET("/budget-spaces/:spaceID/members", h.GetBudgetSpaceMembers)
	protected.DELETE("/budget-spaces/:spaceID/members/:memberID", h.RemoveBudgetSpaceMember)
	protected.GET("/budget-spaces/:spaceID/invites", h.ListBudgetSpaceInvites)
	protected.POST("/budget-spaces/:spaceID/invites", h.InviteBudgetSpaceMember)
	protected.DELETE("/budget-spaces/:spaceID/invites/:inviteID", h.CancelBudgetSpaceInvite)
	protected.PUT("/budget-spaces/:spaceID/invites/:inviteID/bundle", h.AttachInviteBundle)
	protected.PUT("/budget-spaces/:spaceID/members/me/encrypted-key", h.UpdateMyEncryptedSpaceKey)
	// NOTE: encryption-key-version is now handled via WebSocket for proper sender exclusion

	// Legacy routes for backward compatibility (can be removed later)
	protected.GET("/database/hash", h.GetDatabaseHash)
	protected.GET("/database/state", h.GetDatabaseState)
	protected.GET("/database/download", h.DownloadDatabase)

	// Offline entitlement issuing: allow any authenticated user; handler enforces eligibility
	authOnly.POST("/offline/entitlement", h.IssueOfflineEntitlement)

	// Public endpoint to expose offline verification public key
	api.GET("/offline/pubkey", h.GetOfflinePubKey)

	// Push API routes
	// Public push endpoint (uses its own token auth, not JWT)
	api.POST("/push", h.PushMutation)
	api.GET("/push/spec", h.GetPushAPISpec) // Public API spec

	// Push API management (requires JWT auth)
	protected.POST("/push/token", h.GeneratePushToken)
	protected.GET("/push/token", h.GetPushTokenStatus)
	protected.PUT("/push/token", h.TogglePushToken)
	protected.DELETE("/push/token", h.RevokePushToken)
	protected.GET("/push/queue", h.GetPushQueue)
	protected.PUT("/push/queue/:id", h.AckPushQueueItem)
	protected.DELETE("/push/queue", h.ClearPushQueue)
	protected.GET("/push/stats", h.GetPushQueueStats)
	protected.GET("/push/info", h.GetPushEncryptionInfo)

	// Admin routes (require JWT auth AND admin role)
	admin := api.Group("/admin")
	admin.Use(middleware.JWTMiddleware(opts.Config))
	admin.Use(middleware.BlockedUserMiddleware(services.User))
	admin.Use(middleware.AdminMiddleware(opts.Config, services.User, services.Credential))

	// Admin dashboard stats
	admin.GET("/stats", h.GetAdminStats)

	// User management
	admin.GET("/users", h.GetAdminUsers)
	admin.GET("/users/:id/details", h.GetAdminUserDetails)
	admin.POST("/users/:id/founding-member", h.GrantAdminFoundingMemberAccess)
	admin.POST("/users/:id/beta-access", h.GrantBetaAccess)
	admin.POST("/users/:id/revoke-access", h.RevokeUserAccess)
	admin.POST("/users/:id/reset-data", h.ResetUserData)
	admin.POST("/users/:id/make-admin", h.MakeAdminInstructions)
	admin.POST("/users/:id/block", h.BlockUser)
	admin.POST("/users/:id/unblock", h.UnblockUser)

	// Sync utilities
	admin.POST("/sync/clerk", h.SyncClerkUsers)
	admin.POST("/sync/mailerlite", h.SyncMailerLiteWithClerkUsers)
	if !opts.SelfHost {
		admin.POST("/sync/lemonsqueezy", h.SyncLemonSqueezy)
	}

	// Migration utilities (cloud only - migrates inactive users to trial system)
	if !opts.SelfHost {
		admin.POST("/migrate/trials", h.MigrateInactiveToTrial)
	}

	// Trial-rewards analytics (cloud only — relies on subscription/trial data
	// that doesn't exist in self-host).
	if !opts.SelfHost {
		admin.GET("/rewards/analytics", h.GetAdminRewardsAnalytics)
		admin.GET("/stickiness", h.GetAdminStickinessAnalytics)
	}

	// Database explorer
	admin.GET("/database/tables", h.GetDatabaseTables)
	admin.GET("/database/tables/:name", h.GetDatabaseTableData)
	admin.PUT("/database/tables/:name/row", h.UpdateDatabaseRow)
	admin.POST("/database/query", h.RunDatabaseQuery)
	admin.GET("/database/queries", h.ListSavedQueries)
	admin.POST("/database/queries", h.SaveQuery)
	admin.DELETE("/database/queries/:name", h.DeleteSavedQuery)

	if opts.SelfHost {
		selfHostAdmin := admin.Group("/selfhost")
		selfHostAdmin.GET("/stats", h.GetSelfHostAdminStats)
		selfHostAdmin.GET("/users", h.GetSelfHostAdminUsers)
		selfHostAdmin.POST("/users", h.CreateSelfHostUser)
		selfHostAdmin.POST("/users/:id/reset-password", h.SelfHostResetUserPassword)
		selfHostAdmin.DELETE("/users/:id", h.DeleteSelfHostUser)
		selfHostAdmin.GET("/database/download", h.DownloadSelfHostDatabase)
	}
}
