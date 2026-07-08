package domain_test

import (
	"testing"
	"time"

	"budgero-server/internal/domain"
)

func TestUser_HasActiveBeta(t *testing.T) {
	now := time.Now()
	future := now.Add(24 * time.Hour)
	past := now.Add(-24 * time.Hour)

	tests := []struct {
		name string
		user *domain.User
		want bool
	}{
		{"nil user", nil, false},
		{"no beta access", &domain.User{HasBetaAccess: false}, false},
		{"beta with no expiry", &domain.User{HasBetaAccess: true, BetaExpiresAt: nil}, true},
		{"beta not expired", &domain.User{HasBetaAccess: true, BetaExpiresAt: &future}, true},
		{"beta expired", &domain.User{HasBetaAccess: true, BetaExpiresAt: &past}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.user.HasActiveBeta(); got != tt.want {
				t.Errorf("HasActiveBeta() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestUser_IsBetaExpired(t *testing.T) {
	now := time.Now()
	future := now.Add(24 * time.Hour)
	past := now.Add(-24 * time.Hour)

	tests := []struct {
		name string
		user *domain.User
		want bool
	}{
		{"nil user", nil, false},
		{"no beta access", &domain.User{HasBetaAccess: false}, false},
		{"beta with no expiry", &domain.User{HasBetaAccess: true, BetaExpiresAt: nil}, false},
		{"beta not expired", &domain.User{HasBetaAccess: true, BetaExpiresAt: &future}, false},
		{"beta expired", &domain.User{HasBetaAccess: true, BetaExpiresAt: &past}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.user.IsBetaExpired(); got != tt.want {
				t.Errorf("IsBetaExpired() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestUser_HasActiveTrial(t *testing.T) {
	now := time.Now()
	future := now.Add(24 * time.Hour)
	past := now.Add(-24 * time.Hour)

	tests := []struct {
		name string
		user *domain.User
		want bool
	}{
		{"nil user", nil, false},
		{"no trial", &domain.User{TrialEndsAt: nil}, false},
		{"trial active", &domain.User{TrialEndsAt: &future}, true},
		{"trial expired", &domain.User{TrialEndsAt: &past}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.user.HasActiveTrial(); got != tt.want {
				t.Errorf("HasActiveTrial() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestUser_HasActiveSubscription(t *testing.T) {
	now := time.Now()
	future := now.Add(24 * time.Hour)
	past := now.Add(-24 * time.Hour)

	tests := []struct {
		name string
		user *domain.User
		want bool
	}{
		{"nil user", nil, false},
		{"active subscription", &domain.User{SubscriptionStatus: domain.SubscriptionActive}, true},
		{"on trial", &domain.User{SubscriptionStatus: domain.SubscriptionOnTrial}, true},
		{"cancelled but not ended", &domain.User{SubscriptionStatus: domain.SubscriptionCancelled, SubscriptionEndsAt: &future}, true},
		{"cancelled and ended", &domain.User{SubscriptionStatus: domain.SubscriptionCancelled, SubscriptionEndsAt: &past}, false},
		{"expired", &domain.User{SubscriptionStatus: domain.SubscriptionExpired}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.user.HasActiveSubscription(); got != tt.want {
				t.Errorf("HasActiveSubscription() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestUser_HasFullWorkspaceAccess(t *testing.T) {
	future := time.Now().Add(24 * time.Hour)

	tests := []struct {
		name string
		user *domain.User
		want bool
	}{
		{"nil user", nil, false},
		{"founding member", &domain.User{IsFoundingMember: true}, true},
		{"collaboration access", &domain.User{HasCollaborationAccess: true}, true},
		{"active beta", &domain.User{HasBetaAccess: true, BetaExpiresAt: &future}, true},
		{"active subscription", &domain.User{SubscriptionStatus: domain.SubscriptionActive}, true},
		{"active trial", &domain.User{TrialEndsAt: &future}, true},
		{"no access", &domain.User{}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.user.HasFullWorkspaceAccess(); got != tt.want {
				t.Errorf("HasFullWorkspaceAccess() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestUser_HasOwnerWorkspaceSubscription(t *testing.T) {
	future := time.Now().Add(24 * time.Hour)
	past := time.Now().Add(-24 * time.Hour)

	tests := []struct {
		name string
		user *domain.User
		want bool
	}{
		{"nil user", nil, false},
		{"active subscription", &domain.User{SubscriptionStatus: domain.SubscriptionActive}, true},
		{
			"trialing with active trial",
			&domain.User{SubscriptionStatus: domain.SubscriptionTrialing, TrialEndsAt: &future},
			true,
		},
		{
			"on_trial with expired trial",
			&domain.User{SubscriptionStatus: domain.SubscriptionOnTrial, TrialEndsAt: &past},
			false,
		},
		{
			"founding member without subscription",
			&domain.User{IsFoundingMember: true, SubscriptionStatus: "inactive"},
			true,
		},
		{
			"beta user without subscription",
			&domain.User{HasBetaAccess: true, BetaExpiresAt: &future, SubscriptionStatus: "inactive"},
			true,
		},
		{
			"lifetime subscription",
			&domain.User{SubscriptionStatus: domain.SubscriptionLifetime},
			true,
		},
		{
			"inactive collaborator",
			&domain.User{HasCollaborationAccess: true, SubscriptionStatus: "inactive"},
			false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.user.HasOwnerWorkspaceSubscription(); got != tt.want {
				t.Errorf("HasOwnerWorkspaceSubscription() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestUser_EffectiveSubscriptionStatus(t *testing.T) {
	now := time.Now()
	future := now.Add(24 * time.Hour)
	past := now.Add(-24 * time.Hour)

	tests := []struct {
		name string
		user *domain.User
		want string
	}{
		{
			name: "active trial stays trialing",
			user: &domain.User{
				SubscriptionStatus: domain.SubscriptionTrialing,
				TrialEndsAt:        &future,
			},
			want: domain.SubscriptionTrialing,
		},
		{
			name: "expired trial becomes expired",
			user: &domain.User{
				SubscriptionStatus: domain.SubscriptionTrialing,
				TrialEndsAt:        &past,
			},
			want: domain.SubscriptionExpired,
		},
		{
			name: "provider on_trial is normalized",
			user: &domain.User{
				SubscriptionStatus: domain.SubscriptionOnTrial,
				TrialEndsAt:        &future,
			},
			want: domain.SubscriptionTrialing,
		},
		{
			name: "cancelled after end becomes expired",
			user: &domain.User{
				SubscriptionStatus: domain.SubscriptionCancelled,
				SubscriptionEndsAt: &past,
			},
			want: domain.SubscriptionExpired,
		},
		{
			name: "past due after period becomes expired",
			user: &domain.User{
				SubscriptionStatus: domain.SubscriptionPastDue,
				CurrentPeriodEnd:   &past,
			},
			want: domain.SubscriptionExpired,
		},
		{
			name: "empty status becomes inactive",
			user: &domain.User{},
			want: domain.SubscriptionInactive,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.user.EffectiveSubscriptionStatus(); got != tt.want {
				t.Errorf("EffectiveSubscriptionStatus() = %v, want %v", got, tt.want)
			}
		})
	}
}
