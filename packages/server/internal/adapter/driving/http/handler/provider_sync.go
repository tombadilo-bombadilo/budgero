package handler

import (
	"context"
	"fmt"
	"strings"
	"time"

	"budgero-server/internal/adapter/driven/lemonsqueezy"
	"budgero-server/internal/domain"

	clerk "github.com/clerk/clerk-sdk-go/v2"
	clerkuser "github.com/clerk/clerk-sdk-go/v2/user"
	"github.com/rs/zerolog/log"
)

// ClerkSyncResult captures the outcome of syncing users from Clerk to local DB.
type ClerkSyncResult struct {
	Synced   int `json:"synced"`
	Created  int `json:"created"`
	Migrated int `json:"migrated"`
	Updated  int `json:"updated"`
	Deleted  int `json:"deleted"`
}

// LemonSqueezySyncResult captures the outcome of syncing subscription state.
type LemonSqueezySyncResult struct {
	Checked int `json:"checked"`
	Updated int `json:"updated"`
	Failed  int `json:"failed"`
}

func (h *Handlers) syncClerkUsers(ctx context.Context) (ClerkSyncResult, error) {
	var res ClerkSyncResult

	if h.cfg.Auth.ClerkSecretKey == "" {
		return res, fmt.Errorf("CLERK_SECRET_KEY not configured")
	}
	clerk.SetKey(h.cfg.Auth.ClerkSecretKey)

	page := int64(0)
	limit := int64(100)
	clerkIDs := make(map[string]struct{})

	for {
		params := &clerkuser.ListParams{}
		params.Limit = clerk.Int64(limit)
		params.Offset = clerk.Int64(page * limit)
		list, err := clerkuser.List(ctx, params)
		if err != nil {
			return res, fmt.Errorf("failed to list clerk users: %w", err)
		}
		if len(list.Users) == 0 {
			break
		}
		for _, cu := range list.Users {
			res.Synced++
			clerkIDs[cu.ID] = struct{}{}
			email := extractClerkEmail(cu)
			name := extractClerkName(cu)

			// Try by ID
			if existing, err := h.services.User.GetByID(ctx, cu.ID); err == nil && existing != nil {
				if strings.TrimSpace(existing.Email) != strings.TrimSpace(email) || strings.TrimSpace(existing.Name) != strings.TrimSpace(name) {
					if uerr := h.services.User.Update(ctx, cu.ID, name, email); uerr == nil {
						res.Updated++
					}
				}
				continue
			}
			// Try by email and migrate
			if byEmail, err := h.services.User.GetByEmail(ctx, email); err == nil && byEmail != nil {
				if byEmail.ID != cu.ID {
					if merr := h.services.Admin.MigrateUserID(ctx, byEmail.ID, cu.ID, name, email); merr == nil {
						res.Migrated++
						continue
					}
				}
			}
			// Create
			if _, cerr := h.services.User.Create(ctx, cu.ID, name, email); cerr == nil {
				res.Created++
			}
		}
		page++
	}

	// Delete local users that no longer exist in Clerk (orphan cleanup).
	// Only user_ prefixed IDs are Clerk-managed; skip self-host or manual accounts.
	localUsers, err := h.services.Admin.ListUsers(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to list local users for orphan cleanup; skipping")
	} else {
		for i := range localUsers {
			if !strings.HasPrefix(localUsers[i].ID, "user_") {
				continue
			}
			if _, exists := clerkIDs[localUsers[i].ID]; exists {
				continue
			}
			if _, derr := h.services.User.DeleteWithSpaces(ctx, localUsers[i].ID); derr != nil {
				log.Warn().Err(derr).Str("user_id", localUsers[i].ID).Msg("Failed to delete orphaned Clerk user")
				continue
			}
			res.Deleted++
			log.Warn().Str("user_id", localUsers[i].ID).Str("email", localUsers[i].Email).Msg("Deleted orphaned Clerk user not found in provider")
		}
	}

	// Clear any dangling primary_space_id references left after orphan deletion.
	if err := h.services.User.ClearDanglingPrimarySpaceIDs(ctx); err != nil {
		log.Warn().Err(err).Msg("Failed to clear dangling primary_space_id references")
	}

	return res, nil
}

func (h *Handlers) syncLemonSqueezySubscriptions(ctx context.Context) (LemonSqueezySyncResult, error) {
	var res LemonSqueezySyncResult

	if !h.subscriptionSvc.IsEnabled() {
		return res, fmt.Errorf("subscriptions not configured")
	}

	ls := h.subscriptionSvc.Client()
	users, err := h.services.Admin.ListUsersWithSubscription(ctx)
	if err != nil {
		return res, fmt.Errorf("failed to query users: %w", err)
	}

	for _, u := range users {
		res.Checked++

		sd, err := ls.GetSubscription(u.SubscriptionID)
		if err != nil {
			res.Failed++
			continue
		}

		info := domain.SubscriptionInfo{
			Status:         lemonsqueezy.MapLemonSqueezyStatus(sd.Status),
			SubscriptionID: sd.ID,
			VariantID:      sd.VariantID,
		}

		info.EndsAt = parseRFC3339Time(sd.EndsAt)
		info.TrialEndsAt = parseRFC3339Time(sd.TrialEndsAt)
		info.CurrentPeriodEnd = parseRFC3339Time(sd.RenewsAt)

		if err := h.services.Entitlement.UpdateFromProvider(ctx, u.ID, info); err != nil {
			res.Failed++
			continue
		}
		res.Updated++
	}

	return res, nil
}

// StartProviderSyncLoop starts a background reconciliation loop for external providers.
// It is intended for SaaS deployments and keeps provider data fresh without blocking request paths.
func (h *Handlers) StartProviderSyncLoop(ctx context.Context, interval time.Duration) {
	if h.selfHostMode {
		return
	}
	if interval <= 0 {
		interval = time.Hour
	}

	log.Info().Dur("interval", interval).Msg("Starting background provider sync loop")

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Info().Msg("Stopping background provider sync loop")
				return
			case <-ticker.C:
				cycleStart := time.Now()
				cycleCtx, cancel := context.WithTimeout(ctx, 30*time.Minute)

				clerkRes, clerkErr := h.syncClerkUsers(cycleCtx)
				if clerkErr != nil {
					log.Warn().Err(clerkErr).Msg("Background Clerk sync failed")
				} else {
					log.Info().
						Int("synced", clerkRes.Synced).
						Int("created", clerkRes.Created).
						Int("migrated", clerkRes.Migrated).
						Int("updated", clerkRes.Updated).
						Int("deleted", clerkRes.Deleted).
						Msg("Background Clerk sync completed")
				}

				lsRes, lsErr := h.syncLemonSqueezySubscriptions(cycleCtx)
				if lsErr != nil {
					log.Warn().Err(lsErr).Msg("Background LemonSqueezy sync failed")
				} else {
					log.Info().
						Int("checked", lsRes.Checked).
						Int("updated", lsRes.Updated).
						Int("failed", lsRes.Failed).
						Msg("Background LemonSqueezy sync completed")
				}

				cancel()

				log.Info().
					Dur("duration", time.Since(cycleStart)).
					Msg("Background provider sync cycle finished")
			}
		}
	}()
}
