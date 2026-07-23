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
	TrialRewards    driving.TrialRewardsService
	Feedback        driving.FeedbackService
	UpdatePing      driving.UpdatePingService
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
	TrialRewards    repository.TrialRewardsRepository
	// Feedback is the SaaS-only user-feedback repo. Wired in both modes
	// (cheap to construct, no external deps) but the route that uses it is
	// only registered in SaaS builds.
	Feedback repository.FeedbackRepository
	// UpdatePing aggregates anonymous update-check counts. Same deal as
	// Feedback: wired in both modes, only ever written on SaaS.
	UpdatePing repository.UpdatePingRepository
	Queries    *sqlc.Queries

	// DiscountIssuer is optional. When nil, the trial-rewards service mints
	// local codes only; it does not register them with the payment provider.
	// Wired in by the SaaS startup; left nil in self-host and tests.
	DiscountIssuer external.DiscountIssuer
}

// NewServices creates all application services with their dependencies.
func NewServices(repos *Repositories, cfg *config.Config) *Services {
	return &Services{
		User:            NewUserService(repos.User, repos.Space, cfg),
		Space:           NewSpaceService(repos.Space, repos.User, cfg),
		Credential:      NewCredentialService(repos.Credential, cfg),
		Entitlement:     NewEntitlementService(repos.Entitlement, repos.User, cfg),
		Sync:            NewSyncService(repos.Sync),
		Push:            NewPushService(repos.Push),
		ExchangeRate:    NewExchangeRateService(repos.ExchangeRate),
		Activity:        NewActivityService(repos.Activity),
		Admin:           NewAdminService(repos.Admin, repos.Activity, repos.Space, repos.Queries, cfg),
		DatabaseBrowser: NewDatabaseBrowserService(repos.DatabaseBrowser, repos.Queries),
		TrialRewards:    NewTrialRewardsService(repos.TrialRewards, repos.User, repos.DiscountIssuer, cfg),
		Feedback:        NewFeedbackService(repos.Feedback),
		UpdatePing:      NewUpdatePingService(repos.UpdatePing),
	}
}
