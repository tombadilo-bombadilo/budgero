package application

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"budgero-server/internal/adapter/driven/lemonsqueezy"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"

	clerk "github.com/clerk/clerk-sdk-go/v2"
	clerksession "github.com/clerk/clerk-sdk-go/v2/session"
)

const defaultAdminDetailsWindowDays = 365

// GetUserDetails returns the full admin details payload for a single user.
func (s *AdminService) GetUserDetails(ctx context.Context, userID string, windowDays int) (*repository.AdminUserDetails, error) {
	windowDays = normalizeAdminWindowDays(windowDays)

	user, err := s.adminRepo.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	user.IsAdmin = user.IsAdmin || s.isConfiguredAdmin(user.Email)

	startDay := time.Now().UTC().Truncate(24*time.Hour).AddDate(0, 0, -(windowDays - 1))
	endExclusive := startDay.AddDate(0, 0, windowDays)

	details := &repository.AdminUserDetails{
		User: *user,
		AppActivity: &repository.AdminUserAppActivity{
			WindowDays: windowDays,
			Days:       emptyDayBuckets(startDay, windowDays),
		},
		Mutations: repository.AdminUserMutationStats{
			Days: emptyDayBuckets(startDay, windowDays),
		},
		Workspaces: repository.AdminUserWorkspaceStats{
			OwnedShareSeatsLimit: int64(domain.MaxOwnedCollaboratorSeats),
			Items:                make([]repository.AdminWorkspaceItem, 0),
		},
		SectionErrors: make(map[string]string),
	}

	s.populateAppActivity(ctx, details, userID, startDay, endExclusive, windowDays)
	s.populateActivity(ctx, details, userID, startDay, endExclusive, windowDays)
	s.populateMutations(ctx, details, userID, startDay, endExclusive, windowDays)
	s.populateWorkspaces(ctx, details, userID)
	s.populateSubscription(details, user)

	if details.User.LastLogin == nil && details.Activity != nil {
		details.User.LastLogin = details.Activity.LastActiveAt
	}
	if len(details.SectionErrors) == 0 {
		details.SectionErrors = nil
	}

	return details, nil
}

func (s *AdminService) populateActivity(
	ctx context.Context,
	details *repository.AdminUserDetails,
	userID string,
	startDay, endExclusive time.Time,
	windowDays int,
) {
	if s.cfg == nil || strings.TrimSpace(s.cfg.Auth.ClerkSecretKey) == "" {
		details.SectionErrors["activity"] = "Clerk is not configured"
		return
	}

	clerk.SetKey(s.cfg.Auth.ClerkSecretKey)
	page := int64(0)
	limit := int64(100)
	buckets := make(map[string]int64)
	var totalSessions int64
	var lastActiveAt *time.Time

	for {
		params := &clerksession.ListParams{
			UserID: clerk.String(userID),
		}
		params.Limit = clerk.Int64(limit)
		params.Offset = clerk.Int64(page * limit)

		list, err := clerksession.List(ctx, params)
		if err != nil {
			details.SectionErrors["activity"] = "Failed to load Clerk sessions"
			return
		}
		if len(list.Sessions) == 0 {
			break
		}

		for _, sess := range list.Sessions {
			if sess == nil {
				continue
			}
			activeAt := clerkUnixTime(sess.LastActiveAt)
			if activeAt.IsZero() {
				activeAt = clerkUnixTime(sess.CreatedAt)
			}
			if !activeAt.IsZero() {
				if lastActiveAt == nil || activeAt.After(*lastActiveAt) {
					copyTime := activeAt
					lastActiveAt = &copyTime
				}
			}

			sessionStart, sessionEnd, ok := activityWindowForSession(sess)
			if !ok {
				continue
			}
			if !sessionEnd.Before(startDay) && sessionStart.Before(endExclusive) {
				totalSessions++
			}
			mergeSessionDayBuckets(buckets, startDay, endExclusive, sessionStart, sessionEnd)
		}

		page++
		if int64(len(list.Sessions)) < limit || page*limit >= list.TotalCount {
			break
		}
	}

	dayCounts := mergeDayBuckets(startDay, windowDays, buckets)
	details.Activity = &repository.AdminUserActivity{
		WindowDays:    windowDays,
		TotalSessions: totalSessions,
		ActiveDays:    countActiveDays(dayCounts),
		LastActiveAt:  lastActiveAt,
		Days:          dayCounts,
	}
}

func (s *AdminService) populateAppActivity(
	ctx context.Context,
	details *repository.AdminUserDetails,
	userID string,
	startDay, endExclusive time.Time,
	windowDays int,
) {
	if s.activityRepo == nil {
		details.SectionErrors["appActivity"] = "App activity repository is not configured"
		return
	}

	rows, err := s.activityRepo.ListUserDailyActivity(ctx, userID, startDay, endExclusive)
	if err != nil {
		details.SectionErrors["appActivity"] = "Failed to load app activity"
		return
	}

	lastSeenAt, err := s.activityRepo.GetLastUserActivityAt(ctx, userID)
	if err != nil {
		details.SectionErrors["appActivity"] = "Failed to load latest app activity"
		return
	}

	buckets := make(map[string]int64, len(rows))
	var totalHeartbeats int64
	for _, row := range rows {
		buckets[row.Day] = row.HitCount
		totalHeartbeats += row.HitCount
	}

	dayCounts := mergeDayBuckets(startDay, windowDays, buckets)
	details.AppActivity = &repository.AdminUserAppActivity{
		WindowDays:      windowDays,
		TotalHeartbeats: totalHeartbeats,
		ActiveDays:      countActiveDays(dayCounts),
		LastSeenAt:      lastSeenAt,
		Days:            dayCounts,
	}
}

func (s *AdminService) populateMutations(
	ctx context.Context,
	details *repository.AdminUserDetails,
	userID string,
	startDay, endExclusive time.Time,
	windowDays int,
) {
	total, err := s.adminRepo.CountUserMutations(ctx, userID)
	if err != nil {
		details.SectionErrors["mutations"] = "Failed to load mutation totals"
		return
	}
	details.Mutations.TotalMutations = total

	lastMutation, err := s.adminRepo.GetLastUserMutation(ctx, userID)
	if err == nil && lastMutation != nil {
		details.Mutations.LastMutation = &repository.AdminMutationSummary{
			ID:        lastMutation.ID,
			SpaceID:   lastMutation.SpaceID,
			Op:        lastMutation.Op,
			Version:   lastMutation.Version,
			Timestamp: lastMutation.Timestamp,
		}
	} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
		details.SectionErrors["mutations"] = "Failed to load latest mutation"
	}

	rows, err := s.adminRepo.ListUserMutationDays(ctx, userID, startDay, endExclusive)
	if err != nil {
		details.SectionErrors["mutations"] = "Failed to load mutation activity"
		return
	}

	buckets := make(map[string]int64, len(rows))
	for _, row := range rows {
		buckets[row.Day] = row.Count
	}

	dayCounts := mergeDayBuckets(startDay, windowDays, buckets)
	activeDays := countActiveDays(dayCounts)
	details.Mutations.Days = dayCounts
	details.Mutations.ActiveDays = activeDays
	if activeDays > 0 {
		details.Mutations.AvgPerActiveDay = float64(sumDayCounts(dayCounts)) / float64(activeDays)
	}
}

func (s *AdminService) populateWorkspaces(ctx context.Context, details *repository.AdminUserDetails, userID string) {
	if s.spaceRepo == nil {
		details.SectionErrors["workspaces"] = "Workspace repository is not configured"
		return
	}

	spaces, err := s.spaceRepo.ListForUser(ctx, userID)
	if err != nil {
		details.SectionErrors["workspaces"] = "Failed to load workspaces"
		return
	}

	items := make([]repository.AdminWorkspaceItem, 0, len(spaces))
	for i := range spaces {
		space := &spaces[i]
		item := repository.AdminWorkspaceItem{
			SpaceID:          space.SpaceID,
			DisplayName:      space.DisplayName,
			OwnerUserID:      space.OwnerUserID,
			Role:             space.Role,
			InvitationStatus: space.InvitationStatus,
			CreatedAt:        space.CreatedAt,
		}
		items = append(items, item)
		if space.Role == domain.RoleOwner {
			details.Workspaces.OwnedWorkspaceCount++
		} else {
			details.Workspaces.CollaboratorWorkspaceCount++
		}
	}
	details.Workspaces.Items = items

	occupied, err := s.spaceRepo.CountOccupiedCollaboratorSlotsByOwner(ctx, userID, "")
	if err != nil {
		details.SectionErrors["workspaces"] = "Failed to load share seat usage"
		return
	}
	details.Workspaces.OwnedShareSeatsUsed = int64(occupied)
}

func (s *AdminService) populateSubscription(details *repository.AdminUserDetails, user *repository.AdminUser) {
	subscription := &repository.AdminUserSubscriptionStats{
		Status:       user.SubscriptionStatus,
		Transactions: make([]repository.AdminSubscriptionTransaction, 0),
	}

	if user.SubscriptionID == nil && user.CustomerID == nil {
		details.Subscription = subscription
		return
	}
	if s.lsClient == nil {
		details.Subscription = subscription
		details.SectionErrors["subscription"] = "LemonSqueezy is not configured"
		return
	}

	var invoices []lemonsqueezy.Invoice
	if user.SubscriptionID != nil && *user.SubscriptionID != "" {
		subDetails, err := s.lsClient.GetSubscription(*user.SubscriptionID)
		if err != nil {
			details.SectionErrors["subscription"] = "Failed to load subscription details"
		} else {
			subscription.Status = subDetails.Status
			subscription.VariantName = subDetails.VariantName
			subscription.ProductName = subDetails.ProductName
			subscription.PriceFormatted = subDetails.PriceFormatted
			subscription.IntervalLabel = intervalLabel(subDetails.IntervalCount, subDetails.Interval)
			subscription.PlanName = firstNonEmpty(subDetails.VariantName, subDetails.ProductName)
		}

		invoiceRows, err := s.lsClient.GetSubscriptionInvoices(*user.SubscriptionID)
		if err != nil && details.SectionErrors["subscription"] == "" {
			details.SectionErrors["subscription"] = "Failed to load transactions"
		} else {
			invoices = invoiceRows
		}
	}

	if user.CustomerID != nil && *user.CustomerID != "" {
		customer, err := s.lsClient.GetCustomer(*user.CustomerID)
		if err == nil && customer != nil {
			subscription.LtvCents = int64(customer.Attributes.TotalRevenueCents)
			subscription.LtvFormatted = formatUSD(subscription.LtvCents)
		} else if details.SectionErrors["subscription"] == "" {
			details.SectionErrors["subscription"] = "Failed to load customer revenue"
		}
	}

	if subscription.LtvCents == 0 && len(invoices) > 0 {
		for i := range invoices {
			subscription.LtvCents += int64(invoices[i].Total)
		}
		subscription.LtvFormatted = formatUSD(subscription.LtvCents)
	}
	if subscription.PlanName == "" {
		subscription.PlanName = firstNonEmpty(subscription.VariantName, subscription.ProductName)
	}

	sort.Slice(invoices, func(i, j int) bool {
		return invoices[i].CreatedAt.After(invoices[j].CreatedAt)
	})
	for idx := range invoices {
		if idx >= 10 {
			break
		}
		invoice := &invoices[idx]
		subscription.Transactions = append(subscription.Transactions, repository.AdminSubscriptionTransaction{
			ID:              invoice.ID,
			Status:          invoice.Status,
			StatusFormatted: invoice.StatusFormatted,
			BillingReason:   invoice.BillingReason,
			TotalCents:      invoice.Total,
			TotalFormatted:  invoice.TotalFormatted,
			Currency:        invoice.Currency,
			InvoiceURL:      invoice.InvoiceURL,
			CreatedAt:       invoice.CreatedAt,
			Refunded:        invoice.Refunded,
			RefundedAt:      invoice.RefundedAt,
		})
	}

	details.Subscription = subscription
}

func normalizeAdminWindowDays(windowDays int) int {
	if windowDays <= 0 {
		return defaultAdminDetailsWindowDays
	}
	return windowDays
}

func emptyDayBuckets(startDay time.Time, windowDays int) []repository.AdminDayCount {
	result := make([]repository.AdminDayCount, 0, windowDays)
	for i := 0; i < windowDays; i++ {
		day := startDay.AddDate(0, 0, i)
		result = append(result, repository.AdminDayCount{
			Day:   day.Format("2006-01-02"),
			Count: 0,
		})
	}
	return result
}

func mergeDayBuckets(startDay time.Time, windowDays int, values map[string]int64) []repository.AdminDayCount {
	result := emptyDayBuckets(startDay, windowDays)
	for i := range result {
		if count, ok := values[result[i].Day]; ok {
			result[i].Count = count
		}
	}
	return result
}

func countActiveDays(days []repository.AdminDayCount) int64 {
	var total int64
	for _, day := range days {
		if day.Count > 0 {
			total++
		}
	}
	return total
}

func sumDayCounts(days []repository.AdminDayCount) int64 {
	var total int64
	for _, day := range days {
		total += day.Count
	}
	return total
}

func clerkUnixTime(raw int64) time.Time {
	if raw == 0 {
		return time.Time{}
	}
	if raw > 1_000_000_000_000 {
		return time.UnixMilli(raw).UTC()
	}
	return time.Unix(raw, 0).UTC()
}

func activityWindowForSession(sess *clerk.Session) (startAt, endAt time.Time, ok bool) {
	if sess == nil {
		return time.Time{}, time.Time{}, false
	}

	startAt = clerkUnixTime(sess.CreatedAt)
	if startAt.IsZero() {
		startAt = clerkUnixTime(sess.LastActiveAt)
	}
	if startAt.IsZero() {
		return time.Time{}, time.Time{}, false
	}

	endAt = clerkUnixTime(sess.LastActiveAt)
	if endAt.IsZero() {
		endAt = startAt
	}

	// Clerk does not expose a generic ended_at field in the backend session object.
	// For expired sessions, expire_at is the only durable terminal bound we can use.
	if strings.EqualFold(strings.TrimSpace(sess.Status), "expired") {
		expireAt := clerkUnixTime(sess.ExpireAt)
		if !expireAt.IsZero() && expireAt.After(endAt) {
			endAt = expireAt
		}
	}

	if endAt.Before(startAt) {
		endAt = startAt
	}

	return startAt.UTC(), endAt.UTC(), true
}

func mergeSessionDayBuckets(
	buckets map[string]int64,
	startDay, endExclusive time.Time,
	sessionStart, sessionEnd time.Time,
) {
	if sessionEnd.Before(startDay) || !sessionStart.Before(endExclusive) {
		return
	}

	current := maxTime(sessionStart.UTC().Truncate(24*time.Hour), startDay)
	lastDay := minTime(sessionEnd.UTC().Truncate(24*time.Hour), endExclusive.AddDate(0, 0, -1))
	for !current.After(lastDay) {
		buckets[current.Format("2006-01-02")]++
		current = current.AddDate(0, 0, 1)
	}
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

func intervalLabel(count int, interval string) string {
	interval = strings.TrimSpace(interval)
	if interval == "" {
		return ""
	}
	if count <= 1 {
		return fmt.Sprintf("Every %s", interval)
	}
	return fmt.Sprintf("Every %d %ss", count, interval)
}

func formatUSD(cents int64) string {
	return fmt.Sprintf("$%.2f", float64(cents)/100)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
