package application

import (
	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/config"
	"budgero-server/internal/port/driven/external"
	"budgero-server/internal/port/driven/repository"
	"budgero-server/internal/port/driving"
)

// Services is a container for all application services.
type Services struct {
	User            driving.UserService
	Space           driving.SpaceService
	Credential      driving.CredentialService
	Entitlement     driving.EntitlementService
	Sync            driving.SyncService
	Push            driving.PushService
	ExchangeRate    driving.ExchangeRateService
	Activity        driving.ActivityService
	Admin           driving.AdminService
	DatabaseBrowser driving.DatabaseBrowserService
	Feedback        driving.FeedbackService
	UpdatePing      driving.UpdatePingService
	UserPurge       driving.UserPurgeService
	// SnapshotHistory keeps replaced workspace snapshots for restore.
	SnapshotHistory driving.SnapshotHistoryService
	// Analytics is the server-side product analytics tracker. It drops
	// everything on self-host and when POSTHOG_KEY is unset.
	Analytics driving.AnalyticsTracker
}

// Repositories is a container for all repository dependencies.
type Repositories struct {
	User            repository.UserRepository
	Space           repository.SpaceRepository
	Credential      repository.CredentialRepository
	Entitlement     repository.EntitlementRepository
	Sync            repository.SyncRepository
	Push            repository.PushRepository
	ExchangeRate    repository.ExchangeRateRepository
	Activity        repository.ActivityRepository
	Admin           repository.AdminRepository
	DatabaseBrowser repository.DatabaseBrowserRepository
	// Feedback is the SaaS-only user-feedback repo. Wired in both modes
	// (cheap to construct, no external deps) but the route that uses it is
	// only registered in SaaS builds.
	Feedback repository.FeedbackRepository
	// UpdatePing aggregates anonymous update-check counts. Same deal as
	// Feedback: wired in both modes, only ever written on SaaS.
	UpdatePing repository.UpdatePingRepository
	// UserPurge permanently deletes users and every row tied to them.
	UserPurge repository.UserPurgeRepository
	// CurrencyProvider fetches daily exchange rates from the external
	// dataset (or a self-hosted mirror).
	CurrencyProvider external.CurrencyProvider
	// AnalyticsSender ships server-side analytics events. Nil disables them.
	AnalyticsSender external.AnalyticsSender
	// Telemetry records aggregate server metrics. Nil records nothing.
	Telemetry external.Telemetry
	Queries   *sqlc.Queries
}

// NewServices creates all application services with their dependencies.
func NewServices(repos *Repositories, cfg *config.Config) *Services {
	tracker := NewAnalyticsService(repos.AnalyticsSender, repos.User, AnalyticsOptions{Telemetry: repos.Telemetry})
	users := NewUserService(repos.User, repos.Space, cfg)
	users.SetAnalytics(tracker)
	return &Services{
		Analytics:       tracker,
		User:            users,
		Space:           NewSpaceService(repos.Space, repos.User, cfg),
		Credential:      NewCredentialService(repos.Credential, cfg),
		Entitlement:     NewEntitlementService(repos.Entitlement, repos.User, cfg),
		Sync:            NewSyncService(repos.Sync),
		Push:            NewPushService(repos.Push),
		ExchangeRate:    NewExchangeRateService(repos.ExchangeRate, repos.CurrencyProvider),
		Activity:        NewActivityService(repos.Activity),
		Admin:           NewAdminService(repos.Admin, repos.Activity, repos.Space, repos.Queries, cfg),
		DatabaseBrowser: NewDatabaseBrowserService(repos.DatabaseBrowser, repos.Queries),
		Feedback:        NewFeedbackService(repos.Feedback),
		UpdatePing:      NewUpdatePingService(repos.UpdatePing),
		UserPurge:       NewUserPurgeService(repos.UserPurge),
		SnapshotHistory: NewSnapshotHistoryService(repos.Space, cfg),
	}
}
