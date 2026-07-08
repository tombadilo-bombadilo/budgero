// Package testkit provides shared test infrastructure for service tests.
package testkit

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/sqlite"
	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/application"
	"budgero-server/internal/config"
	"budgero-server/internal/pkg/crypto"

	"golang.org/x/crypto/bcrypt"
)

// TestContext holds shared test infrastructure for handler tests.
type TestContext struct {
	DB      *sql.DB
	Queries *sqlc.Queries
}

// NewTestDB creates a new test database in a temporary directory.
// The database is automatically cleaned up when the test completes.
func NewTestDB(t *testing.T, selfHost bool) (*sql.DB, *sqlc.Queries) {
	t.Helper()

	// Create temp directory for the test
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	// Set environment variables for database initialization
	t.Setenv("DB_PATH", dbPath)
	if selfHost {
		t.Setenv("SELF_HOSTABLE", "true")
	} else {
		t.Setenv("SELF_HOSTABLE", "false")
	}

	// Open database connection
	sqlDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("failed to open test database: %v", err)
	}

	// Run goose migrations
	if err := sqlite.Migrate(sqlDB); err != nil {
		_ = sqlDB.Close()
		t.Fatalf("failed to run migrations: %v", err)
	}

	// Enable WAL mode for better performance
	if _, err := sqlDB.Exec("PRAGMA journal_mode = WAL;"); err != nil {
		_ = sqlDB.Close()
		t.Fatalf("failed to enable WAL mode: %v", err)
	}

	// Register cleanup
	t.Cleanup(func() {
		_ = sqlDB.Close()
	})

	return sqlDB, sqlc.New(sqlDB)
}

// NewTestConfig creates a minimal config for testing.
func NewTestConfig(selfHost bool) *config.Config {
	cfg := &config.Config{
		Server: config.ServerConfig{
			Port:     3001,
			LogLevel: "debug",
			AppURL:   "http://localhost:5173",
		},
		Auth: config.AuthConfig{
			SelfHostable: selfHost,
			JWTSecret:    "test-jwt-secret-12345",
			JWTTTLHours:  24,
			AdminEmails:  []string{"admin@test.com"},
		},
		Database: config.DatabaseConfig{
			Path: "data/test.db",
		},
		Features: config.FeatureConfig{
			TrialDurationDays: 35,
		},
	}
	return cfg
}

// NewTestServices creates all services with test infrastructure.
func NewTestServices(t *testing.T, selfHost bool) (*sql.DB, *sqlc.Queries, *application.Services, *config.Config) {
	t.Helper()

	sqlDB, queries := NewTestDB(t, selfHost)
	cfg := NewTestConfig(selfHost)

	// Create repositories and services
	repos := &application.Repositories{
		User:            sqlite.NewUserRepository(queries),
		Space:           sqlite.NewSpaceRepository(queries),
		Credential:      sqlite.NewCredentialRepository(queries),
		Entitlement:     sqlite.NewEntitlementRepository(queries),
		Sync:            sqlite.NewSyncRepository(queries),
		Push:            sqlite.NewPushRepository(queries),
		ExchangeRate:    sqlite.NewExchangeRateRepository(queries),
		Activity:        sqlite.NewActivityRepository(sqlDB, queries),
		Admin:           sqlite.NewAdminRepository(queries),
		DatabaseBrowser: sqlite.NewDatabaseBrowserRepository(sqlDB),
		TrialRewards:    sqlite.NewTrialRewardsRepository(queries),
		Feedback:        sqlite.NewFeedbackRepository(sqlDB),
		Queries:         queries,
	}

	return sqlDB, queries, application.NewServices(repos, cfg), cfg
}

// SeedUser creates a test user and returns the user ID.
func SeedUser(t *testing.T, queries *sqlc.Queries, email string) string {
	t.Helper()

	userID := GenerateID()
	ctx := context.Background()

	_, err := queries.CreateUser(ctx, sqlc.CreateUserParams{
		ID:                 userID,
		Name:               "Test User",
		Email:              email,
		SubscriptionStatus: sql.NullString{String: "trialing", Valid: true},
		TrialEndsAt:        sql.NullTime{Time: time.Now().Add(35 * 24 * time.Hour), Valid: true},
		CreatedAt:          sql.NullTime{Time: time.Now(), Valid: true},
	})
	if err != nil {
		t.Fatalf("failed to seed user: %v", err)
	}

	return userID
}

// SeedUserWithStatus creates a test user with specific subscription status.
func SeedUserWithStatus(t *testing.T, sqlDB *sql.DB, queries *sqlc.Queries, email, status string, trialEndsAt, subscriptionEndsAt, currentPeriodEnd *time.Time) string {
	t.Helper()

	userID := GenerateID()
	ctx := context.Background()

	params := sqlc.CreateUserParams{
		ID:                 userID,
		Name:               "Test User",
		Email:              email,
		SubscriptionStatus: sql.NullString{String: status, Valid: true},
		CreatedAt:          sql.NullTime{Time: time.Now(), Valid: true},
	}

	if trialEndsAt != nil {
		params.TrialEndsAt = sql.NullTime{Time: *trialEndsAt, Valid: true}
	}

	_, err := queries.CreateUser(ctx, params)
	if err != nil {
		t.Fatalf("failed to seed user: %v", err)
	}

	// Update subscription fields if needed using raw SQL
	if subscriptionEndsAt != nil || currentPeriodEnd != nil {
		updateSQL := "UPDATE users SET "
		args := []interface{}{}
		first := true

		if subscriptionEndsAt != nil {
			updateSQL += "subscription_ends_at = ?"
			args = append(args, *subscriptionEndsAt)
			first = false
		}
		if currentPeriodEnd != nil {
			if !first {
				updateSQL += ", "
			}
			updateSQL += "current_period_end = ?"
			args = append(args, *currentPeriodEnd)
		}
		updateSQL += " WHERE id = ?"
		args = append(args, userID)

		_, err := sqlDB.ExecContext(ctx, updateSQL, args...)
		if err != nil {
			t.Fatalf("failed to update user subscription fields: %v", err)
		}
	}

	return userID
}

// SeedSpace creates a test space for a user and returns the space ID.
func SeedSpace(t *testing.T, sqlDB *sql.DB, queries *sqlc.Queries, ownerID, displayName string) string {
	t.Helper()

	spaceID := GenerateID()
	ctx := context.Background()

	// Create space
	_, err := queries.CreateSpace(ctx, sqlc.CreateSpaceParams{
		SpaceID:     spaceID,
		OwnerUserID: ownerID,
		DisplayName: displayName,
	})
	if err != nil {
		t.Fatalf("failed to seed space: %v", err)
	}

	// Create owner membership
	now := time.Now()
	err = queries.CreateSpaceMember(ctx, sqlc.CreateSpaceMemberParams{
		SpaceID:           spaceID,
		UserID:            ownerID,
		Role:              "owner",
		EncryptedSpaceKey: "",
		InvitationStatus:  "accepted",
		InvitedAt:         now,
		AcceptedAt:        sql.NullTime{Time: now, Valid: true},
	})
	if err != nil {
		t.Fatalf("failed to seed space membership: %v", err)
	}

	// Create blob metadata
	blobPath := filepath.Join(t.TempDir(), fmt.Sprintf("space_%s.db", spaceID))
	err = queries.CreateSpaceBlob(ctx, sqlc.CreateSpaceBlobParams{
		SpaceID:   spaceID,
		BlobPath:  blobPath,
		UpdatedAt: now,
	})
	if err != nil {
		t.Fatalf("failed to seed space blob: %v", err)
	}

	// Update user's primary space using raw SQL
	_, err = sqlDB.ExecContext(ctx, "UPDATE users SET primary_space_id = ? WHERE id = ?", spaceID, ownerID)
	if err != nil {
		t.Fatalf("failed to set primary space: %v", err)
	}

	return spaceID
}

// SeedInvite creates a test invite and returns the invite ID and secret.
func SeedInvite(t *testing.T, queries *sqlc.Queries, spaceID, inviterID, inviteeEmail string) (inviteID, secret string) {
	t.Helper()

	inviteID = GenerateID()
	secret = GenerateSecret()
	ctx := context.Background()

	_, err := queries.CreateSpaceInvite(ctx, sqlc.CreateSpaceInviteParams{
		ID:            inviteID,
		SpaceID:       spaceID,
		InviterUserID: inviterID,
		InviteeEmail:  sql.NullString{String: inviteeEmail, Valid: inviteeEmail != ""},
		InviteSecret:  secret,
		ExpiresAt:     sql.NullTime{Time: time.Now().Add(7 * 24 * time.Hour), Valid: true},
		CreatedAt:     time.Now(),
	})
	if err != nil {
		t.Fatalf("failed to seed invite: %v", err)
	}

	return inviteID, secret
}

// SeedMembership creates a membership for a user in a space.
func SeedMembership(t *testing.T, queries *sqlc.Queries, spaceID, userID, role string) {
	t.Helper()

	now := time.Now()
	ctx := context.Background()
	err := queries.CreateSpaceMember(ctx, sqlc.CreateSpaceMemberParams{
		SpaceID:           spaceID,
		UserID:            userID,
		Role:              role,
		EncryptedSpaceKey: "",
		InvitationStatus:  "accepted",
		InvitedAt:         now,
		AcceptedAt:        sql.NullTime{Time: now, Valid: true},
	})
	if err != nil {
		t.Fatalf("failed to seed membership: %v", err)
	}
}

// SeedMutation creates a test mutation and returns the mutation ID.
func SeedMutation(t *testing.T, queries *sqlc.Queries, spaceID, userID string, version int64, encryptedPayload string) string {
	t.Helper()

	mutationID := GenerateID()
	ctx := context.Background()
	err := queries.CreateMutation(ctx, sqlc.CreateMutationParams{
		ID:               mutationID,
		SpaceID:          spaceID,
		UserID:           userID,
		Version:          version,
		Op:               sql.NullString{},
		Args:             sql.NullString{},
		EncryptedPayload: sql.NullString{String: encryptedPayload, Valid: encryptedPayload != ""},
		Timestamp:        time.Now(),
		BaseVersion:      version - 1,
	})
	if err != nil {
		t.Fatalf("failed to seed mutation: %v", err)
	}

	return mutationID
}

// SeedPushToken creates a test push API token for a user.
// Returns the token hash.
func SeedPushToken(t *testing.T, queries *sqlc.Queries, userID, spaceID string) string {
	t.Helper()

	tokenHash := GenerateHash()
	ctx := context.Background()

	err := queries.CreatePushAPIToken(ctx, sqlc.CreatePushAPITokenParams{
		UserID:    userID,
		TokenHash: tokenHash,
		SpaceID:   spaceID,
	})
	if err != nil {
		t.Fatalf("failed to seed push token: %v", err)
	}

	return tokenHash
}

// SeedExchangeRate creates a test exchange rate.
func SeedExchangeRate(t *testing.T, queries *sqlc.Queries, baseCurrency, targetCurrency, month string, rate float64) {
	t.Helper()

	ctx := context.Background()
	err := queries.UpsertExchangeRate(ctx, sqlc.UpsertExchangeRateParams{
		BaseCurrency:   baseCurrency,
		TargetCurrency: targetCurrency,
		Month:          month,
		Rate:           rate,
	})
	if err != nil {
		t.Fatalf("failed to seed exchange rate: %v", err)
	}
}

func generateRandom(nBytes int, fallbackPrefix string) string {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%s_%d", fallbackPrefix, time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// GenerateID generates a unique ID for testing.
func GenerateID() string { return generateRandom(16, "test") }

// GenerateSecret generates a unique secret for testing.
func GenerateSecret() string { return generateRandom(32, "secret") }

// GenerateHash generates a unique hash for testing.
func GenerateHash() string { return generateRandom(32, "hash") }

// AssertTimeWithin asserts that the given time is within the specified duration from now.
func AssertTimeWithin(t *testing.T, actual time.Time, duration time.Duration) {
	t.Helper()
	now := time.Now()
	if actual.Before(now.Add(-duration)) || actual.After(now.Add(duration)) {
		t.Errorf("time %v is not within %v of now (%v)", actual, duration, now)
	}
}

// SeedCredential creates a local credential for a user in self-host mode.
func SeedCredential(t *testing.T, queries *sqlc.Queries, userID, passwordHash string, isAdmin bool) error {
	t.Helper()

	ctx := context.Background()
	return queries.UpsertLocalCredential(ctx, sqlc.UpsertLocalCredentialParams{
		UserID:       userID,
		PasswordHash: passwordHash,
		IsAdmin:      isAdmin,
	})
}

// SeedCredentialWithPassword creates a local credential for a user with a real password.
func SeedCredentialWithPassword(t *testing.T, queries *sqlc.Queries, userID, password string, isAdmin bool) error {
	t.Helper()

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("failed to hash password: %v", err)
	}

	return SeedCredential(t, queries, userID, string(hash), isAdmin)
}

// AttachInviteBundle attaches an encrypted bundle to an existing invite.
func AttachInviteBundle(t *testing.T, queries *sqlc.Queries, inviteSecret, encryptedBundle string) {
	t.Helper()

	ctx := context.Background()

	// Get the invite by secret to find ID and SpaceID
	invite, err := queries.GetSpaceInviteBySecret(ctx, inviteSecret)
	if err != nil {
		t.Fatalf("failed to get invite by secret: %v", err)
	}

	err = queries.UpdateInviteBundle(ctx, sqlc.UpdateInviteBundleParams{
		ID:              invite.ID,
		SpaceID:         invite.SpaceID,
		EncryptedBundle: sql.NullString{String: encryptedBundle, Valid: true},
	})
	if err != nil {
		t.Fatalf("failed to attach invite bundle: %v", err)
	}
}

// SeedPushTokenWithPlaintext creates a push token and returns the plaintext token.
// This is useful for testing push mutation endpoints that need the actual token.
func SeedPushTokenWithPlaintext(t *testing.T, queries *sqlc.Queries, userID, spaceID string) string {
	t.Helper()

	// Generate a random token
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}
	plaintext := hex.EncodeToString(tokenBytes)

	// Hash it
	tokenHash := crypto.HashToken(plaintext)

	ctx := context.Background()
	err := queries.CreatePushAPIToken(ctx, sqlc.CreatePushAPITokenParams{
		UserID:    userID,
		TokenHash: tokenHash,
		SpaceID:   spaceID,
	})
	if err != nil {
		t.Fatalf("failed to seed push token: %v", err)
	}

	return plaintext
}
