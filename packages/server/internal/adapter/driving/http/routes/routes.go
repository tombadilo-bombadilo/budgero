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
	api.GET("/version/latest", h.GetLatestVersion)

	// Currency proxy/cache is public to support unauthenticated exchange-rate fetches from clients
	api.GET("/exchange-rates", h.GetExchangeRates)

	if opts.SelfHost {
		api.GET("/auth/local/config", h.SelfHostAuthConfig)
		api.POST("/auth/local/login", h.SelfHostLogin)
		api.POST("/auth/local/register", h.SelfHostRegister)
	}

	// Webhook route (public, verified by signature)
	if !opts.SelfHost {
		api.POST("/webhooks/lemonsqueezy", h.HandleLemonSqueezyWebhook)
		// One-tap answer links from the day-2 / trial-ending emails (token in
		// the path is the credential; GET never writes).
		api.GET("/email/answer/:token", h.GetEmailAnswer)
		api.POST("/email/answer/:token", h.PostEmailAnswer)
	} else {
		log.Info().Msg("Self-host mode: skipping LemonSqueezy webhook route")
	}

	// WebSocket route (handles auth via query param)
	log.Info().Msg("Registering WebSocket route: /api/v1/ws/sync")
	api.GET("/ws/sync", h.WebSocketHandler)

	// Opaque bank sync relay (Wisp over WebSocket, auth via ticket in path).
	// Only TLS ciphertext to the bank aggregator passes through it.
	api.GET("/bank-relay/:ticket", h.BankRelay)
	api.GET("/bank-relay/:ticket/", h.BankRelay)

	// Auth-only routes (JWT required, no subscription check)
	authOnly := api.Group("")
	authOnly.Use(middleware.JWTMiddleware(opts.Config))
	authOnly.Use(middleware.BlockedUserMiddleware(services.User))

	// User profile and subscription management (accessible without active subscription)
	authOnly.GET("/profile", h.GetProfile)
	authOnly.PUT("/profile", h.UpdateProfile)
	authOnly.PUT("/profile/analytics", h.SetAnalyticsDisabled)
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
	protected.PUT("/budget-spaces/members/me/encrypted-keys", h.UpdateMyEncryptedSpaceKeys)
	// NOTE: encryption-key-version is now handled via WebSocket for proper sender exclusion

	// Bank sync relay tickets (a paid feature, like the rest of sync)
	protected.POST("/bank-relay/ticket", h.IssueBankRelayTicket)

	// Legacy routes for backward compatibility (can be removed later)
	protected.GET("/database/hash", h.GetDatabaseHash)
	protected.GET("/database/state", h.GetDatabaseState)
	protected.GET("/sync/mutations", h.GetMutationLog)
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

	// Inactive users and permanent purge (data, mutation log, Clerk account)
	admin.GET("/users/inactive", h.GetInactiveUsers)
	admin.POST("/users/purge", h.PurgeUsers)

	// Sync utilities
	admin.POST("/sync/clerk", h.SyncClerkUsers)
	if !opts.SelfHost {
		admin.POST("/sync/lemonsqueezy", h.SyncLemonSqueezy)
	}

	// Migration utilities (cloud only - migrates inactive users to trial system)
	if !opts.SelfHost {
		admin.POST("/migrate/trials", h.MigrateInactiveToTrial)
	}

	// Stickiness analytics (cloud only — relies on subscription/trial data
	// that doesn't exist in self-host).
	if !opts.SelfHost {
		admin.GET("/stickiness", h.GetAdminStickinessAnalytics)
		admin.GET("/signups", h.GetAdminSignups)
	}

	// Weekly active self-host installs from the update check (cloud only —
	// self-host servers never record update checks).
	if !opts.SelfHost {
		admin.GET("/selfhost-installs", h.GetAdminSelfHostInstalls)
	}

	// Quarterly feedback broadcast (cloud only — needs the Resend email service)
	if !opts.SelfHost {
		admin.GET("/broadcast/feedback", h.GetFeedbackBroadcastStatus)
		admin.POST("/broadcast/feedback", h.SendFeedbackBroadcast)
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
		selfHostAdmin.GET("/registration", h.GetSelfHostRegistration)
		selfHostAdmin.PUT("/registration", h.UpdateSelfHostRegistration)
		selfHostAdmin.GET("/stats", h.GetSelfHostAdminStats)
		selfHostAdmin.GET("/users", h.GetSelfHostAdminUsers)
		selfHostAdmin.POST("/users", h.CreateSelfHostUser)
		selfHostAdmin.POST("/users/:id/reset-password", h.SelfHostResetUserPassword)
		selfHostAdmin.DELETE("/users/:id", h.DeleteSelfHostUser)
		selfHostAdmin.GET("/database/download", h.DownloadSelfHostDatabase)
	}
}
