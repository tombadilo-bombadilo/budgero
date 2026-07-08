package application_test

import (
	"context"
	"testing"

	"budgero-server/internal/adapter/driven/fake"
	"budgero-server/internal/application"
)

func TestSyncService_GetLatestVersion(t *testing.T) {
	ctx := context.Background()
	syncRepo := fake.NewSyncRepository()
	svc := application.NewSyncService(syncRepo)

	syncRepo.SeedLatestVersion("space1", 2)

	version, err := svc.GetLatestVersion(ctx, "space1")
	if err != nil {
		t.Fatalf("GetLatestVersion() error = %v", err)
	}
	if version != 2 {
		t.Errorf("GetLatestVersion() = %v, want 2", version)
	}
}

func TestSyncService_GetLatestVersion_EmptySpace(t *testing.T) {
	ctx := context.Background()
	syncRepo := fake.NewSyncRepository()
	svc := application.NewSyncService(syncRepo)

	// Empty space should return version 0
	version, err := svc.GetLatestVersion(ctx, "empty-space")
	if err != nil {
		t.Fatalf("GetLatestVersion() error = %v", err)
	}
	if version != 0 {
		t.Errorf("GetLatestVersion() = %v, want 0 for empty space", version)
	}
}
