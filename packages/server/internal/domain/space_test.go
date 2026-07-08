package domain_test

import (
	"errors"
	"testing"
	"time"

	"budgero-server/internal/domain"
)

func TestSpaceInvite_IsExpired(t *testing.T) {
	now := time.Now()
	future := now.Add(24 * time.Hour)
	past := now.Add(-24 * time.Hour)

	tests := []struct {
		name   string
		invite *domain.SpaceInvite
		want   bool
	}{
		{"nil invite", nil, false},
		{"no expiry set", &domain.SpaceInvite{ExpiresAt: nil}, false},
		{"not expired", &domain.SpaceInvite{ExpiresAt: &future}, false},
		{"expired", &domain.SpaceInvite{ExpiresAt: &past}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.invite.IsExpired(); got != tt.want {
				t.Errorf("IsExpired() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSpaceInvite_IsRedeemed(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name   string
		invite *domain.SpaceInvite
		want   bool
	}{
		{"nil invite", nil, false},
		{"not redeemed", &domain.SpaceInvite{RedeemedAt: nil}, false},
		{"redeemed", &domain.SpaceInvite{RedeemedAt: &now}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.invite.IsRedeemed(); got != tt.want {
				t.Errorf("IsRedeemed() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSpaceInvite_CanBeRedeemed(t *testing.T) {
	now := time.Now()
	future := now.Add(24 * time.Hour)
	past := now.Add(-24 * time.Hour)

	tests := []struct {
		name    string
		invite  *domain.SpaceInvite
		wantErr error
	}{
		{"nil invite", nil, domain.ErrInviteNotFound},
		{"valid invite", &domain.SpaceInvite{ExpiresAt: &future}, nil},
		{"expired invite", &domain.SpaceInvite{ExpiresAt: &past}, domain.ErrInviteExpired},
		{"already redeemed", &domain.SpaceInvite{ExpiresAt: &future, RedeemedAt: &now}, domain.ErrInviteAlreadyUsed},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.invite.CanBeRedeemed()
			if !errors.Is(err, tt.wantErr) {
				t.Errorf("CanBeRedeemed() error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}
