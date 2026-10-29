// Package driving defines interfaces for application services.
// These are "driving" or "primary" ports that external actors (handlers, usecases)
// use to interact with the application core.
package driving

import (
	"context"
	"time"

	"budgero-server/internal/domain"
	"budgero-server/internal/domain/analytics"
	"budgero-server/internal/port/driven/repository"
)

// UserService defines the interface for user management.
type UserService interface {
	// GetByID retrieves a user by ID.
	GetByID(ctx context.Context, id string) (*domain.User, error)

	// GetByEmail retrieves a user by email.
	GetByEmail(ctx context.Context, email string) (*domain.User, error)

	// GetByCustomerID retrieves a user by payment provider customer ID.
	GetByCustomerID(ctx context.Context, customerID string) (*domain.User, error)

	// Create creates a new user.
	Create(ctx context.Context, id, name, email string) (*domain.User, error)

	// Update updates user name and email.
	Update(ctx context.Context, id, name, email string) error

	// Delete removes a user.
	Delete(ctx context.Context, id string) error

	// Block sets the blocked status for a user.
	Block(ctx context.Context, id string, blocked bool) error

	// IsBlocked checks if a user is blocked.
	IsBlocked(ctx context.Context, id string) (bool, error)

	// SetMasterPasswordStatus updates the master password status.
	SetMasterPasswordStatus(ctx context.Context, id string, isSet bool) error

	// SetOnboardingState updates onboarding state.
	SetOnboardingState(ctx context.Context, id, status string, completedAt, snoozedUntil *time.Time) error

	// SetReferralSource records how the user discovered Budgero.
	SetReferralSource(ctx context.Context, id, source string) error

	// UpdateBackupSettings updates backup reminder settings.
	UpdateBackupSettings(ctx context.Context, id string, frequencyDays *int, lastBackup *time.Time) (*domain.User, error)

	// ResetData clears user data and returns affected space IDs.
	ResetData(ctx context.Context, id string) ([]string, error)

	// SetAnalyticsDisabled sets the analytics opt-out flag for a user.
	SetAnalyticsDisabled(ctx context.Context, id string, disabled bool) error

	// SetPrimarySpace sets the primary space for a user.
	SetPrimarySpace(ctx context.Context, id, spaceID string) error

	// GetPreferences returns user appearance/navigation preferences.
	GetPreferences(ctx context.Context, id string) (*domain.UserPreferences, error)

	// UpdatePreferences applies a partial user preference update.
	UpdatePreferences(ctx context.Context, id string, patch domain.UserPreferencesPatch) (*domain.UserPreferences, error)

	// ClearDanglingPrimarySpaceIDs nullifies primary_space_id references to deleted spaces.
	ClearDanglingPrimarySpaceIDs(ctx context.Context) error
}

// SpaceService defines the interface for space management.
type SpaceService interface {
	// Create creates a new budget space for a user.
	Create(ctx context.Context, userID, displayName string) (*domain.SpaceSummary, error)

	// ListForUser returns all spaces a user belongs to.
	ListForUser(ctx context.Context, userID string) ([]domain.SpaceSummary, error)

	// ListMembers returns all members of a space.
	ListMembers(ctx context.Context, requestorID, spaceID string) ([]domain.SpaceMember, error)

	// UpdateDisplayName updates a space's display name (owner only).
	UpdateDisplayName(ctx context.Context, actorID, spaceID, displayName string) error

	// Delete permanently deletes a space and its associated data.
	Delete(ctx context.Context, actorID, spaceID string) error

	// RemoveMember removes a member from a space.
	RemoveMember(ctx context.Context, actorID, spaceID, memberID string) error

	// ResolveSpaceID validates space access and returns the resolved space ID.
	ResolveSpaceID(ctx context.Context, userID, requestedSpaceID string) (string, error)

	// UpdateMemberEncryptedKey updates a member's encrypted space key.
	UpdateMemberEncryptedKey(ctx context.Context, userID, spaceID, encryptedKey string) error

	// UpdateMemberEncryptedKeys atomically updates encrypted keys across a member's spaces.
	UpdateMemberEncryptedKeys(ctx context.Context, userID string, encryptedKeys map[string]string) error

	// IsOwner checks if a user is the owner of a space.
	IsOwner(ctx context.Context, userID, spaceID string) (bool, error)

	// GetBlobMetadata returns blob metadata for a space.
	GetBlobMetadata(ctx context.Context, userID, spaceID string) (*domain.SpaceBlob, error)

	// GetSyncState returns the sync state for a space.
	GetSyncState(ctx context.Context, userID, spaceID string) (*domain.SyncState, error)

	// GetDatabaseHash returns the current database hash for a space.
	GetDatabaseHash(ctx context.Context, userID, spaceID string) (string, error)

	// UpdateSyncState updates the sync state for a space.
	UpdateSyncState(ctx context.Context, userID, spaceID, hash string, sizeBytes, mutationVersion int64) (int64, error)

	// UpdateSyncStateCAS updates the sync state only if the current version
	// matches expectedVersion (compare-and-swap); returns
	// domain.ErrSyncVersionConflict otherwise.
	UpdateSyncStateCAS(ctx context.Context, userID, spaceID, hash string, sizeBytes, mutationVersion, expectedVersion int64) (int64, error)

	// IncrementEncryptionKeyVersion increments the encryption key version for a space.
	IncrementEncryptionKeyVersion(ctx context.Context, userID, spaceID string) (int64, error)

	// RaiseDataFormatVersion records the blob's client data-format version (never lowers it).
	RaiseDataFormatVersion(ctx context.Context, userID, spaceID string, version int64) error

	// Invite operations

	// CreateInvite creates a new invite for a space using the client-provided secret hash.
	CreateInvite(ctx context.Context, spaceID, inviterID, inviteeEmail, inviteSecretHash string, expiresAt time.Time) (*domain.SpaceInvite, error)

	// GetInviteBySecret retrieves invite info by secret.
	GetInviteBySecret(ctx context.Context, secret string) (*domain.SpaceInvite, error)

	// UpdateInviteBundle updates the encrypted bundle for an invite.
	UpdateInviteBundle(ctx context.Context, inviteID, spaceID, bundle string) error

	// RedeemInvite marks an invite as redeemed and creates membership.
	RedeemInvite(ctx context.Context, invite *domain.SpaceInvite, userID, encryptedSpaceKey string) error

	// DeleteInvite deletes an invite.
	DeleteInvite(ctx context.Context, inviteID, spaceID string) error

	// ListInvites lists all invites for a space.
	ListInvites(ctx context.Context, spaceID string) ([]domain.SpaceInvite, error)
}

// CredentialService defines the interface for credential management.
type CredentialService interface {
	// Create creates local credentials for a user.
	Create(ctx context.Context, userID, password string, isAdmin bool) error

	// Verify checks if the password is correct for a user.
	Verify(ctx context.Context, userID, password string) error

	// UpdatePassword updates the password for a user.
	UpdatePassword(ctx context.Context, userID, newPassword string) error

	// SetPassword sets a new password for a user with validation.
	SetPassword(ctx context.Context, userID, password string, isAdmin bool) error

	// ResetPassword resets a password while preserving admin status.
	ResetPassword(ctx context.Context, userID, password string) error

	// Get retrieves credentials for a user.
	Get(ctx context.Context, userID string) (*domain.Credential, error)

	// IsAdmin returns true if the user has admin status.
	IsAdmin(ctx context.Context, userID string) bool

	// SetAdmin sets the admin status for a user.
	SetAdmin(ctx context.Context, userID string, isAdmin bool) error

	// MarkLogin updates the last login timestamp.
	MarkLogin(ctx context.Context, userID string) error
}

// EntitlementService defines the interface for entitlement management.
type EntitlementService interface {
	// HasWorkspaceAccess evaluates whether a user has full workspace access.
	HasWorkspaceAccess(user *domain.User) bool

	// HasWorkspaceAccessByID fetches a user and checks their access.
	HasWorkspaceAccessByID(ctx context.Context, userID string) bool

	// CheckAndRevokeExpiredBeta checks if beta access has expired and revokes it.
	CheckAndRevokeExpiredBeta(ctx context.Context, user *domain.User)

	// UpdateSubscription updates subscription details for a user.
	UpdateSubscription(ctx context.Context, userID string, update domain.SubscriptionUpdate) error

	// MarkSubscribedIfFirstTime stamps users.subscribed_at = at if currently
	// NULL. Called from the LemonSqueezy subscription_created webhook so we
	// have a "first paid conversion" timestamp for analytics. Idempotent —
	// renewals don't bump it.
	MarkSubscribedIfFirstTime(ctx context.Context, userID string, at time.Time) error

	// UpdateStatus updates just the subscription status and dates.
	UpdateStatus(ctx context.Context, userID, status string, endsAt, currentPeriodEnd *time.Time) error

	// UpdateFromProvider updates a user's subscription from external provider data.
	UpdateFromProvider(ctx context.Context, userID string, info domain.SubscriptionInfo) error

	// ResumeSubscription updates subscription after resuming.
	ResumeSubscription(ctx context.Context, userID, status string, currentPeriodEnd *time.Time, variantID *string, trialEnds *time.Time) error

	// GrantFoundingMember grants founding member status.
	GrantFoundingMember(ctx context.Context, userID string) error

	// GrantBetaAccess grants beta access until a specific date.
	GrantBetaAccess(ctx context.Context, userID string, expiresAt time.Time) error

	// RevokeBetaAccess revokes beta access.
	RevokeBetaAccess(ctx context.Context, userID string) error

	// SetCollaborationAccess sets collaboration access.
	SetCollaborationAccess(ctx context.Context, userID string, hasAccess bool) error
}

// SyncService defines the interface for sync operations.
type SyncService interface {
	// GetLatestVersion returns the latest mutation version for a space.
	GetLatestVersion(ctx context.Context, spaceID string) (int64, error)
	// ListMutationsBefore returns a page of the encrypted mutation log, newest first.
	ListMutationsBefore(ctx context.Context, spaceID string, before int64, limit int) ([]domain.MutationLogEntry, error)
}

// PushService defines the interface for push notification operations.
type PushService interface {
	// GenerateAndSaveToken generates and saves a new push API token.
	GenerateAndSaveToken(ctx context.Context, userID, spaceID string) (token string, err error)

	// GetTokenStatus returns the status of a user's push API token.
	GetTokenStatus(ctx context.Context, userID string) (*domain.PushTokenStatus, error)

	// SetTokenEnabled enables or disables a user's push API token.
	SetTokenEnabled(ctx context.Context, userID string, enabled bool) error

	// RevokeToken deletes a user's push API token.
	RevokeToken(ctx context.Context, userID string) error

	// ValidateTokenByHash validates a token hash and returns user/space info.
	ValidateTokenByHash(ctx context.Context, tokenHash string) (userID, spaceID string, err error)

	// CheckDuplicateMessage checks if a message ID already exists for a space.
	CheckDuplicateMessage(ctx context.Context, spaceID, messageID string) (existingID, status string, exists bool, err error)

	// QueueMutation adds an encrypted mutation to the push queue.
	QueueMutation(ctx context.Context, userID, spaceID, messageID, encryptedPayload string) (queueID string, err error)

	// ListPendingItems returns pending push queue items for a user.
	ListPendingItems(ctx context.Context, userID, spaceID string) ([]domain.PushQueueItem, error)

	// AckItem marks a push queue item as processed or failed.
	AckItem(ctx context.Context, userID, itemID, status string) error

	// GetStats returns push queue statistics for a user.
	GetStats(ctx context.Context, userID string) (*domain.PushQueueStats, error)

	// ClearQueue clears push queue items for a user.
	ClearQueue(ctx context.Context, userID string, clearAll bool) (int64, error)

	// DeleteUserPushData deletes all push data for a user.
	DeleteUserPushData(ctx context.Context, userID string) error
}

// ExchangeRateService defines the interface for exchange rate operations.
// Rates are keyed by day (YYYY-MM-DD).
type ExchangeRateService interface {
	// GetOrFetchRates returns base→symbol rates for a date, serving from the
	// cache and fetching missing pairs from the external provider.
	GetOrFetchRates(ctx context.Context, baseCurrency string, symbols []string, rateDate string) (map[string]float64, error)

	// RefreshRates bypasses the server cache and fetches official rates from the
	// external provider for the requested date.
	RefreshRates(ctx context.Context, baseCurrency string, symbols []string, rateDate string) (map[string]float64, error)

	// RefreshTodayRates re-fetches today's rates for every currency pair seen
	// recently, keeping the cache warm for client balance true-ups. Returns
	// the number of pairs refreshed.
	RefreshTodayRates(ctx context.Context) (int, error)

	// GetRate gets the exchange rate for a currency pair on an exact date.
	GetRate(ctx context.Context, baseCurrency, targetCurrency, rateDate string) (float64, error)

	// UpsertRate inserts or updates an exchange rate.
	UpsertRate(ctx context.Context, baseCurrency, targetCurrency, rateDate string, rate float64) error

	// ListRates lists all exchange rates for a base currency on a date.
	ListRates(ctx context.Context, baseCurrency, rateDate string) (map[string]float64, error)
}

// ActivityService defines app activity heartbeat tracking operations.
type ActivityService interface {
	// RecordHeartbeat marks the authenticated user active for the current UTC day.
	RecordHeartbeat(ctx context.Context, userID string) error
}

// FeedbackService accepts in-app feedback submissions (bug / idea / praise).
// SaaS-only — gated off at the route layer in self-host builds.
type FeedbackService interface {
	// Submit validates the category + body and persists a new feedback row
	// for the authenticated user. ScreenPath / AppVersion / UserAgent are
	// auto-attached and may be empty.
	Submit(ctx context.Context, userID string, input *FeedbackSubmission) (*domain.Feedback, error)
}

// FeedbackSubmission is the validated input passed to FeedbackService.Submit.
// Trimmed/normalized by the handler before it reaches the service.
type FeedbackSubmission struct {
	Category    domain.FeedbackCategory
	Body        string
	ContactBack bool
	ScreenPath  string
	AppVersion  string
	UserAgent   string
}

// UpdatePingService aggregates anonymous update-check pings into daily
// (version, build, type) counters. Recording only happens on SaaS — the
// /version/latest handler skips it in self-host mode — but the service is
// wired in both builds.
type UpdatePingService interface {
	// Record counts one update check. Unknown client types are silently
	// dropped — the endpoint is public and unauthenticated. For self-host
	// checks, senderIP (when non-empty) is also counted as a distinct sender
	// for the week; only a keyed hash of it is stored, and only for that week.
	Record(ctx context.Context, version, build, clientType, senderIP string) error
	// SelfHostSummary returns weekly active self-host installs for the last
	// weeks weeks and self-host pings per version for the last days days.
	SelfHostSummary(ctx context.Context, weeks, days int) (SelfHostInstallSummary, error)
}

// SelfHostInstallSummary backs the SaaS admin "Self-host" card.
type SelfHostInstallSummary struct {
	Weeks    []SelfHostWeek        `json:"weeks"`
	Versions []SelfHostVersionPing `json:"versions"`
	Days     int                   `json:"days"`
}

// SelfHostWeek is one UTC week (starting Monday) of distinct senders.
type SelfHostWeek struct {
	Week     string `json:"week"`
	Installs int    `json:"installs"`
	// Partial marks the current, still-open week.
	Partial bool `json:"partial"`
}

// SelfHostVersionPing is the self-host ping total for one version.
type SelfHostVersionPing struct {
	Version string `json:"version"`
	Pings   int    `json:"pings"`
	Days    int    `json:"days"`
}

// AdminService defines the interface for admin operations.
type AdminService interface {
	// GetStats returns admin dashboard statistics.
	GetStats(ctx context.Context) (*repository.AdminStats, error)

	// GetSelfHostStats returns self-host deployment statistics.
	GetSelfHostStats(ctx context.Context) (*repository.SelfHostStats, error)

	// ListUsers returns all users for admin view.
	ListUsers(ctx context.Context) ([]repository.AdminUser, error)

	// GetUserDetails returns a full admin details payload for a user.
	GetUserDetails(ctx context.Context, userID string, windowDays int) (*repository.AdminUserDetails, error)

	// ListSelfHostUsers returns all users for self-host admin view.
	ListSelfHostUsers(ctx context.Context) ([]repository.SelfHostUser, error)

	// ListRecentUsers returns recently created users.
	ListRecentUsers(ctx context.Context) ([]repository.RecentUser, error)

	// RevokeAllAccess revokes all access for a user.
	RevokeAllAccess(ctx context.Context, userID string) error

	// IsLocalAdmin checks if a user is a local admin.
	IsLocalAdmin(ctx context.Context, userID string) (bool, error)

	// ListUsersWithSubscription returns users that have a subscription ID.
	ListUsersWithSubscription(ctx context.Context) ([]repository.UserWithSubscription, error)

	// MigrateUserID migrates a user from one ID to another.
	MigrateUserID(ctx context.Context, oldID, newID, name, email string) error

	// BackfillTrialForInactiveUsers migrates inactive users to trial status.
	BackfillTrialForInactiveUsers(ctx context.Context, trialDays int) (int64, error)

	// GetStickinessAnalytics returns DAU/MAU stickiness time-series and a
	// signup-cohort retention matrix. SaaS-only at the route layer.
	GetStickinessAnalytics(ctx context.Context, params domain.StickinessAnalyticsParams) (*domain.StickinessAnalytics, error)
	// GetSignupSeries returns signups per day, week or month for the
	// inclusive UTC date range from..to, zero-filled.
	GetSignupSeries(ctx context.Context, from, to time.Time, granularity domain.AnalyticsGranularity) (*domain.SignupSeries, error)
}

// DatabaseBrowserService defines the interface for database browsing (admin only).
type DatabaseBrowserService interface {
	// ListTables returns all user tables in the database.
	ListTables(ctx context.Context) ([]repository.TableSummary, error)

	// GetTableColumns returns column information for a table.
	GetTableColumns(ctx context.Context, tableName string) ([]repository.TableColumnInfo, error)

	// GetTableData returns paginated data from a table.
	GetTableData(ctx context.Context, tableName string, limit, offset int, orderBy, orderDir string) (*repository.TableDataResult, error)

	// UpdateRow updates a single row in a table.
	UpdateRow(ctx context.Context, tableName string, primaryKey map[string]interface{}, updates map[string]interface{}) (map[string]interface{}, error)

	// RunQuery executes an arbitrary SQL query.
	RunQuery(ctx context.Context, query string) (*repository.QueryResult, error)

	// ListSavedQueries returns all saved queries.
	ListSavedQueries(ctx context.Context) ([]repository.SavedQuery, error)

	// SaveQuery creates or updates a saved query.
	SaveQuery(ctx context.Context, name, query string) (*repository.SavedQuery, error)

	// DeleteSavedQuery removes a saved query.
	DeleteSavedQuery(ctx context.Context, name string) error
}

// UserPurgeService permanently deletes users and all their data.
type UserPurgeService interface {
	// Purge deletes the user, their owned spaces, mutation log, activity and
	// every other row tied to them, plus their files on disk.
	Purge(ctx context.Context, userID string) (*domain.UserPurgeReport, error)

	// ListActivity returns every user with activity data for inactivity checks.
	ListActivity(ctx context.Context) ([]domain.UserActivitySummary, error)
}

// AnalyticsTracker records server-side product analytics events. Track never
// blocks and never fails: events are queued and dropped when the queue is full,
// when analytics is disabled (self-host, no key) or when the user opted out.
type AnalyticsTracker interface {
	// Enabled reports whether events leave the server at all. Callers use it
	// to skip work that only exists to compute event properties.
	Enabled() bool

	// Track queues event for userID (the PostHog distinct_id).
	Track(userID string, event analytics.Event)

	// SetOptOut updates the cached opt-out flag after the user changes it.
	SetOptOut(userID string, disabled bool)
}
