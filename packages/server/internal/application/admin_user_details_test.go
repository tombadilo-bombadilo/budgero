package application_test

import (
	"context"
	"testing"
	"time"

	"budgero-server/internal/testkit"
)

func TestAdminService_GetUserDetails_AggregatesWorkspaces(t *testing.T) {
	sqlDB, queries, services, _ := testkit.NewTestServices(t, false)
	ctx := context.Background()

	ownerID := testkit.SeedUser(t, queries, "owner@example.com")
	memberID := testkit.SeedUser(t, queries, "member@example.com")
	if _, err := sqlDB.ExecContext(ctx, "UPDATE users SET subscription_id = ?, customer_id = ? WHERE id = ?", "sub_owner", "cust_owner", ownerID); err != nil {
		t.Fatalf("failed to attach subscription identifiers: %v", err)
	}

	ownedSpace1 := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Primary")
	ownedSpace2 := testkit.SeedSpace(t, sqlDB, queries, ownerID, "Side Project")
	sharedSpace := testkit.SeedSpace(t, sqlDB, queries, memberID, "Shared")

	testkit.SeedMembership(t, queries, ownedSpace1, memberID, "member")
	testkit.SeedMembership(t, queries, sharedSpace, ownerID, "member")
	testkit.SeedMembership(t, queries, ownedSpace2, memberID, "member")
	// Seed activity relative to now so it always lands inside the 90-day
	// lookback window below. Hardcoded absolute dates rot once wall-clock time
	// moves them out of the window.
	now := time.Now().UTC()
	earlierDay := now.AddDate(0, 0, -5).Format("2006-01-02")
	recentDay := now.AddDate(0, 0, -3).Format("2006-01-02")
	recentLastSeen := recentDay + "T10:00:00Z"
	if _, err := sqlDB.ExecContext(
		ctx,
		"INSERT INTO user_daily_activity (user_id, day, first_seen_at, last_seen_at, hit_count) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)",
		ownerID, earlierDay, earlierDay+"T08:00:00Z", earlierDay+"T11:00:00Z", 3,
		ownerID, recentDay, recentDay+"T09:00:00Z", recentLastSeen, 2,
	); err != nil {
		t.Fatalf("failed to seed user activity: %v", err)
	}

	details, err := services.Admin.GetUserDetails(ctx, ownerID, 90)
	if err != nil {
		t.Fatalf("GetUserDetails() error = %v", err)
	}

	if details.Workspaces.OwnedWorkspaceCount != 2 {
		t.Fatalf("OwnedWorkspaceCount = %d, want 2", details.Workspaces.OwnedWorkspaceCount)
	}
	if details.Workspaces.CollaboratorWorkspaceCount != 1 {
		t.Fatalf("CollaboratorWorkspaceCount = %d, want 1", details.Workspaces.CollaboratorWorkspaceCount)
	}
	if details.Workspaces.OwnedShareSeatsUsed != 2 {
		t.Fatalf("OwnedShareSeatsUsed = %d, want 2", details.Workspaces.OwnedShareSeatsUsed)
	}
	if len(details.Workspaces.Items) != 3 {
		t.Fatalf("workspace items = %d, want 3", len(details.Workspaces.Items))
	}
	if details.AppActivity == nil {
		t.Fatalf("AppActivity should be populated")
	}
	if details.AppActivity.TotalHeartbeats != 5 {
		t.Fatalf("TotalHeartbeats = %d, want 5", details.AppActivity.TotalHeartbeats)
	}
	if details.AppActivity.ActiveDays != 2 {
		t.Fatalf("ActiveDays = %d, want 2", details.AppActivity.ActiveDays)
	}
	if details.AppActivity.LastSeenAt == nil ||
		details.AppActivity.LastSeenAt.Format(time.RFC3339) != recentLastSeen {
		t.Fatalf("LastSeenAt = %v, want %s", details.AppActivity.LastSeenAt, recentLastSeen)
	}

	if details.SectionErrors == nil {
		t.Fatalf("SectionErrors should include partial failures for unconfigured providers")
	}
	if details.SectionErrors["activity"] == "" {
		t.Fatalf("activity section error should be populated when Clerk is unavailable")
	}
	if details.SectionErrors["subscription"] == "" {
		t.Fatalf("subscription section error should be populated when LemonSqueezy is unavailable")
	}
}
