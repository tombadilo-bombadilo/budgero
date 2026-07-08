package sqlite_test

import (
	"context"
	"errors"
	"testing"

	"budgero-server/internal/adapter/driven/sqlite"
	"budgero-server/internal/domain"
	"budgero-server/internal/testkit"
)

func TestCredentialRepository_Create(t *testing.T) {
	_, queries := testkit.NewTestDB(t, true)
	repo := sqlite.NewCredentialRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "cred@example.com")

	err := repo.Create(ctx, userID, "hashed_password", false)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	// Verify
	cred, err := repo.Get(ctx, userID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if cred.UserID != userID {
		t.Errorf("UserID = %v, want %v", cred.UserID, userID)
	}
	if cred.PasswordHash != "hashed_password" {
		t.Errorf("PasswordHash = %v, want hashed_password", cred.PasswordHash)
	}
	if cred.IsAdmin {
		t.Error("IsAdmin = true, want false")
	}
}

func TestCredentialRepository_Create_Admin(t *testing.T) {
	_, queries := testkit.NewTestDB(t, true)
	repo := sqlite.NewCredentialRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "admin@example.com")

	err := repo.Create(ctx, userID, "admin_password", true)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	cred, _ := repo.Get(ctx, userID)
	if !cred.IsAdmin {
		t.Error("IsAdmin = false, want true")
	}
}

func TestCredentialRepository_Upsert(t *testing.T) {
	_, queries := testkit.NewTestDB(t, true)
	repo := sqlite.NewCredentialRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "upsert@example.com")

	// Create via upsert
	err := repo.Upsert(ctx, userID, "initial_hash", false)
	if err != nil {
		t.Fatalf("Upsert() create error = %v", err)
	}

	// Update via upsert
	err = repo.Upsert(ctx, userID, "updated_hash", true)
	if err != nil {
		t.Fatalf("Upsert() update error = %v", err)
	}

	// Verify
	cred, _ := repo.Get(ctx, userID)
	if cred.PasswordHash != "updated_hash" {
		t.Errorf("PasswordHash = %v, want updated_hash", cred.PasswordHash)
	}
	if !cred.IsAdmin {
		t.Error("IsAdmin = false after upsert, want true")
	}
}

func TestCredentialRepository_Get(t *testing.T) {
	_, queries := testkit.NewTestDB(t, true)
	repo := sqlite.NewCredentialRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "get@example.com")
	_ = repo.Create(ctx, userID, "password_hash", false)

	cred, err := repo.Get(ctx, userID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if cred.UserID != userID {
		t.Errorf("UserID = %v, want %v", cred.UserID, userID)
	}
}

func TestCredentialRepository_Get_NotFound(t *testing.T) {
	_, queries := testkit.NewTestDB(t, true)
	repo := sqlite.NewCredentialRepository(queries)
	ctx := context.Background()

	_, err := repo.Get(ctx, "nonexistent")
	if !errors.Is(err, domain.ErrInvalidCredentials) {
		t.Errorf("Get() error = %v, want ErrInvalidCredentials", err)
	}
}

func TestCredentialRepository_UpdatePassword(t *testing.T) {
	_, queries := testkit.NewTestDB(t, true)
	repo := sqlite.NewCredentialRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "password@example.com")
	_ = repo.Create(ctx, userID, "old_hash", false)

	err := repo.UpdatePassword(ctx, userID, "new_hash")
	if err != nil {
		t.Fatalf("UpdatePassword() error = %v", err)
	}

	cred, _ := repo.Get(ctx, userID)
	if cred.PasswordHash != "new_hash" {
		t.Errorf("PasswordHash = %v, want new_hash", cred.PasswordHash)
	}
}

func TestCredentialRepository_SetAdmin(t *testing.T) {
	_, queries := testkit.NewTestDB(t, true)
	repo := sqlite.NewCredentialRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "setadmin@example.com")
	_ = repo.Create(ctx, userID, "hash", false)

	// Set admin to true
	err := repo.SetAdmin(ctx, userID, true)
	if err != nil {
		t.Fatalf("SetAdmin(true) error = %v", err)
	}

	isAdmin, _ := repo.IsAdmin(ctx, userID)
	if !isAdmin {
		t.Error("IsAdmin() = false, want true")
	}

	// Set admin to false
	err = repo.SetAdmin(ctx, userID, false)
	if err != nil {
		t.Fatalf("SetAdmin(false) error = %v", err)
	}

	isAdmin, _ = repo.IsAdmin(ctx, userID)
	if isAdmin {
		t.Error("IsAdmin() = true, want false")
	}
}

func TestCredentialRepository_IsAdmin(t *testing.T) {
	_, queries := testkit.NewTestDB(t, true)
	repo := sqlite.NewCredentialRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "isadmin@example.com")
	_ = repo.Create(ctx, userID, "hash", true)

	isAdmin, err := repo.IsAdmin(ctx, userID)
	if err != nil {
		t.Fatalf("IsAdmin() error = %v", err)
	}
	if !isAdmin {
		t.Error("IsAdmin() = false, want true")
	}
}

func TestCredentialRepository_IsAdmin_NoCredential(t *testing.T) {
	_, queries := testkit.NewTestDB(t, true)
	repo := sqlite.NewCredentialRepository(queries)
	ctx := context.Background()

	// User without credential
	userID := testkit.SeedUser(t, queries, "nocred@example.com")

	isAdmin, err := repo.IsAdmin(ctx, userID)
	if err != nil {
		t.Fatalf("IsAdmin() error = %v", err)
	}
	if isAdmin {
		t.Error("IsAdmin() = true for user without credential, want false")
	}
}

func TestCredentialRepository_MarkLogin(t *testing.T) {
	_, queries := testkit.NewTestDB(t, true)
	repo := sqlite.NewCredentialRepository(queries)
	ctx := context.Background()

	userID := testkit.SeedUser(t, queries, "login@example.com")
	_ = repo.Create(ctx, userID, "hash", false)

	err := repo.MarkLogin(ctx, userID)
	if err != nil {
		t.Fatalf("MarkLogin() error = %v", err)
	}

	// Verify last login was updated
	cred, _ := repo.Get(ctx, userID)
	if cred.LastLoginAt == nil {
		t.Error("LastLoginAt = nil after MarkLogin, want non-nil")
	}
}
