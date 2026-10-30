// Package handler provides HTTP request handlers for the API.
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"budgero-server/internal/adapter/driven/lemonsqueezy"
	"budgero-server/internal/adapter/driving/http/bankrelay"
	"budgero-server/internal/adapter/driving/http/middleware"
	synchub "budgero-server/internal/adapter/driving/http/websocket"
	"budgero-server/internal/application"
	"budgero-server/internal/application/email"
	"budgero-server/internal/config"
	"budgero-server/internal/domain"
	"budgero-server/internal/domain/analytics"
	"budgero-server/internal/port/driven/external"
	"budgero-server/internal/port/driving"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"
)

// Options configures the handlers.
type Options struct {
	SelfHost             bool
	RegistrationDisabled func() (bool, error)
	Config               *config.Config
	// Email is the transactional email service. Optional — nil when email is
	// disabled (self-host, missing RESEND_API_KEY). When present, it's wired
	// into ClerkSync so the welcome email fires on user creation.
	Email *email.Service
	// LatestVersion resolves the latest published release. Optional — nil
	// (update check disabled, APP_LATEST_VERSION pinned, tests) makes
	// /version/latest fall back to the build version.
	LatestVersion LatestVersionSource
	// BankRelay serves the opaque bank sync tunnel. Optional — nil builds one
	// with production settings (Enable Banking only).
	BankRelay *bankrelay.Relay
	// Telemetry records aggregate sync metrics. Optional — nil records nothing.
	Telemetry external.SyncTelemetry
}

// Handlers contains HTTP request handlers for the API.
type Handlers struct {
	registrationDisabled func() (bool, error)
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
	email                *email.Service
	bankRelay            *bankrelay.Relay
	blobLocks            spaceBlobLocks
	telemetry            external.SyncTelemetry
}

// NewHandlers creates a new Handlers instance.
func NewHandlers(services *application.Services, syncHub *synchub.Hub, opts Options) *Handlers {
	subscriptionSvc := NewSubscriptionService(services.Entitlement, services.User, opts.Config, !opts.SelfHost)
	subscriptionSvc.analytics = services.Analytics
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

	bankRelay := opts.BankRelay
	if bankRelay == nil {
		bankRelay = bankrelay.New(&bankrelay.Options{})
	}

	var telemetry external.SyncTelemetry = external.NoopTelemetry{}
	if opts.Telemetry != nil {
		telemetry = opts.Telemetry
	}

	return &Handlers{
		telemetry:            telemetry,
		bankRelay:            bankRelay,
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
		registrationDisabled: opts.RegistrationDisabled,
		latestVersion:        opts.LatestVersion,
		email:                opts.Email,
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

// track records a product analytics event. Safe when analytics is not wired.
func (h *Handlers) track(userID string, event analytics.Event) {
	if h.services != nil && h.services.Analytics != nil {
		h.services.Analytics.Track(userID, event)
	}
}

// analyticsEnabled reports whether events leave the server, so handlers can
// skip queries that only feed event properties.
func (h *Handlers) analyticsEnabled() bool {
	return h.services != nil && h.services.Analytics != nil && h.services.Analytics.Enabled()
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
	// Don't leak raw internal/driver error strings to clients: the central
	// error handler logs and reports the cause, the client gets a fixed message.
	return internalErr("internal server error", err)
}

// internalErr is the 500 the client sees (fixed public message) with cause
// attached for the central error handler to log and report. Handlers use it
// instead of logging next to a 500 return.
func internalErr(publicMsg string, cause error) *echo.HTTPError {
	return middleware.InternalError(http.StatusInternalServerError, publicMsg, cause)
}

// SubscriptionService handles subscription-related operations.
type SubscriptionService struct {
	entitlements         driving.EntitlementService
	users                driving.UserService
	cfg                  *config.Config
	client               *lemonsqueezy.Client
	cache                *lemonsqueezy.ProductCache
	subscriptionsEnabled bool
	analytics            driving.AnalyticsTracker
}

// RevenueStats contains MRR and total revenue data.
type RevenueStats struct {
	MRR          int `json:"mrr"`
	TotalRevenue int `json:"totalRevenue"`
}

// NewSubscriptionService creates a new SubscriptionService.
func NewSubscriptionService(entitlements driving.EntitlementService, users driving.UserService, cfg *config.Config, subscriptionsEnabled bool) *SubscriptionService {
	if !subscriptionsEnabled {
		return &SubscriptionService{
			entitlements:         entitlements,
			users:                users,
			cfg:                  cfg,
			subscriptionsEnabled: false,
		}
	}

	client := lemonsqueezy.NewClientWithConfig(cfg)
	cache := lemonsqueezy.NewProductCache(client)

	svc := &SubscriptionService{
		entitlements:         entitlements,
		users:                users,
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

// maxWebhookBodyBytes caps how much of an unauthenticated webhook body is read
// before its signature is checked. LemonSqueezy payloads are a few KB.
const maxWebhookBodyBytes int64 = 1 << 20

// HandleWebhook processes incoming webhook events from LemonSqueezy.
//
// Delivery contract: a 2xx tells LemonSqueezy the event is done, anything else
// makes it retry. So processing failures return 500 (a lost order_created or
// subscription_created would otherwise leave a paying customer without access),
// while unknown/ignored event types return 200. Every handler writes absolute
// state (no counters or toggles), so re-delivering an event is safe.
func (s *SubscriptionService) HandleWebhook(c echo.Context) error {
	if !s.subscriptionsEnabled {
		return echo.NewHTTPError(http.StatusNotFound, "subscriptions are disabled")
	}

	body, err := readLimitedBody(c, maxWebhookBodyBytes, "webhook body too large", "Failed to read request body")
	if err != nil {
		log.Error().Err(err).Msg("Failed to read webhook body")
		return err
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
	case "subscription_payment_success":
		s.trackRenewal(ctx, &event)
	default:
		log.Info().Str("event", event.Meta.EventName).Msg("Unhandled webhook event type")
	}

	if err != nil {
		log.Error().
			Err(err).
			Str("event", event.Meta.EventName).
			Str("user_id", event.Meta.CustomData.UserID).
			Str("subscription_id", event.Data.ID).
			Msg("Failed to process webhook event; returning 500 so LemonSqueezy retries")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to process webhook event")
	}

	s.trackWebhook(&event)

	return c.JSON(http.StatusOK, map[string]bool{"success": true})
}

// trackWebhook records subscription_started / subscription_canceled once the
// event was applied. Test-mode events are not tracked.
func (s *SubscriptionService) trackWebhook(event *lemonsqueezy.WebhookEvent) {
	if s.analytics == nil || !s.analytics.Enabled() || event.Meta.TestMode || event.Data.Attributes.TestMode {
		return
	}
	userID := event.Meta.CustomData.UserID
	plan := s.planFor(fmt.Sprintf("%d", event.Data.Attributes.VariantID), event.Data.Attributes.VariantName)
	switch event.Meta.EventName {
	case "subscription_created":
		s.analytics.Track(userID, analytics.SubscriptionStarted(plan))
	case "subscription_cancelled":
		s.analytics.Track(userID, analytics.SubscriptionCanceled(plan))
	}
}

// trackRenewal records subscription_renewed for renewal payments. The invoice
// payload carries no variant, so the plan comes from the user's stored
// variant. Analytics-only: it never fails the webhook.
func (s *SubscriptionService) trackRenewal(ctx context.Context, event *lemonsqueezy.WebhookEvent) {
	if s.analytics == nil || !s.analytics.Enabled() || event.Meta.TestMode || event.Data.Attributes.TestMode {
		return
	}
	if event.Data.Attributes.BillingReason != "renewal" {
		return
	}
	userID := event.Meta.CustomData.UserID
	if userID == "" || s.users == nil {
		return
	}
	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return
	}
	variantID := ""
	if user.VariantID != nil {
		variantID = *user.VariantID
	}
	s.analytics.Track(userID, analytics.SubscriptionRenewed(s.planFor(variantID, "")))
}

// planFor resolves a variant's billing interval from the warm product cache
// (never an API call on the webhook path), then from the variant name.
func (s *SubscriptionService) planFor(variantID, variantName string) analytics.Plan {
	if s.cache != nil && variantID != "" {
		for _, v := range s.cache.CachedVariants() {
			if v.ID == variantID {
				if p := analytics.PlanFromInterval(v.Interval); p != analytics.PlanUnknown {
					return p
				}
				break
			}
		}
	}
	name := strings.ToLower(variantName)
	switch {
	case strings.Contains(name, "year") || strings.Contains(name, "annual"):
		return analytics.PlanYearly
	case strings.Contains(name, "month"):
		return analytics.PlanMonthly
	}
	return analytics.PlanUnknown
}

// webhookUserID returns the event's user, failing when it is missing or not
// (yet) in the database. Writes to an unknown user would match no rows and
// silently drop the event; failing makes LemonSqueezy retry it instead.
func (s *SubscriptionService) webhookUserID(ctx context.Context, event *lemonsqueezy.WebhookEvent) (string, error) {
	userID := event.Meta.CustomData.UserID
	if userID == "" {
		return "", errors.New("missing user_id in custom data")
	}
	if s.users != nil {
		if _, err := s.users.GetByID(ctx, userID); err != nil {
			return "", fmt.Errorf("webhook user %s: %w", userID, err)
		}
	}
	return userID, nil
}

func (s *SubscriptionService) handleSubscriptionCreated(ctx context.Context, event *lemonsqueezy.WebhookEvent) error {
	userID, err := s.webhookUserID(ctx, event)
	if err != nil {
		return err
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

	return nil
}

func (s *SubscriptionService) handleSubscriptionUpdated(ctx context.Context, event *lemonsqueezy.WebhookEvent) error {
	userID, err := s.webhookUserID(ctx, event)
	if err != nil {
		return err
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
	userID, err := s.webhookUserID(ctx, event)
	if err != nil {
		return err
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
	userID, err := s.webhookUserID(ctx, event)
	if err != nil {
		return err
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
	userID, err := s.webhookUserID(ctx, event)
	if err != nil {
		return err
	}

	return s.entitlements.UpdateStatus(ctx, userID, lemonsqueezy.StatusExpired, nil, nil)
}

func (s *SubscriptionService) handlePaymentFailed(ctx context.Context, event *lemonsqueezy.WebhookEvent) error {
	userID, err := s.webhookUserID(ctx, event)
	if err != nil {
		return err
	}

	return s.entitlements.UpdateStatus(ctx, userID, lemonsqueezy.StatusPastDue, nil, nil)
}

func (s *SubscriptionService) handleOrderCreated(ctx context.Context, event *lemonsqueezy.WebhookEvent) error {
	userID, err := s.webhookUserID(ctx, event)
	if err != nil {
		return err
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
