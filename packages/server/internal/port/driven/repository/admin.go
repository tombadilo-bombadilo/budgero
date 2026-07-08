package repository

import (
	"context"
	"time"
)

// AdminStats contains dashboard statistics.
type AdminStats struct {
	TotalUsers      int64 `json:"totalUsers"`
	ActiveUsers     int64 `json:"activeUsers"`
	TrialUsers      int64 `json:"trialUsers"`
	PaidUsers       int64 `json:"paidUsers"`
	BetaUsers       int64 `json:"betaUsers"`
	FoundingMembers int64 `json:"foundingMembers"`
	TotalRevenue    int   `json:"totalRevenue"`
	MRR             int   `json:"mrr"`
}

// SelfHostStats contains self-host deployment statistics.
type SelfHostStats struct {
	TotalUsers          int64 `json:"totalUsers"`
	LocalAccounts       int64 `json:"localAccounts"`
	AdminUsers          int64 `json:"adminUsers"`
	MasterPasswordUsers int64 `json:"masterPasswordUsers"`
	SpaceCount          int64 `json:"spaceCount"`
	SpacesWithMembers   int64 `json:"spacesWithMembers"`
	TotalMemberships    int64 `json:"totalMemberships"`
	SpaceBlobBytes      int64 `json:"spaceBlobBytes"`
	PendingInvites      int64 `json:"pendingInvites"`
}

// AdminUser represents a user in admin view.
type AdminUser struct {
	ID                     string     `json:"id"`
	Name                   string     `json:"name"`
	Email                  string     `json:"email"`
	CreatedAt              time.Time  `json:"created_at"`
	LastLogin              *time.Time `json:"last_login,omitempty"`
	SubscriptionStatus     string     `json:"subscription_status,omitempty"`
	SubscriptionID         *string    `json:"subscription_id,omitempty"`
	CustomerID             *string    `json:"customer_id,omitempty"`
	VariantID              *string    `json:"variant_id,omitempty"`
	SubscriptionEndsAt     *time.Time `json:"subscription_ends_at,omitempty"`
	TrialEndsAt            *time.Time `json:"trial_ends_at,omitempty"`
	CurrentPeriodEnd       *time.Time `json:"current_period_end,omitempty"`
	HasBetaAccess          bool       `json:"has_beta_access"`
	BetaExpiresAt          *time.Time `json:"beta_expires_at,omitempty"`
	IsFoundingMember       bool       `json:"is_founding_member"`
	IsMasterPasswordSet    bool       `json:"is_master_password_set"`
	HasCollaborationAccess bool       `json:"has_collaboration_access"`
	IsBlocked              bool       `json:"is_blocked"`
	IsAdmin                bool       `json:"is_admin"`
}

// AdminUserDetails contains the aggregated admin detail payload for a single user.
type AdminUserDetails struct {
	User          AdminUser                   `json:"user"`
	AppActivity   *AdminUserAppActivity       `json:"appActivity,omitempty"`
	Activity      *AdminUserActivity          `json:"activity,omitempty"`
	Mutations     AdminUserMutationStats      `json:"mutations"`
	Workspaces    AdminUserWorkspaceStats     `json:"workspaces"`
	Subscription  *AdminUserSubscriptionStats `json:"subscription,omitempty"`
	SectionErrors map[string]string           `json:"sectionErrors,omitempty"`
}

// AdminDayCount stores a single UTC day bucket and its count.
type AdminDayCount struct {
	Day   string `json:"day"`
	Count int64  `json:"count"`
}

// AdminUserActivity captures Clerk session activity for the current window.
type AdminUserActivity struct {
	WindowDays    int             `json:"windowDays"`
	TotalSessions int64           `json:"totalSessions"`
	ActiveDays    int64           `json:"activeDays"`
	LastActiveAt  *time.Time      `json:"lastActiveAt,omitempty"`
	Days          []AdminDayCount `json:"days"`
}

// AdminUserAppActivity captures app heartbeat activity for the current window.
type AdminUserAppActivity struct {
	WindowDays      int             `json:"windowDays"`
	TotalHeartbeats int64           `json:"totalHeartbeats"`
	ActiveDays      int64           `json:"activeDays"`
	LastSeenAt      *time.Time      `json:"lastSeenAt,omitempty"`
	Days            []AdminDayCount `json:"days"`
}

// AdminMutationSummary contains the latest mutation metadata for a user.
type AdminMutationSummary struct {
	ID        string    `json:"id"`
	SpaceID   string    `json:"spaceId"`
	Op        string    `json:"op"`
	Version   int64     `json:"version"`
	Timestamp time.Time `json:"timestamp"`
}

// AdminUserMutationStats contains aggregate mutation metrics and daily buckets.
type AdminUserMutationStats struct {
	TotalMutations  int64                 `json:"totalMutations"`
	LastMutation    *AdminMutationSummary `json:"lastMutation,omitempty"`
	ActiveDays      int64                 `json:"activeDays"`
	AvgPerActiveDay float64               `json:"avgPerActiveDay"`
	Days            []AdminDayCount       `json:"days"`
}

// AdminWorkspaceItem describes one workspace membership for the user.
type AdminWorkspaceItem struct {
	SpaceID          string    `json:"spaceId"`
	DisplayName      string    `json:"displayName"`
	OwnerUserID      string    `json:"ownerUserId"`
	Role             string    `json:"role"`
	InvitationStatus string    `json:"invitationStatus"`
	CreatedAt        time.Time `json:"createdAt"`
}

// AdminUserWorkspaceStats summarizes workspace membership and seat usage.
type AdminUserWorkspaceStats struct {
	OwnedShareSeatsUsed        int64                `json:"ownedShareSeatsUsed"`
	OwnedShareSeatsLimit       int64                `json:"ownedShareSeatsLimit"`
	OwnedWorkspaceCount        int64                `json:"ownedWorkspaceCount"`
	CollaboratorWorkspaceCount int64                `json:"collaboratorWorkspaceCount"`
	Items                      []AdminWorkspaceItem `json:"items"`
}

// AdminSubscriptionTransaction represents one billing transaction row.
type AdminSubscriptionTransaction struct {
	ID              string     `json:"id"`
	Status          string     `json:"status"`
	StatusFormatted string     `json:"statusFormatted"`
	BillingReason   string     `json:"billingReason"`
	TotalCents      int        `json:"totalCents"`
	TotalFormatted  string     `json:"totalFormatted"`
	Currency        string     `json:"currency"`
	InvoiceURL      string     `json:"invoiceUrl"`
	CreatedAt       time.Time  `json:"createdAt"`
	Refunded        bool       `json:"refunded"`
	RefundedAt      *time.Time `json:"refundedAt,omitempty"`
}

// AdminUserSubscriptionStats contains plan, LTV, and recent billing activity.
type AdminUserSubscriptionStats struct {
	PlanName       string                         `json:"planName"`
	Status         string                         `json:"status"`
	VariantName    string                         `json:"variantName,omitempty"`
	ProductName    string                         `json:"productName,omitempty"`
	PriceFormatted string                         `json:"priceFormatted,omitempty"`
	IntervalLabel  string                         `json:"intervalLabel,omitempty"`
	LtvCents       int64                          `json:"ltvCents"`
	LtvFormatted   string                         `json:"ltvFormatted"`
	Transactions   []AdminSubscriptionTransaction `json:"transactions"`
}

// UserMutationRecord is the latest mutation row returned for admin views.
type UserMutationRecord struct {
	ID        string    `json:"id"`
	SpaceID   string    `json:"space_id"`
	Op        string    `json:"op"`
	Version   int64     `json:"version"`
	Timestamp time.Time `json:"timestamp"`
}

// SelfHostUser represents a user in self-host admin view.
type SelfHostUser struct {
	ID                   string     `json:"id"`
	Name                 string     `json:"name"`
	Email                string     `json:"email"`
	CreatedAt            time.Time  `json:"createdAt"`
	LastLoginAt          *time.Time `json:"lastLoginAt,omitempty"`
	HasLocalPassword     bool       `json:"hasLocalPassword"`
	IsAdmin              bool       `json:"isAdmin"`
	IsBlocked            bool       `json:"isBlocked"`
	IsMasterPasswordSet  bool       `json:"isMasterPasswordSet"`
	SpaceMembershipCount int64      `json:"spaceMembershipCount"`
	OwnedSpaceCount      int64      `json:"ownedSpaceCount"`
}

// RecentUser represents a recently created user.
type RecentUser struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"createdAt"`
}

// UserWithSubscription represents a user with subscription for sync operations.
type UserWithSubscription struct {
	ID             string
	Email          string
	SubscriptionID string
	CustomerID     string
}

// AdminRepository defines methods for admin-specific data access.
type AdminRepository interface {
	// GetStats returns admin dashboard statistics.
	GetStats(ctx context.Context) (*AdminStats, error)

	// GetSelfHostStats returns self-host deployment statistics.
	GetSelfHostStats(ctx context.Context) (*SelfHostStats, error)

	// ListUsers returns all users for admin view.
	ListUsers(ctx context.Context) ([]AdminUser, error)

	// GetUser returns a single user for admin view.
	GetUser(ctx context.Context, userID string) (*AdminUser, error)

	// ListSelfHostUsers returns all users for self-host admin view.
	ListSelfHostUsers(ctx context.Context) ([]SelfHostUser, error)

	// ListRecentUsers returns recently created users.
	ListRecentUsers(ctx context.Context) ([]RecentUser, error)

	// ListUsersWithSubscription returns users that have a subscription ID.
	ListUsersWithSubscription(ctx context.Context) ([]UserWithSubscription, error)

	// CountUserMutations returns the total number of mutations authored by a user.
	CountUserMutations(ctx context.Context, userID string) (int64, error)

	// GetLastUserMutation returns the latest mutation authored by a user.
	GetLastUserMutation(ctx context.Context, userID string) (*UserMutationRecord, error)

	// ListUserMutationDays returns mutation counts grouped by UTC day for a time window.
	ListUserMutationDays(ctx context.Context, userID string, startInclusive, endExclusive time.Time) ([]AdminDayCount, error)

	// MigrateUserID migrates a user from one ID to another.
	MigrateUserID(ctx context.Context, oldID, newID, name, email string) error

	// BackfillTrialForInactiveUsers migrates inactive users to trial status.
	BackfillTrialForInactiveUsers(ctx context.Context, trialDays int) (int64, error)

	// IsLocalAdmin checks if a user is a local admin.
	IsLocalAdmin(ctx context.Context, userID string) (bool, error)

	// RevokeAllAccess revokes all access for a user.
	RevokeAllAccess(ctx context.Context, userID string) error
}

// DatabaseBrowserRepository defines methods for database browsing (admin only).
// Note: This is kept separate as it operates on raw SQL rather than domain entities.
type DatabaseBrowserRepository interface {
	// ListTables returns all user tables in the database.
	ListTables(ctx context.Context) ([]TableSummary, error)

	// GetTableColumns returns column information for a table.
	GetTableColumns(ctx context.Context, tableName string) ([]TableColumnInfo, error)

	// GetTableData returns paginated data from a table.
	GetTableData(ctx context.Context, tableName string, limit, offset int, orderBy, orderDir string) (*TableDataResult, error)

	// UpdateRow updates a single row in a table.
	UpdateRow(ctx context.Context, tableName string, primaryKey map[string]interface{}, updates map[string]interface{}) (map[string]interface{}, error)

	// RunQuery executes an arbitrary SQL query.
	RunQuery(ctx context.Context, query string) (*QueryResult, error)
}

// TableColumnInfo describes a column in a database table.
type TableColumnInfo struct {
	Name         string  `json:"name"`
	Type         string  `json:"type"`
	NotNull      bool    `json:"not_null"`
	PrimaryKey   bool    `json:"primary_key"`
	PKPosition   int     `json:"pk_position"`
	DefaultValue *string `json:"default_value,omitempty"`
}

// TableSummary provides an overview of a database table.
type TableSummary struct {
	Name     string            `json:"name"`
	RowCount int64             `json:"row_count"`
	Schema   *string           `json:"schema,omitempty"`
	Columns  []TableColumnInfo `json:"columns"`
}

// QueryResult contains the results of a SQL query.
type QueryResult struct {
	Columns       []string        `json:"columns"`
	Rows          [][]interface{} `json:"rows"`
	RowCount      int64           `json:"row_count"`
	ExecutionTime float64         `json:"execution_time"`
	Message       string          `json:"message,omitempty"`
	Truncated     bool            `json:"truncated"`
}

// TableDataResult contains paginated table data.
type TableDataResult struct {
	Columns     []TableColumnInfo        `json:"columns"`
	Rows        []map[string]interface{} `json:"rows"`
	TotalCount  int64                    `json:"total_count"`
	PrimaryKeys []string                 `json:"primary_keys"`
}

// SavedQuery represents a saved SQL query.
type SavedQuery struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Query     string `json:"query"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}
