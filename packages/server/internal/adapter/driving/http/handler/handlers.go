// Package handler provides HTTP request handlers for the API.
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"budgero-server/internal/adapter/driven/lemonsqueezy"
	synchub "budgero-server/internal/adapter/driving/http/websocket"
	"budgero-server/internal/application"
	"budgero-server/internal/application/email"
	"budgero-server/internal/config"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driving"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"
)

// Options configures the handlers.
type Options struct {
	SelfHost bool
	Config   *config.Config
	// Email is the transactional email service. Optional — nil when email is
	// disabled (self-host, missing RESEND_API_KEY). When present, it's wired
	// into ClerkSync so the welcome email fires on user creation.
	Email *email.Service
	// LatestVersion resolves the latest published release. Optional — nil
	// (update check disabled, APP_LATEST_VERSION pinned, tests) makes
	// /version/latest fall back to the build version.
	LatestVersion LatestVersionSource
}

// Handlers contains HTTP request handlers for the API.
type Handlers struct {
	cfg                  *config.Config
	services             *application.Services
	usecases             *application.Usecases
	syncHub              *synchub.Hub
	subscriptionSvc      *SubscriptionService
	allowedVariantIDs    map[string]struct{}
	legacyUserIDs        map[string]struct{}
	legacyVariantIDs     map[string]struct{}
	subscriptionsEnabled bool
	selfHostMode         bool
	latestVersion        LatestVersionSource
}

// NewHandlers creates a new Handlers instance.
func NewHandlers(services *application.Services, syncHub *synchub.Hub, opts Options) *Handlers {
	subscriptionSvc := NewSubscriptionService(services.Entitlement, services.TrialRewards, opts.Config, !opts.SelfHost)
	usecases := application.NewUsecases(
		services.User,
		services.Space,
		services.Credential,
		services.Entitlement,
		services.Push,
		services.Admin,
		opts.Config,
	)
	if opts.Email != nil {
		usecases.ClerkSync.SetEmailService(opts.Email)
	}

	var variantIDs map[string]struct{}
	var legacyUsers map[string]struct{}
	var legacyVariants map[string]struct{}
	if opts.Config != nil {
		variantIDs = parseVariantIDList(opts.Config.LemonSqueezy.VisibleVariantIDs)
		legacyUsers = parseVariantIDList(opts.Config.LemonSqueezy.LegacyUserIDs)
		legacyVariants = parseVariantIDList(opts.Config.LemonSqueezy.LegacyVariantIDs)
	}

	return &Handlers{
		cfg:                  opts.Config,
		services:             services,
		usecases:             usecases,
		syncHub:              syncHub,
		subscriptionSvc:      subscriptionSvc,
		allowedVariantIDs:    variantIDs,
		legacyUserIDs:        legacyUsers,
		legacyVariantIDs:     legacyVariants,
		subscriptionsEnabled: !opts.SelfHost,
		selfHostMode:         opts.SelfHost,
		latestVersion:        opts.LatestVersion,
	}
}

// parseVariantIDList builds a lookup map from a slice of variant IDs.
func parseVariantIDList(ids []string) map[string]struct{} {
	if len(ids) == 0 {
		return nil
	}

	allowed := make(map[string]struct{})
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		allowed[id] = struct{}{}
	}

	if len(allowed) == 0 {
		return nil
	}

	return allowed
}

func (h *Handlers) ensureSelfHostMode() error {
	if h.selfHostMode {
		return nil
	}
	return echo.NewHTTPError(http.StatusNotFound, "endpoint unavailable")
}

// parseRFC3339Time safely parses an optional RFC3339 time string pointer.
func parseRFC3339Time(s *string) *time.Time {
	if s == nil || *s == "" {
		return nil
	}
	if t, err := time.Parse(time.RFC3339, *s); err == nil {
		return &t
	}
	return nil
}

// mapServiceError maps service-layer errors to HTTP errors.
func mapServiceError(err error) error {
	if err == nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "unknown error")
	}
	if errors.Is(err, domain.ErrSpaceAccessDenied) {
		return echo.NewHTTPError(http.StatusForbidden, "space access denied")
	}
	if errors.Is(err, domain.ErrSpaceNotFound) {
		return echo.NewHTTPError(http.StatusNotFound, "space not found")
	}
	if errors.Is(err, domain.ErrSpaceMemberLimitReached) {
		return echo.NewHTTPError(http.StatusConflict, "collaborator seat limit reached")
	}
	if errors.Is(err, domain.ErrInviteNotFound) {
		return echo.NewHTTPError(http.StatusNotFound, "invite not found")
	}
	if errors.Is(err, domain.ErrInviteExpired) {
		return echo.NewHTTPError(http.StatusGone, "invite expired")
	}
	if errors.Is(err, domain.ErrInviteMissingBundle) {
		return echo.NewHTTPError(http.StatusConflict, "invite bundle missing")
	}
	if errors.Is(err, domain.ErrCollaborationRestricted) {
		return echo.NewHTTPError(http.StatusForbidden, "collaboration access restricted")
	}
	if errors.Is(err, domain.ErrUserNotFound) {
		return echo.NewHTTPError(http.StatusNotFound, "user not found")
	}
	// Don't leak raw internal/driver error strings to clients; log and return generic.
	log.Error().Err(err).Msg("unmapped service error")
	return echo.NewHTTPError(http.StatusInternalServerError, "internal server error")
}

// SubscriptionService handles subscription-related operations.
type SubscriptionService struct {
	entitlements         driving.EntitlementService
	trialRewards         driving.TrialRewardsService
	cfg                  *config.Config
	client               *lemonsqueezy.Client
	cache                *lemonsqueezy.ProductCache
	subscriptionsEnabled bool
}

// RevenueStats contains MRR and total revenue data.
type RevenueStats struct {
	MRR          int `json:"mrr"`
	TotalRevenue int `json:"totalRevenue"`
}

// NewSubscriptionService creates a new SubscriptionService.
func NewSubscriptionService(entitlements driving.EntitlementService, trialRewards driving.TrialRewardsService, cfg *config.Config, subscriptionsEnabled bool) *SubscriptionService {
	if !subscriptionsEnabled {
		return &SubscriptionService{
			entitlements:         entitlements,
			trialRewards:         trialRewards,
			cfg:                  cfg,
			subscriptionsEnabled: false,
		}
	}

	client := lemonsqueezy.NewClientWithConfig(cfg)
	cache := lemonsqueezy.NewProductCache(client)

	svc := &SubscriptionService{
		entitlements:         entitlements,
		trialRewards:         trialRewards,
		cfg:                  cfg,
		client:               client,
		cache:                cache,
		subscriptionsEnabled: true,
	}

	// Prefetch products on startup (non-blocking)
	go func() {
		log.Info().Msg("Prefetching LemonSqueezy products...")
		if err := cache.Prefetch(); err != nil {
			log.Error().Err(err).Msg("Failed to prefetch products (will retry on first request)")
		} else {
			log.Info().Msg("Successfully prefetched LemonSqueezy products")
		}
	}()

	return svc
}

// IsEnabled returns whether subscription management is enabled.
func (s *SubscriptionService) IsEnabled() bool {
	return s.subscriptionsEnabled
}

// Client returns the underlying LemonSqueezy client.
func (s *SubscriptionService) Client() *lemonsqueezy.Client {
	return s.client
}

// Cache returns the product cache.
func (s *SubscriptionService) Cache() *lemonsqueezy.ProductCache {
	return s.cache
}

// GetRevenueStats fetches MRR and total revenue from LemonSqueezy customers.
func (s *SubscriptionService) GetRevenueStats() (*RevenueStats, error) {
	if !s.subscriptionsEnabled {
		return &RevenueStats{}, nil
	}

	customers, err := s.client.GetCustomers()
	if err != nil {
		return nil, err
	}

	stats := &RevenueStats{}
	for _, customer := range customers {
		stats.MRR += customer.Attributes.MonthlyRecurringRevenueCents
		stats.TotalRevenue += customer.Attributes.TotalRevenueCents
	}

	return stats, nil
}

// GetPortalURL returns the customer portal URL for a user.
func (s *SubscriptionService) GetPortalURL(user *domain.User) string {
	if !s.subscriptionsEnabled || s.client == nil || user.CustomerID == nil || *user.CustomerID == "" {
		return ""
	}
	url, err := s.client.GetCustomerPortalURL(*user.CustomerID)
	if err != nil {
		log.Error().Err(err).Str("customer_id", *user.CustomerID).Msg("Failed to get portal URL")
		return ""
	}
	return url
}

// CreateCheckout creates a new checkout session for a user.
func (s *SubscriptionService) CreateCheckout(userID, userEmail, variantID string) (string, error) {
	if !s.subscriptionsEnabled {
		return "", errors.New("subscriptions are not enabled")
	}
	return s.client.CreateCheckout(userID, userEmail, variantID)
}

// CreateCheckoutWithDiscount creates a checkout with a trial-reward code
// pre-applied. The caller is expected to have validated the code's
// ownership and validity.
func (s *SubscriptionService) CreateCheckoutWithDiscount(userID, userEmail, variantID, discountCode string) (string, error) {
	if !s.subscriptionsEnabled {
		return "", errors.New("subscriptions are not enabled")
	}
	if discountCode == "" {
		return s.client.CreateCheckout(userID, userEmail, variantID)
	}
	return s.client.CreateCheckoutWithDiscount(userID, userEmail, variantID, discountCode)
}

// GetSubscription fetches subscription details from LemonSqueezy.
func (s *SubscriptionService) GetSubscription(subscriptionID string) (*lemonsqueezy.SubscriptionDetails, error) {
	if !s.subscriptionsEnabled {
		return nil, errors.New("subscriptions are not enabled")
	}
	return s.client.GetSubscription(subscriptionID)
}

// GetCustomerPortalURL gets a customer portal URL.
func (s *SubscriptionService) GetCustomerPortalURL(subscriptionID, customerID *string) (string, error) {
	if !s.subscriptionsEnabled {
		return "", errors.New("subscriptions are not enabled")
	}

	// Try subscription ID first
	if subscriptionID != nil && *subscriptionID != "" {
		url, err := s.client.GetCustomerPortalURLFromSubscription(*subscriptionID)
		if err == nil {
			return url, nil
		}
	}

	// Fall back to customer ID
	if customerID != nil && *customerID != "" {
		return s.client.GetCustomerPortalURL(*customerID)
	}

	return "", errors.New("no subscription or customer ID available")
}

// CancelSubscription cancels a subscription.
func (s *SubscriptionService) CancelSubscription(ctx context.Context, userID, subscriptionID string) error {
	if !s.subscriptionsEnabled {
		return errors.New("subscriptions are not enabled")
	}

	if err := s.client.CancelSubscription(subscriptionID); err != nil {
		return err
	}

	// Update local status
	return s.entitlements.UpdateStatus(ctx, userID, lemonsqueezy.StatusCancelled, nil, nil)
}

// ResumeSubscription resumes a cancelled subscription.
func (s *SubscriptionService) ResumeSubscription(ctx context.Context, userID, subscriptionID string, currentTrialEndsAt *time.Time) error {
	if !s.subscriptionsEnabled {
		return errors.New("subscriptions are not enabled")
	}

	if err := s.client.ResumeSubscription(subscriptionID); err != nil {
		return err
	}

	// Fetch the updated subscription details
	subDetails, err := s.client.GetSubscription(subscriptionID)
	if err != nil {
		// Still update status even if we can't get the details
		var resumedStatus string
		if currentTrialEndsAt != nil && currentTrialEndsAt.After(time.Now()) {
			resumedStatus = lemonsqueezy.StatusTrialing
		} else {
			resumedStatus = lemonsqueezy.StatusActive
		}
		return s.entitlements.UpdateStatus(ctx, userID, resumedStatus, nil, nil)
	}

	// Parse dates
	var currentPeriodEnd *time.Time
	if subDetails.CurrentPeriodEnd != nil && *subDetails.CurrentPeriodEnd != "" {
		if t, parseErr := time.Parse(time.RFC3339, *subDetails.CurrentPeriodEnd); parseErr == nil {
			currentPeriodEnd = &t
		}
	}

	var trialEndsAt *time.Time
	if subDetails.TrialEndsAt != nil && *subDetails.TrialEndsAt != "" {
		if t, parseErr := time.Parse(time.RFC3339, *subDetails.TrialEndsAt); parseErr == nil {
			trialEndsAt = &t
		}
	}

	variantID := subDetails.VariantID
	return s.entitlements.ResumeSubscription(ctx, userID, subDetails.Status, currentPeriodEnd, &variantID, trialEndsAt)
}

// UpdatePlan changes the subscription to a different plan.
func (s *SubscriptionService) UpdatePlan(ctx context.Context, userID, subscriptionID, newVariantID, currentStatus string, currentSubID, currentCustomerID *string, currentEnds, currentTrialEnds *time.Time) error {
	if !s.subscriptionsEnabled {
		return errors.New("subscriptions are not enabled")
	}

	if err := s.client.UpdateSubscriptionPlan(subscriptionID, newVariantID); err != nil {
		return err
	}

	// Update local variant ID
	return s.entitlements.UpdateSubscription(ctx, userID, domain.SubscriptionUpdate{
		Status:           currentStatus,
		SubscriptionID:   currentSubID,
		CustomerID:       currentCustomerID,
		VariantID:        &newVariantID,
		SubscriptionEnds: currentEnds,
		TrialEnds:        currentTrialEnds,
	})
}

// GetInvoices retrieves all invoices for a subscription.
func (s *SubscriptionService) GetInvoices(subscriptionID string) ([]lemonsqueezy.Invoice, error) {
	if !s.subscriptionsEnabled {
		return nil, errors.New("subscriptions are not enabled")
	}
	return s.client.GetSubscriptionInvoices(subscriptionID)
}

// GetVariants returns cached variants.
func (s *SubscriptionService) GetVariants() ([]lemonsqueezy.Variant, error) {
	if !s.subscriptionsEnabled {
		return nil, errors.New("subscriptions are not enabled")
	}
	return s.cache.GetVariants()
}

// HandleWebhook processes incoming webhook events from LemonSqueezy.
func (s *SubscriptionService) HandleWebhook(c echo.Context) error {
	if !s.subscriptionsEnabled {
		return echo.NewHTTPError(http.StatusNotFound, "subscriptions are disabled")
	}

	body, err := io.ReadAll(c.Request().Body)
	if err != nil {
		log.Error().Err(err).Msg("Failed to read webhook body")
		return echo.NewHTTPError(http.StatusBadRequest, "Failed to read request body")
	}

	// Verify signature
	signature := c.Request().Header.Get("X-Signature")
	if signature == "" {
		log.Warn().Msg("Missing webhook signature")
		return echo.NewHTTPError(http.StatusUnauthorized, "Missing signature")
	}

	if !s.client.VerifyWebhookSignature(body, signature) {
		log.Warn().Msg("Invalid webhook signature")
		return echo.NewHTTPError(http.StatusUnauthorized, "Invalid signature")
	}

	// Parse the event
	var event lemonsqueezy.WebhookEvent
	if err = json.Unmarshal(body, &event); err != nil {
		log.Error().Err(err).Msg("Failed to parse webhook event")
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid event format")
	}

	log.Info().
		Str("event", event.Meta.EventName).
		Str("user_id", event.Meta.CustomData.UserID).
		Str("subscription_id", event.Data.ID).
		Str("status", event.Data.Attributes.Status).
		Msg("Processing webhook event")

	ctx := c.Request().Context()

	// Process based on event type
	switch event.Meta.EventName {
	case "subscription_created":
		err = s.handleSubscriptionCreated(ctx, &event)
	case "subscription_updated":
		err = s.handleSubscriptionUpdated(ctx, &event)
	case "subscription_cancelled":
		err = s.handleSubscriptionCancelled(ctx, &event)
	case "subscription_resumed":
		err = s.handleSubscriptionResumed(ctx, &event)
	case "subscription_expired":
		err = s.handleSubscriptionExpired(ctx, &event)
	case "subscription_payment_failed":
		err = s.handlePaymentFailed(ctx, &event)
	case "order_created":
		err = s.handleOrderCreated(ctx, &event)
	default:
		log.Info().Str("event", event.Meta.EventName).Msg("Unhandled webhook event type")
	}

	if err != nil {
		log.Error().Err(err).Str("event", event.Meta.EventName).Msg("Failed to process webhook event")
	}

	return c.JSON(http.StatusOK, map[string]bool{"success": true})
}

func (s *SubscriptionService) handleSubscriptionCreated(ctx context.Context, event *lemonsqueezy.WebhookEvent) error {
	userID := event.Meta.CustomData.UserID
	if userID == "" {
		return errors.New("missing user_id in custom data")
	}

	var endsAt *time.Time
	var trialEndsAt *time.Time

	if event.Data.Attributes.TrialEndsAt != nil {
		if t, err := time.Parse(time.RFC3339, *event.Data.Attributes.TrialEndsAt); err == nil {
			trialEndsAt = &t
		}
	}

	if event.Data.Attributes.RenewsAt != nil {
		if t, err := time.Parse(time.RFC3339, *event.Data.Attributes.RenewsAt); err == nil {
			endsAt = &t
		}
	}

	status := lemonsqueezy.MapLemonSqueezyStatus(event.Data.Attributes.Status)
	subID := event.Data.ID
	customerID := fmt.Sprintf("%d", event.Data.Attributes.CustomerID)
	variantID := fmt.Sprintf("%d", event.Data.Attributes.VariantID)

	if err := s.entitlements.UpdateSubscription(ctx, userID, domain.SubscriptionUpdate{
		Status:           status,
		SubscriptionID:   &subID,
		CustomerID:       &customerID,
		VariantID:        &variantID,
		SubscriptionEnds: endsAt,
		CurrentPeriodEnd: endsAt,
		TrialEnds:        trialEndsAt,
	}); err != nil {
		return err
	}

	// Stamp first-conversion timestamp for analytics. Idempotent at the
	// repo layer (only writes when subscribed_at IS NULL) so renewals don't
	// bump it. Failures are non-fatal — analytics gap, not a user-blocker.
	if err := s.entitlements.MarkSubscribedIfFirstTime(ctx, userID, time.Now().UTC()); err != nil {
		log.Warn().Err(err).Str("user_id", userID).
			Msg("failed to stamp first-subscribed timestamp")
	}

	// If a trial-reward code was applied at checkout, mark it redeemed. The
	// code travels through checkout custom_data so we don't need to query LS
	// for discount redemptions. Failures are non-fatal — subscription is
	// already created; lacking the redemption mark is recoverable later.
	if trialCode := event.Meta.CustomData.TrialCode; trialCode != "" && s.trialRewards != nil {
		if err := s.trialRewards.MarkRedeemed(ctx, trialCode, subID, time.Now()); err != nil {
			log.Warn().Err(err).
				Str("user_id", userID).
				Str("trial_code", trialCode).
				Str("subscription_id", subID).
				Msg("failed to mark trial code redeemed")
		}
	}

	return nil
}

func (s *SubscriptionService) handleSubscriptionUpdated(ctx context.Context, event *lemonsqueezy.WebhookEvent) error {
	userID := event.Meta.CustomData.UserID
	if userID == "" {
		return errors.New("missing user_id in custom data")
	}

	status := lemonsqueezy.MapLemonSqueezyStatus(event.Data.Attributes.Status)

	var endsAt *time.Time
	if event.Data.Attributes.RenewsAt != nil {
		if t, err := time.Parse(time.RFC3339, *event.Data.Attributes.RenewsAt); err == nil {
			endsAt = &t
		}
	} else if event.Data.Attributes.EndsAt != nil {
		if t, err := time.Parse(time.RFC3339, *event.Data.Attributes.EndsAt); err == nil {
			endsAt = &t
		}
	}

	return s.entitlements.UpdateStatus(ctx, userID, status, endsAt, endsAt)
}

func (s *SubscriptionService) handleSubscriptionCancelled(ctx context.Context, event *lemonsqueezy.WebhookEvent) error {
	userID := event.Meta.CustomData.UserID
	if userID == "" {
		return errors.New("missing user_id in custom data")
	}

	var endsAt *time.Time
	if event.Data.Attributes.EndsAt != nil {
		if t, err := time.Parse(time.RFC3339, *event.Data.Attributes.EndsAt); err == nil {
			endsAt = &t
		}
	}

	return s.entitlements.UpdateStatus(ctx, userID, lemonsqueezy.StatusCancelled, endsAt, endsAt)
}

func (s *SubscriptionService) handleSubscriptionResumed(ctx context.Context, event *lemonsqueezy.WebhookEvent) error {
	userID := event.Meta.CustomData.UserID
	if userID == "" {
		return errors.New("missing user_id in custom data")
	}

	var endsAt *time.Time
	if event.Data.Attributes.RenewsAt != nil {
		if t, err := time.Parse(time.RFC3339, *event.Data.Attributes.RenewsAt); err == nil {
			endsAt = &t
		}
	}

	return s.entitlements.UpdateStatus(ctx, userID, lemonsqueezy.StatusActive, endsAt, endsAt)
}

func (s *SubscriptionService) handleSubscriptionExpired(ctx context.Context, event *lemonsqueezy.WebhookEvent) error {
	userID := event.Meta.CustomData.UserID
	if userID == "" {
		return errors.New("missing user_id in custom data")
	}

	return s.entitlements.UpdateStatus(ctx, userID, lemonsqueezy.StatusExpired, nil, nil)
}

func (s *SubscriptionService) handlePaymentFailed(ctx context.Context, event *lemonsqueezy.WebhookEvent) error {
	userID := event.Meta.CustomData.UserID
	if userID == "" {
		return errors.New("missing user_id in custom data")
	}

	return s.entitlements.UpdateStatus(ctx, userID, lemonsqueezy.StatusPastDue, nil, nil)
}

func (s *SubscriptionService) handleOrderCreated(ctx context.Context, event *lemonsqueezy.WebhookEvent) error {
	userID := event.Meta.CustomData.UserID
	if userID == "" {
		return errors.New("missing user_id in custom data")
	}

	// Respect early access mode flag
	if s.cfg != nil && s.cfg.Features.EarlyAccessMode {
		return nil
	}

	variantID := event.Data.Attributes.VariantID
	if variantID == 0 {
		return nil // No variant ID, likely subscription checkout
	}

	// Fetch variant details
	variant, err := s.client.GetVariantByID(variantID)
	if err != nil {
		return fmt.Errorf("failed to fetch variant %d: %w", variantID, err)
	}

	// Subscription variants are handled via subscription_* webhooks
	if variant.IsSubscription {
		return nil
	}

	// Grant lifetime access for one-time purchases
	if err := s.entitlements.GrantFoundingMember(ctx, userID); err != nil {
		return fmt.Errorf("failed to grant founding member access: %w", err)
	}

	// Mark as lifetime
	return s.entitlements.UpdateStatus(ctx, userID, lemonsqueezy.StatusLifetime, nil, nil)
}
