package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"time"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
)

// AdminRepository implements repository.AdminRepository using SQLite.
type AdminRepository struct {
	queries *sqlc.Queries
}

// NewAdminRepository creates a new AdminRepository.
func NewAdminRepository(queries *sqlc.Queries) *AdminRepository {
	return &AdminRepository{queries: queries}
}

var _ repository.AdminRepository = (*AdminRepository)(nil)

// GetStats returns aggregated statistics for administration.
func (r *AdminRepository) GetStats(ctx context.Context) (*repository.AdminStats, error) {
	totalUsers, err := r.queries.CountAllUsers(ctx)
	if err != nil {
		return nil, err
	}

	users, err := r.ListUsers(ctx)
	if err != nil {
		return nil, err
	}

	stats := &repository.AdminStats{
		TotalUsers: totalUsers,
	}

	now := time.Now()
	for i := range users {
		user := users[i]
		effectiveStatus := domain.EffectiveSubscriptionStatus(
			user.SubscriptionStatus,
			user.TrialEndsAt,
			user.SubscriptionEndsAt,
			user.CurrentPeriodEnd,
		)

		if effectiveStatus == domain.SubscriptionTrialing {
			stats.TrialUsers++
		}
		if effectiveStatus == domain.SubscriptionActive {
			stats.PaidUsers++
		}
		if user.HasBetaAccess {
			stats.BetaUsers++
		}
		if user.IsFoundingMember {
			stats.FoundingMembers++
		}

		if effectiveStatus == domain.SubscriptionActive || effectiveStatus == domain.SubscriptionTrialing {
			stats.ActiveUsers++
			continue
		}
		if user.IsFoundingMember {
			stats.ActiveUsers++
			continue
		}
		if user.HasBetaAccess && (user.BetaExpiresAt == nil || user.BetaExpiresAt.After(now)) {
			stats.ActiveUsers++
		}
	}

	return stats, nil
}

// GetSelfHostStats returns statistics for self-hosted deployments.
func (r *AdminRepository) GetSelfHostStats(ctx context.Context) (*repository.SelfHostStats, error) {
	totalUsers, err := r.queries.CountAllUsers(ctx)
	if err != nil {
		return nil, err
	}

	localAccounts, err := r.queries.CountLocalAccounts(ctx)
	if err != nil {
		return nil, err
	}

	adminUsers, err := r.queries.CountAdminUsers(ctx)
	if err != nil {
		return nil, err
	}

	masterPasswordUsers, err := r.queries.CountMasterPasswordUsers(ctx)
	if err != nil {
		return nil, err
	}

	spaceCount, err := r.queries.CountSpaces(ctx)
	if err != nil {
		return nil, err
	}

	spacesWithMembers, err := r.queries.CountSpacesWithMembers(ctx)
	if err != nil {
		return nil, err
	}

	totalMemberships, err := r.queries.CountMemberships(ctx)
	if err != nil {
		return nil, err
	}

	spaceBlobBytes, err := r.queries.SumSpaceBlobBytes(ctx)
	if err != nil {
		return nil, err
	}

	pendingInvites, err := r.queries.CountPendingInvites(ctx)
	if err != nil {
		return nil, err
	}

	return &repository.SelfHostStats{
		TotalUsers:          totalUsers,
		LocalAccounts:       localAccounts,
		AdminUsers:          adminUsers,
		MasterPasswordUsers: masterPasswordUsers,
		SpaceCount:          spaceCount,
		SpacesWithMembers:   spacesWithMembers,
		TotalMemberships:    totalMemberships,
		SpaceBlobBytes:      ToInt64(spaceBlobBytes),
		PendingInvites:      pendingInvites,
	}, nil
}

// ListUsers returns all users with admin-relevant details.
func (r *AdminRepository) ListUsers(ctx context.Context) ([]repository.AdminUser, error) {
	rows, err := r.queries.ListUsersForAdmin(ctx)
	if err != nil {
		return nil, err
	}

	users := make([]repository.AdminUser, 0, len(rows))
	for i := range rows {
		users = append(users, adminUserFromListRow(&rows[i]))
	}
	return users, nil
}

// GetUser returns a single user with admin-relevant details.
func (r *AdminRepository) GetUser(ctx context.Context, userID string) (*repository.AdminUser, error) {
	row, err := r.queries.GetUserForAdmin(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrUserNotFound
		}
		return nil, err
	}

	user := adminUserFromGetRow(&row)
	return &user, nil
}

// ListSelfHostUsers returns all users for self-hosted admin views.
func (r *AdminRepository) ListSelfHostUsers(ctx context.Context) ([]repository.SelfHostUser, error) {
	rows, err := r.queries.ListSelfHostUsers(ctx)
	if err != nil {
		return nil, err
	}

	users := make([]repository.SelfHostUser, 0, len(rows))
	for i := range rows {
		row := &rows[i]
		user := repository.SelfHostUser{
			ID:                   row.ID,
			Name:                 row.Name,
			Email:                row.Email,
			HasLocalPassword:     row.HasLocalPassword == 1,
			IsAdmin:              row.IsAdmin,
			IsBlocked:            row.IsBlocked,
			IsMasterPasswordSet:  row.IsMasterPasswordSet,
			SpaceMembershipCount: row.MembershipCount,
			OwnedSpaceCount:      row.OwnedSpaceCount,
		}
		if row.CreatedAt.Valid {
			user.CreatedAt = row.CreatedAt.Time
		}
		if row.LastLoginAt.Valid {
			user.LastLoginAt = &row.LastLoginAt.Time
		}
		users = append(users, user)
	}
	return users, nil
}

// ListRecentUsers returns recently created users.
func (r *AdminRepository) ListRecentUsers(ctx context.Context) ([]repository.RecentUser, error) {
	rows, err := r.queries.ListRecentUsers(ctx)
	if err != nil {
		return nil, err
	}

	users := make([]repository.RecentUser, 0, len(rows))
	for _, row := range rows {
		user := repository.RecentUser{
			ID:    row.ID,
			Name:  row.Name,
			Email: row.Email,
		}
		if row.CreatedAt.Valid {
			user.CreatedAt = row.CreatedAt.Time
		} else {
			user.CreatedAt = time.Time{}
		}
		users = append(users, user)
	}
	return users, nil
}

// ListUsersWithSubscription returns users that have subscription IDs.
func (r *AdminRepository) ListUsersWithSubscription(ctx context.Context) ([]repository.UserWithSubscription, error) {
	rows, err := r.queries.ListUsersWithSubscription(ctx)
	if err != nil {
		return nil, err
	}

	users := make([]repository.UserWithSubscription, 0, len(rows))
	for _, row := range rows {
		user := repository.UserWithSubscription{
			ID: row.ID,
		}
		if row.SubscriptionID.Valid {
			user.SubscriptionID = row.SubscriptionID.String
		}
		users = append(users, user)
	}
	return users, nil
}

// MigrateUserID migrates a user from an old ID to a new ID.
func (r *AdminRepository) MigrateUserID(ctx context.Context, oldID, newID, name, email string) error {
	return r.queries.MigrateUserID(ctx, sqlc.MigrateUserIDParams{
		ID:    newID,
		Name:  name,
		Email: email,
		ID_2:  oldID,
	})
}

// BackfillTrialForInactiveUsers adds trial periods to inactive users.
func (r *AdminRepository) BackfillTrialForInactiveUsers(ctx context.Context, trialDays int) (int64, error) {
	result, err := r.queries.BackfillTrialForInactiveUsers(ctx, sql.NullString{String: strconv.Itoa(trialDays), Valid: true})
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// IsLocalAdmin checks if a user has local admin privileges.
func (r *AdminRepository) IsLocalAdmin(ctx context.Context, userID string) (bool, error) {
	isAdmin, err := r.queries.IsLocalAdmin(ctx, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return isAdmin, nil
}

// RevokeAllAccess removes all access privileges from a user.
func (r *AdminRepository) RevokeAllAccess(ctx context.Context, userID string) error {
	return r.queries.RevokeAllUserAccess(ctx, userID)
}

// CountUserMutations returns the total number of mutations authored by a user.
func (r *AdminRepository) CountUserMutations(ctx context.Context, userID string) (int64, error) {
	return r.queries.CountUserMutations(ctx, userID)
}

// GetLastUserMutation returns the latest mutation authored by a user.
func (r *AdminRepository) GetLastUserMutation(ctx context.Context, userID string) (*repository.UserMutationRecord, error) {
	row, err := r.queries.GetLastUserMutation(ctx, userID)
	if err != nil {
		return nil, err
	}

	record := &repository.UserMutationRecord{
		ID:        row.ID,
		SpaceID:   row.SpaceID,
		Version:   row.Version,
		Timestamp: row.Timestamp,
	}
	if row.Op.Valid {
		record.Op = row.Op.String
	}

	return record, nil
}

// ListUserMutationDays returns mutation counts grouped by UTC day for a time window.
func (r *AdminRepository) ListUserMutationDays(
	ctx context.Context,
	userID string,
	startInclusive, endExclusive time.Time,
) ([]repository.AdminDayCount, error) {
	rows, err := r.queries.ListUserMutationDays(ctx, sqlc.ListUserMutationDaysParams{
		UserID:      userID,
		Timestamp:   startInclusive,
		Timestamp_2: endExclusive,
	})
	if err != nil {
		return nil, err
	}

	result := make([]repository.AdminDayCount, 0, len(rows))
	for _, row := range rows {
		result = append(result, repository.AdminDayCount{
			Day:   row.Day,
			Count: row.Count,
		})
	}

	return result, nil
}

// adminUserRow holds the common columns shared by the ListUsersForAdmin and
// GetUserForAdmin sqlc rows so they can be mapped through a single helper.
type adminUserRow struct {
	ID                     string
	Name                   string
	Email                  string
	CreatedAt              sql.NullTime
	LastLoginAt            sql.NullTime
	SubscriptionStatus     sql.NullString
	SubscriptionID         sql.NullString
	CustomerID             sql.NullString
	VariantID              sql.NullString
	SubscriptionEndsAt     sql.NullTime
	TrialEndsAt            sql.NullTime
	CurrentPeriodEnd       sql.NullTime
	HasBetaAccess          bool
	BetaExpiresAt          sql.NullTime
	IsFoundingMember       bool
	IsMasterPasswordSet    bool
	HasCollaborationAccess bool
	IsBlocked              bool
	IsAdmin                bool
}

func adminUserFromListRow(row *sqlc.ListUsersForAdminRow) repository.AdminUser {
	r := adminUserRow(*row)
	return adminUserFromRow(&r)
}

func adminUserFromGetRow(row *sqlc.GetUserForAdminRow) repository.AdminUser {
	r := adminUserRow(*row)
	return adminUserFromRow(&r)
}

func adminUserFromRow(row *adminUserRow) repository.AdminUser {
	user := repository.AdminUser{
		ID:                     row.ID,
		Name:                   row.Name,
		Email:                  row.Email,
		HasBetaAccess:          row.HasBetaAccess,
		IsFoundingMember:       row.IsFoundingMember,
		IsMasterPasswordSet:    row.IsMasterPasswordSet,
		HasCollaborationAccess: row.HasCollaborationAccess,
		IsBlocked:              row.IsBlocked,
		IsAdmin:                row.IsAdmin,
	}
	if row.CreatedAt.Valid {
		user.CreatedAt = row.CreatedAt.Time
	}
	if row.LastLoginAt.Valid {
		user.LastLogin = &row.LastLoginAt.Time
	}
	if row.SubscriptionStatus.Valid {
		user.SubscriptionStatus = row.SubscriptionStatus.String
	}
	if row.SubscriptionID.Valid {
		user.SubscriptionID = &row.SubscriptionID.String
	}
	if row.CustomerID.Valid {
		user.CustomerID = &row.CustomerID.String
	}
	if row.VariantID.Valid {
		user.VariantID = &row.VariantID.String
	}
	if row.SubscriptionEndsAt.Valid {
		user.SubscriptionEndsAt = &row.SubscriptionEndsAt.Time
	}
	if row.TrialEndsAt.Valid {
		user.TrialEndsAt = &row.TrialEndsAt.Time
	}
	if row.CurrentPeriodEnd.Valid {
		user.CurrentPeriodEnd = &row.CurrentPeriodEnd.Time
	}
	if row.BetaExpiresAt.Valid {
		user.BetaExpiresAt = &row.BetaExpiresAt.Time
	}
	user.SubscriptionStatus = domain.EffectiveSubscriptionStatus(
		user.SubscriptionStatus,
		user.TrialEndsAt,
		user.SubscriptionEndsAt,
		user.CurrentPeriodEnd,
	)

	return user
}
