package application_test

import (
	"context"
	"testing"
	"time"

	"budgero-server/internal/adapter/driven/fake"
	"budgero-server/internal/application"
	"budgero-server/internal/config"
	"budgero-server/internal/domain"
)

func TestEntitlementService_HasWorkspaceAccess(t *testing.T) {
	ctx := context.Background()
	future := time.Now().Add(24 * time.Hour)
	past := time.Now().Add(-24 * time.Hour)

	tests := []struct {
		name string
		user *domain.User
		cfg  *config.Config
		want bool
	}{
		{
			name: "nil user has no access",
			user: nil,
			want: false,
		},
		{
			name: "self-host mode grants access",
			user: &domain.User{ID: "user1"},
			cfg:  &config.Config{Auth: config.AuthConfig{SelfHostable: true}},
			want: true,
		},
		{
			name: "founding member has access",
			user: &domain.User{ID: "user1", IsFoundingMember: true},
			want: true,
		},
		{
			name: "active beta has access",
			user: &domain.User{ID: "user1", HasBetaAccess: true, BetaExpiresAt: &future},
			want: true,
		},
		{
			name: "expired beta has no access",
			user: &domain.User{ID: "user1", HasBetaAccess: true, BetaExpiresAt: &past},
			want: false,
		},
		{
			name: "active subscription has access",
			user: &domain.User{ID: "user1", SubscriptionStatus: domain.SubscriptionActive},
			want: true,
		},
		{
			name: "lifetime subscription has access",
			user: &domain.User{ID: "user1", SubscriptionStatus: domain.SubscriptionLifetime},
			want: true,
		},
		{
			name: "trialing with active trial has access",
			user: &domain.User{ID: "user1", SubscriptionStatus: domain.SubscriptionTrialing, TrialEndsAt: &future},
			want: true,
		},
		{
			name: "trialing with expired trial has no access",
			user: &domain.User{ID: "user1", SubscriptionStatus: domain.SubscriptionTrialing, TrialEndsAt: &past},
			want: false,
		},
		{
			name: "on_trial with active trial has access",
			user: &domain.User{ID: "user1", SubscriptionStatus: domain.SubscriptionOnTrial, TrialEndsAt: &future},
			want: true,
		},
		{
			name: "cancelled subscription without end date has no access",
			user: &domain.User{ID: "user1", SubscriptionStatus: domain.SubscriptionCancelled},
			want: false,
		},
		{
			name: "cancelled subscription with future end date has access",
			user: &domain.User{ID: "user1", SubscriptionStatus: domain.SubscriptionCancelled, SubscriptionEndsAt: &future},
			want: true,
		},
		{
			name: "cancelled subscription with past end date has no access",
			user: &domain.User{ID: "user1", SubscriptionStatus: domain.SubscriptionCancelled, SubscriptionEndsAt: &past},
			want: false,
		},
		{
			name: "cancelled paid subscription retains access until subscription_ends_at",
			user: &domain.User{
				ID:                 "user_37tAvqnFHpmSjgi2vdMdL1G4ltX",
				Email:              "yodasay706@emaxasp.com",
				SubscriptionStatus: domain.SubscriptionCancelled,
				SubscriptionEndsAt: &future, // e.g. 2026-02-06 when cancelled on 2026-01-06
				TrialEndsAt:        nil,     // no trial - was a paid user
				HasBetaAccess:      false,
				IsFoundingMember:   false,
			},
			want: true,
		},
		{
			name: "expired subscription has no access",
			user: &domain.User{ID: "user1", SubscriptionStatus: domain.SubscriptionExpired},
			want: false,
		},
		{
			name: "user with no entitlements has no access",
			user: &domain.User{ID: "user1"},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userRepo := fake.NewUserRepository()
			entitlementRepo := fake.NewEntitlementRepository(userRepo)

			if tt.user != nil {
				_, _ = userRepo.Create(ctx, tt.user)
			}

			cfg := tt.cfg
			if cfg == nil {
				cfg = &config.Config{}
			}

			svc := application.NewEntitlementService(entitlementRepo, userRepo, cfg)
			got := svc.HasWorkspaceAccess(tt.user)

			if got != tt.want {
				t.Errorf("HasWorkspaceAccess() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestEntitlementService_HasWorkspaceAccessByID(t *testing.T) {
	ctx := context.Background()
	future := time.Now().Add(24 * time.Hour)

	tests := []struct {
		name   string
		userID string
		setup  func(*fake.UserRepository)
		want   bool
	}{
		{
			name:   "non-existent user has no access",
			userID: "missing",
			setup:  func(r *fake.UserRepository) {},
			want:   false,
		},
		{
			name:   "existing user with subscription has access",
			userID: "user1",
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{ID: "user1", SubscriptionStatus: domain.SubscriptionActive})
			},
			want: true,
		},
		{
			name:   "existing user with active trial has access",
			userID: "user1",
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{ID: "user1", SubscriptionStatus: domain.SubscriptionTrialing, TrialEndsAt: &future})
			},
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userRepo := fake.NewUserRepository()
			entitlementRepo := fake.NewEntitlementRepository(userRepo)
			tt.setup(userRepo)

			svc := application.NewEntitlementService(entitlementRepo, userRepo, &config.Config{})
			got := svc.HasWorkspaceAccessByID(ctx, tt.userID)

			if got != tt.want {
				t.Errorf("HasWorkspaceAccessByID() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestEntitlementService_CheckAndRevokeExpiredBeta(t *testing.T) {
	ctx := context.Background()
	past := time.Now().Add(-24 * time.Hour)
	future := time.Now().Add(24 * time.Hour)

	tests := []struct {
		name             string
		user             *domain.User
		wantBetaRevoked  bool
	}{
		{
			name:            "nil user does nothing",
			user:            nil,
			wantBetaRevoked: false,
		},
		{
			name:            "user with expired beta gets revoked",
			user:            &domain.User{ID: "user1", HasBetaAccess: true, BetaExpiresAt: &past},
			wantBetaRevoked: true,
		},
		{
			name:            "user with active beta keeps access",
			user:            &domain.User{ID: "user1", HasBetaAccess: true, BetaExpiresAt: &future},
			wantBetaRevoked: false,
		},
		{
			name:            "user without beta is unchanged",
			user:            &domain.User{ID: "user1", HasBetaAccess: false},
			wantBetaRevoked: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userRepo := fake.NewUserRepository()
			entitlementRepo := fake.NewEntitlementRepository(userRepo)

			if tt.user != nil {
				_, _ = userRepo.Create(ctx, tt.user)
			}

			svc := application.NewEntitlementService(entitlementRepo, userRepo, &config.Config{})
			svc.CheckAndRevokeExpiredBeta(ctx, tt.user)

			if tt.user != nil && tt.wantBetaRevoked {
				user, _ := userRepo.GetByID(ctx, tt.user.ID)
				if user.HasBetaAccess {
					t.Error("Expected beta access to be revoked")
				}
			}
		})
	}
}

func ptr(s string) *string {
	return &s
}

// === Subscription Management Tests ===

func TestEntitlementService_UpdateSubscription(t *testing.T) {
	ctx := context.Background()
	future := time.Now().Add(30 * 24 * time.Hour)

	tests := []struct {
		name       string
		userID     string
		update     domain.SubscriptionUpdate
		setup      func(*fake.UserRepository)
		wantStatus string
		wantErr    error
	}{
		{
			name:   "update to active subscription",
			userID: "user1",
			update: domain.SubscriptionUpdate{
				Status:           domain.SubscriptionActive,
				SubscriptionID:   ptr("sub_123"),
				CustomerID:       ptr("cus_456"),
				VariantID:        ptr("var_789"),
				CurrentPeriodEnd: &future,
			},
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{ID: "user1", Email: "user1@example.com"})
			},
			wantStatus: domain.SubscriptionActive,
		},
		{
			name:   "update to cancelled subscription",
			userID: "user1",
			update: domain.SubscriptionUpdate{
				Status:          domain.SubscriptionCancelled,
				SubscriptionEnds: &future,
			},
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{ID: "user1", Email: "user1@example.com", SubscriptionStatus: domain.SubscriptionActive})
			},
			wantStatus: domain.SubscriptionCancelled,
		},
		{
			name:   "update non-existent user fails",
			userID: "nonexistent",
			update: domain.SubscriptionUpdate{Status: domain.SubscriptionActive},
			setup:  func(r *fake.UserRepository) {},
			wantErr: domain.ErrUserNotFound,
		},
		{
			name:   "update to lifetime subscription",
			userID: "user1",
			update: domain.SubscriptionUpdate{
				Status: domain.SubscriptionLifetime,
			},
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{ID: "user1", Email: "user1@example.com"})
			},
			wantStatus: domain.SubscriptionLifetime,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userRepo := fake.NewUserRepository()
			entitlementRepo := fake.NewEntitlementRepository(userRepo)
			tt.setup(userRepo)

			svc := application.NewEntitlementService(entitlementRepo, userRepo, &config.Config{})
			err := svc.UpdateSubscription(ctx, tt.userID, tt.update)

			if tt.wantErr != nil {
				if err == nil {
					t.Errorf("UpdateSubscription() expected error, got nil")
					return
				}
				if err.Error() != tt.wantErr.Error() {
					t.Errorf("UpdateSubscription() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("UpdateSubscription() unexpected error: %v", err)
			}

			user, _ := userRepo.GetByID(ctx, tt.userID)
			if user.SubscriptionStatus != tt.wantStatus {
				t.Errorf("SubscriptionStatus = %v, want %v", user.SubscriptionStatus, tt.wantStatus)
			}
		})
	}
}

func TestEntitlementService_UpdateStatus(t *testing.T) {
	ctx := context.Background()
	future := time.Now().Add(30 * 24 * time.Hour)
	periodEnd := time.Now().Add(7 * 24 * time.Hour)

	tests := []struct {
		name             string
		userID           string
		status           string
		endsAt           *time.Time
		currentPeriodEnd *time.Time
		setup            func(*fake.UserRepository)
		wantErr          error
	}{
		{
			name:             "update status with all fields",
			userID:           "user1",
			status:           domain.SubscriptionActive,
			endsAt:           &future,
			currentPeriodEnd: &periodEnd,
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{ID: "user1", Email: "user1@example.com"})
			},
		},
		{
			name:   "update status with nil dates",
			userID: "user1",
			status: domain.SubscriptionCancelled,
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{ID: "user1", Email: "user1@example.com", SubscriptionStatus: domain.SubscriptionActive})
			},
		},
		{
			name:    "update non-existent user fails",
			userID:  "nonexistent",
			status:  domain.SubscriptionActive,
			setup:   func(r *fake.UserRepository) {},
			wantErr: domain.ErrUserNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userRepo := fake.NewUserRepository()
			entitlementRepo := fake.NewEntitlementRepository(userRepo)
			tt.setup(userRepo)

			svc := application.NewEntitlementService(entitlementRepo, userRepo, &config.Config{})
			err := svc.UpdateStatus(ctx, tt.userID, tt.status, tt.endsAt, tt.currentPeriodEnd)

			if tt.wantErr != nil {
				if err == nil || err.Error() != tt.wantErr.Error() {
					t.Errorf("UpdateStatus() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("UpdateStatus() unexpected error: %v", err)
			}

			user, _ := userRepo.GetByID(ctx, tt.userID)
			if user.SubscriptionStatus != tt.status {
				t.Errorf("SubscriptionStatus = %v, want %v", user.SubscriptionStatus, tt.status)
			}
		})
	}
}

func TestEntitlementService_UpdateFromProvider(t *testing.T) {
	ctx := context.Background()
	future := time.Now().Add(30 * 24 * time.Hour)

	tests := []struct {
		name    string
		userID  string
		info    domain.SubscriptionInfo
		setup   func(*fake.UserRepository)
		wantErr error
	}{
		{
			name:   "update from provider with full info",
			userID: "user1",
			info: domain.SubscriptionInfo{
				Status:           domain.SubscriptionActive,
				SubscriptionID:   "sub_provider_123",
				VariantID:        "var_monthly",
				EndsAt:           &future,
				CurrentPeriodEnd: &future,
			},
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{ID: "user1", Email: "user1@example.com"})
			},
		},
		{
			name:   "update from provider with trial",
			userID: "user1",
			info: domain.SubscriptionInfo{
				Status:      domain.SubscriptionTrialing,
				TrialEndsAt: &future,
			},
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{ID: "user1", Email: "user1@example.com"})
			},
		},
		{
			name:    "update non-existent user fails",
			userID:  "nonexistent",
			info:    domain.SubscriptionInfo{Status: domain.SubscriptionActive},
			setup:   func(r *fake.UserRepository) {},
			wantErr: domain.ErrUserNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userRepo := fake.NewUserRepository()
			entitlementRepo := fake.NewEntitlementRepository(userRepo)
			tt.setup(userRepo)

			svc := application.NewEntitlementService(entitlementRepo, userRepo, &config.Config{})
			err := svc.UpdateFromProvider(ctx, tt.userID, tt.info)

			if tt.wantErr != nil {
				if err == nil || err.Error() != tt.wantErr.Error() {
					t.Errorf("UpdateFromProvider() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("UpdateFromProvider() unexpected error: %v", err)
			}

			user, _ := userRepo.GetByID(ctx, tt.userID)
			if user.SubscriptionStatus != tt.info.Status {
				t.Errorf("SubscriptionStatus = %v, want %v", user.SubscriptionStatus, tt.info.Status)
			}
		})
	}
}

func TestEntitlementService_ResumeSubscription(t *testing.T) {
	ctx := context.Background()
	future := time.Now().Add(30 * 24 * time.Hour)
	variantID := "var_annual"

	tests := []struct {
		name             string
		userID           string
		status           string
		currentPeriodEnd *time.Time
		variantID        *string
		trialEnds        *time.Time
		setup            func(*fake.UserRepository)
		wantErr          error
	}{
		{
			name:             "resume cancelled subscription",
			userID:           "user1",
			status:           domain.SubscriptionActive,
			currentPeriodEnd: &future,
			variantID:        &variantID,
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{
					ID:                 "user1",
					Email:              "user1@example.com",
					SubscriptionStatus: domain.SubscriptionCancelled,
				})
			},
		},
		{
			name:      "resume with trial extension",
			userID:    "user1",
			status:    domain.SubscriptionTrialing,
			trialEnds: &future,
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{
					ID:                 "user1",
					Email:              "user1@example.com",
					SubscriptionStatus: domain.SubscriptionExpired,
				})
			},
		},
		{
			name:    "resume non-existent user fails",
			userID:  "nonexistent",
			status:  domain.SubscriptionActive,
			setup:   func(r *fake.UserRepository) {},
			wantErr: domain.ErrUserNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userRepo := fake.NewUserRepository()
			entitlementRepo := fake.NewEntitlementRepository(userRepo)
			tt.setup(userRepo)

			svc := application.NewEntitlementService(entitlementRepo, userRepo, &config.Config{})
			err := svc.ResumeSubscription(ctx, tt.userID, tt.status, tt.currentPeriodEnd, tt.variantID, tt.trialEnds)

			if tt.wantErr != nil {
				if err == nil || err.Error() != tt.wantErr.Error() {
					t.Errorf("ResumeSubscription() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("ResumeSubscription() unexpected error: %v", err)
			}

			user, _ := userRepo.GetByID(ctx, tt.userID)
			if user.SubscriptionStatus != tt.status {
				t.Errorf("SubscriptionStatus = %v, want %v", user.SubscriptionStatus, tt.status)
			}
		})
	}
}

func TestEntitlementService_GrantFoundingMember(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name    string
		userID  string
		setup   func(*fake.UserRepository)
		wantErr error
	}{
		{
			name:   "grant founding member status",
			userID: "user1",
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{ID: "user1", Email: "user1@example.com", IsFoundingMember: false})
			},
		},
		{
			name:   "grant to already founding member is idempotent",
			userID: "user1",
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{ID: "user1", Email: "user1@example.com", IsFoundingMember: true})
			},
		},
		{
			name:    "grant to non-existent user fails",
			userID:  "nonexistent",
			setup:   func(r *fake.UserRepository) {},
			wantErr: domain.ErrUserNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userRepo := fake.NewUserRepository()
			entitlementRepo := fake.NewEntitlementRepository(userRepo)
			tt.setup(userRepo)

			svc := application.NewEntitlementService(entitlementRepo, userRepo, &config.Config{})
			err := svc.GrantFoundingMember(ctx, tt.userID)

			if tt.wantErr != nil {
				if err == nil || err.Error() != tt.wantErr.Error() {
					t.Errorf("GrantFoundingMember() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("GrantFoundingMember() unexpected error: %v", err)
			}

			user, _ := userRepo.GetByID(ctx, tt.userID)
			if !user.IsFoundingMember {
				t.Error("Expected IsFoundingMember to be true")
			}
		})
	}
}

func TestEntitlementService_GrantBetaAccess(t *testing.T) {
	ctx := context.Background()
	future := time.Now().Add(90 * 24 * time.Hour)

	tests := []struct {
		name      string
		userID    string
		expiresAt time.Time
		setup     func(*fake.UserRepository)
		wantErr   error
	}{
		{
			name:      "grant beta access with expiry",
			userID:    "user1",
			expiresAt: future,
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{ID: "user1", Email: "user1@example.com"})
			},
		},
		{
			name:      "grant beta to user without other entitlements",
			userID:    "user1",
			expiresAt: future,
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{ID: "user1", Email: "user1@example.com", SubscriptionStatus: ""})
			},
		},
		{
			name:      "grant to non-existent user fails",
			userID:    "nonexistent",
			expiresAt: future,
			setup:     func(r *fake.UserRepository) {},
			wantErr:   domain.ErrUserNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userRepo := fake.NewUserRepository()
			entitlementRepo := fake.NewEntitlementRepository(userRepo)
			tt.setup(userRepo)

			svc := application.NewEntitlementService(entitlementRepo, userRepo, &config.Config{})
			err := svc.GrantBetaAccess(ctx, tt.userID, tt.expiresAt)

			if tt.wantErr != nil {
				if err == nil || err.Error() != tt.wantErr.Error() {
					t.Errorf("GrantBetaAccess() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("GrantBetaAccess() unexpected error: %v", err)
			}

			user, _ := userRepo.GetByID(ctx, tt.userID)
			if !user.HasBetaAccess {
				t.Error("Expected HasBetaAccess to be true")
			}
			if user.BetaExpiresAt == nil {
				t.Error("Expected BetaExpiresAt to be set")
			}
		})
	}
}

func TestEntitlementService_RevokeBetaAccess(t *testing.T) {
	ctx := context.Background()
	future := time.Now().Add(90 * 24 * time.Hour)

	tests := []struct {
		name    string
		userID  string
		setup   func(*fake.UserRepository)
		wantErr error
	}{
		{
			name:   "revoke beta access",
			userID: "user1",
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{
					ID:            "user1",
					Email:         "user1@example.com",
					HasBetaAccess: true,
					BetaExpiresAt: &future,
				})
			},
		},
		{
			name:   "revoke from user without beta is idempotent",
			userID: "user1",
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{ID: "user1", Email: "user1@example.com", HasBetaAccess: false})
			},
		},
		{
			name:    "revoke from non-existent user fails",
			userID:  "nonexistent",
			setup:   func(r *fake.UserRepository) {},
			wantErr: domain.ErrUserNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userRepo := fake.NewUserRepository()
			entitlementRepo := fake.NewEntitlementRepository(userRepo)
			tt.setup(userRepo)

			svc := application.NewEntitlementService(entitlementRepo, userRepo, &config.Config{})
			err := svc.RevokeBetaAccess(ctx, tt.userID)

			if tt.wantErr != nil {
				if err == nil || err.Error() != tt.wantErr.Error() {
					t.Errorf("RevokeBetaAccess() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("RevokeBetaAccess() unexpected error: %v", err)
			}

			user, _ := userRepo.GetByID(ctx, tt.userID)
			if user.HasBetaAccess {
				t.Error("Expected HasBetaAccess to be false")
			}
			if user.BetaExpiresAt != nil {
				t.Error("Expected BetaExpiresAt to be nil")
			}
		})
	}
}

func TestEntitlementService_SetCollaborationAccess(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name      string
		userID    string
		hasAccess bool
		setup     func(*fake.UserRepository)
		wantErr   error
	}{
		{
			name:      "grant collaboration access",
			userID:    "user1",
			hasAccess: true,
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{ID: "user1", Email: "user1@example.com", HasCollaborationAccess: false})
			},
		},
		{
			name:      "revoke collaboration access",
			userID:    "user1",
			hasAccess: false,
			setup: func(r *fake.UserRepository) {
				_, _ = r.Create(ctx, &domain.User{ID: "user1", Email: "user1@example.com", HasCollaborationAccess: true})
			},
		},
		{
			name:      "set on non-existent user fails",
			userID:    "nonexistent",
			hasAccess: true,
			setup:     func(r *fake.UserRepository) {},
			wantErr:   domain.ErrUserNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userRepo := fake.NewUserRepository()
			entitlementRepo := fake.NewEntitlementRepository(userRepo)
			tt.setup(userRepo)

			svc := application.NewEntitlementService(entitlementRepo, userRepo, &config.Config{})
			err := svc.SetCollaborationAccess(ctx, tt.userID, tt.hasAccess)

			if tt.wantErr != nil {
				if err == nil || err.Error() != tt.wantErr.Error() {
					t.Errorf("SetCollaborationAccess() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("SetCollaborationAccess() unexpected error: %v", err)
			}

			user, _ := userRepo.GetByID(ctx, tt.userID)
			if user.HasCollaborationAccess != tt.hasAccess {
				t.Errorf("HasCollaborationAccess = %v, want %v", user.HasCollaborationAccess, tt.hasAccess)
			}
		})
	}
}

func TestEntitlementService_SubscriptionTransitions(t *testing.T) {
	ctx := context.Background()
	future := time.Now().Add(30 * 24 * time.Hour)

	// Test realistic subscription state transitions
	tests := []struct {
		name         string
		initialState string
		transition   func(*application.EntitlementService, context.Context, string) error
		finalState   string
	}{
		{
			name:         "trial to active",
			initialState: domain.SubscriptionTrialing,
			transition: func(svc *application.EntitlementService, ctx context.Context, userID string) error {
				return svc.UpdateStatus(ctx, userID, domain.SubscriptionActive, &future, &future)
			},
			finalState: domain.SubscriptionActive,
		},
		{
			name:         "active to cancelled",
			initialState: domain.SubscriptionActive,
			transition: func(svc *application.EntitlementService, ctx context.Context, userID string) error {
				return svc.UpdateStatus(ctx, userID, domain.SubscriptionCancelled, &future, nil)
			},
			finalState: domain.SubscriptionCancelled,
		},
		{
			name:         "cancelled to active (resubscribe)",
			initialState: domain.SubscriptionCancelled,
			transition: func(svc *application.EntitlementService, ctx context.Context, userID string) error {
				return svc.ResumeSubscription(ctx, userID, domain.SubscriptionActive, &future, nil, nil)
			},
			finalState: domain.SubscriptionActive,
		},
		{
			name:         "expired to trialing (new trial)",
			initialState: domain.SubscriptionExpired,
			transition: func(svc *application.EntitlementService, ctx context.Context, userID string) error {
				return svc.UpdateStatus(ctx, userID, domain.SubscriptionTrialing, nil, nil)
			},
			finalState: domain.SubscriptionTrialing,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userRepo := fake.NewUserRepository()
			entitlementRepo := fake.NewEntitlementRepository(userRepo)
			_, _ = userRepo.Create(ctx, &domain.User{
				ID:                 "user1",
				Email:              "user1@example.com",
				SubscriptionStatus: tt.initialState,
			})

			svc := application.NewEntitlementService(entitlementRepo, userRepo, &config.Config{})
			err := tt.transition(svc, ctx, "user1")

			if err != nil {
				t.Fatalf("Transition error: %v", err)
			}

			user, _ := userRepo.GetByID(ctx, "user1")
			if user.SubscriptionStatus != tt.finalState {
				t.Errorf("Final state = %v, want %v", user.SubscriptionStatus, tt.finalState)
			}
		})
	}
}

func TestEntitlementService_MultipleEntitlements(t *testing.T) {
	ctx := context.Background()
	future := time.Now().Add(90 * 24 * time.Hour)

	userRepo := fake.NewUserRepository()
	entitlementRepo := fake.NewEntitlementRepository(userRepo)
	_, _ = userRepo.Create(ctx, &domain.User{ID: "user1", Email: "user1@example.com"})

	svc := application.NewEntitlementService(entitlementRepo, userRepo, &config.Config{})

	// Grant multiple entitlements
	if err := svc.GrantFoundingMember(ctx, "user1"); err != nil {
		t.Fatalf("GrantFoundingMember() error: %v", err)
	}
	if err := svc.GrantBetaAccess(ctx, "user1", future); err != nil {
		t.Fatalf("GrantBetaAccess() error: %v", err)
	}
	if err := svc.SetCollaborationAccess(ctx, "user1", true); err != nil {
		t.Fatalf("SetCollaborationAccess() error: %v", err)
	}

	// Verify all entitlements are set
	user, _ := userRepo.GetByID(ctx, "user1")
	if !user.IsFoundingMember {
		t.Error("Expected IsFoundingMember to be true")
	}
	if !user.HasBetaAccess {
		t.Error("Expected HasBetaAccess to be true")
	}
	if !user.HasCollaborationAccess {
		t.Error("Expected HasCollaborationAccess to be true")
	}

	// User should have workspace access
	if !svc.HasWorkspaceAccess(user) {
		t.Error("Expected HasWorkspaceAccess to be true with multiple entitlements")
	}

	// Revoke beta but should still have access via founding member
	if err := svc.RevokeBetaAccess(ctx, "user1"); err != nil {
		t.Fatalf("RevokeBetaAccess() error: %v", err)
	}
	user, _ = userRepo.GetByID(ctx, "user1")
	if !svc.HasWorkspaceAccess(user) {
		t.Error("Expected HasWorkspaceAccess to still be true (founding member)")
	}
}
