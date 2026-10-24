package sqlite_test

import (
	"context"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/sqlite"
	"budgero-server/internal/domain"
	"budgero-server/internal/testkit"
)

// Cloud analytics is opt-out: a new account starts enabled and only an explicit
// Settings change disables it.
func TestUserRepository_Create_AnalyticsEnabledByDefault(t *testing.T) {
	_, queries := testkit.NewTestDB(t, false)
	repo := sqlite.NewUserRepository(queries)
	ctx := context.Background()

	created, err := repo.Create(ctx, &domain.User{
		ID:                 testkit.GenerateID(),
		Name:               "New User",
		Email:              "new@example.com",
		SubscriptionStatus: "trialing",
		CreatedAt:          time.Now(),
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if created.IsAnalyticsDisabled {
		t.Fatal("new user has analytics disabled; want enabled (opt-out)")
	}

	stored, err := repo.GetByID(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}
	if stored.IsAnalyticsDisabled {
		t.Fatal("stored new user has analytics disabled; want enabled (opt-out)")
	}
}
