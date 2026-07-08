package handler

import (
	"net/http"
	"time"

	"budgero-server/internal/adapter/driven/lemonsqueezy"
	"budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/domain"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"
)

func (h *Handlers) ensureSubscriptionsEnabled() error {
	if h.subscriptionsEnabled {
		return nil
	}
	return echo.NewHTTPError(http.StatusNotFound, "subscriptions are disabled in this deployment")
}

// isVariantAllowedForUser gates any request that accepts a variant ID from the
// client. Returns an error if the user isn't allowed to purchase or switch to
// the variant. Mirrors the filter logic in GetAvailablePlans so the catalog,
// checkout, and plan-change endpoints agree on who can see what.
//
// Rules:
//   - If no visible catalog is configured (allowedVariantIDs is empty), allow
//     anything — matches pre-grandfathering behavior.
//   - If the user is in the legacy allow-list, they live in a separate pricing
//     universe: only legacy variants are allowed, everything else (including
//     the normal visible catalog) is rejected. They see and can buy only their
//     grandfathered plans — no choice paralysis, no accidental upgrades.
//   - Otherwise (normal user), only the visible catalog is allowed.
func (h *Handlers) isVariantAllowedForUser(userID, variantID string) error {
	if len(h.allowedVariantIDs) == 0 {
		return nil
	}
	if _, isLegacyUser := h.legacyUserIDs[userID]; isLegacyUser {
		if _, isLegacyVariant := h.legacyVariantIDs[variantID]; isLegacyVariant {
			return nil
		}
		return echo.NewHTTPError(http.StatusForbidden, "variant not available")
	}
	if _, ok := h.allowedVariantIDs[variantID]; ok {
		return nil
	}
	return echo.NewHTTPError(http.StatusForbidden, "variant not available")
}

// GetSubscriptionStatus returns the current subscription status
func (h *Handlers) GetSubscriptionStatus(c echo.Context) error {
	if err := h.ensureSubscriptionsEnabled(); err != nil {
		return err
	}
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	user, err := h.services.User.GetByID(ctx, userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "user not found")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"subscription_status":  user.EffectiveSubscriptionStatus(),
		"subscription_id":      user.SubscriptionID,
		"customer_id":          user.CustomerID,
		"variant_id":           user.VariantID,
		"trial_ends_at":        user.TrialEndsAt,
		"subscription_ends_at": user.SubscriptionEndsAt,
		"current_period_end":   user.CurrentPeriodEnd,
		"has_beta_access":      user.HasBetaAccess,
		"beta_expires_at":      user.BetaExpiresAt,
		"is_founding_member":   user.IsFoundingMember,
	})
}

// GetSubscriptionDetails returns enriched subscription details from LemonSqueezy
func (h *Handlers) GetSubscriptionDetails(c echo.Context) error {
	if err := h.ensureSubscriptionsEnabled(); err != nil {
		return err
	}
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	user, err := h.services.User.GetByID(ctx, userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "user not found")
	}

	if user.SubscriptionID == nil || *user.SubscriptionID == "" {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"subscription": nil,
		})
	}

	details, err := h.subscriptionSvc.GetSubscription(*user.SubscriptionID)
	if err != nil {
		log.Error().Err(err).Msg("Failed to fetch subscription details")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to fetch subscription details")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"subscription": map[string]interface{}{
			"id":                        details.ID,
			"status":                    details.Status,
			"variant_id":                details.VariantID,
			"variant_name":              details.VariantName,
			"product_name":              details.ProductName,
			"price_cents":               details.PriceCents,
			"price_formatted":           details.PriceFormatted,
			"interval":                  details.Interval,
			"interval_count":            details.IntervalCount,
			"current_period_end":        details.CurrentPeriodEnd,
			"trial_ends_at":             details.TrialEndsAt,
			"ends_at":                   details.EndsAt,
			"renews_at":                 details.RenewsAt,
			"card_brand":                details.CardBrand,
			"card_last_four":            details.CardLastFour,
			"customer_portal_url":       details.CustomerPortal,
			"update_payment_method_url": details.UpdatePaymentURL,
			"latest_invoice":            invoiceToResponse(details.LatestInvoice),
			"upcoming_invoice":          invoiceToResponse(details.UpcomingInvoice),
		},
	})
}

// CreateCheckoutRequest represents the checkout creation request
type CreateCheckoutRequest struct {
	VariantID string `json:"variant_id" validate:"required"`
	// DiscountCode is an optional trial-reward code earned by the user.
	// Validated server-side before being forwarded to the payment provider.
	DiscountCode string `json:"discount_code,omitempty"`
}

// CreateCheckoutSession creates a new LemonSqueezy checkout session
func (h *Handlers) CreateCheckoutSession(c echo.Context) error {
	if err := h.ensureSubscriptionsEnabled(); err != nil {
		return err
	}
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	var req CreateCheckoutRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	if req.VariantID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "variant ID is required")
	}

	if err := h.isVariantAllowedForUser(userID, req.VariantID); err != nil {
		log.Warn().Str("user_id", userID).Str("variant_id", req.VariantID).Msg("Rejected checkout for disallowed variant")
		return err
	}

	ctx := c.Request().Context()
	user, err := h.services.User.GetByID(ctx, userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "user not found")
	}

	if req.DiscountCode != "" {
		if _, validateErr := h.services.TrialRewards.ValidateCodeForUser(ctx, userID, req.DiscountCode); validateErr != nil {
			log.Warn().Err(validateErr).Str("user_id", userID).Msg("rejected checkout: invalid discount code")
			return echo.NewHTTPError(http.StatusBadRequest, "invalid discount code: "+validateErr.Error())
		}
	}

	checkoutURL, err := h.subscriptionSvc.CreateCheckoutWithDiscount(userID, user.Email, req.VariantID, req.DiscountCode)
	if err != nil {
		log.Error().Err(err).Msg("Failed to create checkout session")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create checkout session")
	}

	return c.JSON(http.StatusOK, map[string]string{
		"url": checkoutURL,
	})
}

// GetCustomerPortal returns a customer portal URL
func (h *Handlers) GetCustomerPortal(c echo.Context) error {
	if err := h.ensureSubscriptionsEnabled(); err != nil {
		return err
	}
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	user, err := h.services.User.GetByID(ctx, userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "user not found")
	}

	portalURL, err := h.subscriptionSvc.GetCustomerPortalURL(user.SubscriptionID, user.CustomerID)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "no active subscription")
	}

	return c.JSON(http.StatusOK, map[string]string{
		"url": portalURL,
	})
}

// HandleLemonSqueezyWebhook handles webhook events from LemonSqueezy
func (h *Handlers) HandleLemonSqueezyWebhook(c echo.Context) error {
	if err := h.ensureSubscriptionsEnabled(); err != nil {
		return err
	}
	return h.subscriptionSvc.HandleWebhook(c)
}

// CancelSubscription cancels the user's subscription
func (h *Handlers) CancelSubscription(c echo.Context) error {
	if err := h.ensureSubscriptionsEnabled(); err != nil {
		return err
	}
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	user, err := h.services.User.GetByID(ctx, userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "user not found")
	}

	if user.SubscriptionID == nil || *user.SubscriptionID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "no active subscription")
	}

	isTestMode := h.cfg.LemonSqueezy.TestMode

	if err := h.subscriptionSvc.CancelSubscription(ctx, userID, *user.SubscriptionID); err != nil {
		log.Error().Err(err).Msg("Failed to cancel subscription")
		if isTestMode {
			return echo.NewHTTPError(http.StatusInternalServerError,
				"Cancel operation failed. This may be due to LemonSqueezy test mode limitations. Use the billing portal instead.")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to cancel subscription")
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message": "Subscription cancelled successfully",
	})
}

// ResumeSubscription resumes a cancelled subscription
func (h *Handlers) ResumeSubscription(c echo.Context) error {
	if err := h.ensureSubscriptionsEnabled(); err != nil {
		return err
	}
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	user, err := h.services.User.GetByID(ctx, userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "user not found")
	}

	if user.SubscriptionID == nil || *user.SubscriptionID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "no subscription found")
	}

	if user.SubscriptionStatus != domain.SubscriptionCancelled {
		return echo.NewHTTPError(http.StatusBadRequest, "subscription is not cancelled")
	}

	if err := h.subscriptionSvc.ResumeSubscription(ctx, userID, *user.SubscriptionID, user.TrialEndsAt); err != nil {
		log.Error().Err(err).Msg("Failed to resume subscription")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to resume subscription")
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message": "Subscription resumed successfully",
	})
}

// UpdateSubscriptionPlanRequest represents the request to update a subscription plan
type UpdateSubscriptionPlanRequest struct {
	VariantID string `json:"variant_id" validate:"required"`
}

// UpdateSubscriptionPlan updates the subscription to a different plan
func (h *Handlers) UpdateSubscriptionPlan(c echo.Context) error {
	if err := h.ensureSubscriptionsEnabled(); err != nil {
		return err
	}
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	var req UpdateSubscriptionPlanRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	ctx := c.Request().Context()
	user, err := h.services.User.GetByID(ctx, userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "user not found")
	}

	if user.SubscriptionID == nil || *user.SubscriptionID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "no active subscription")
	}

	if req.VariantID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "variant ID is required")
	}

	if err := h.isVariantAllowedForUser(userID, req.VariantID); err != nil {
		log.Warn().Str("user_id", userID).Str("variant_id", req.VariantID).Msg("Rejected plan change for disallowed variant")
		return err
	}

	if err := h.subscriptionSvc.UpdatePlan(ctx, userID, *user.SubscriptionID, req.VariantID,
		user.SubscriptionStatus, user.SubscriptionID, user.CustomerID,
		user.SubscriptionEndsAt, user.TrialEndsAt); err != nil {
		log.Error().Err(err).Msg("Failed to update subscription plan")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update subscription plan")
	}

	return c.JSON(http.StatusOK, map[string]string{
		"message": "Subscription plan updated successfully",
	})
}

// GetAvailablePlans returns all available subscription plans/variants
func (h *Handlers) GetAvailablePlans(c echo.Context) error {
	if err := h.ensureSubscriptionsEnabled(); err != nil {
		return err
	}

	earlyAccessMode := h.cfg.Features.EarlyAccessMode
	if earlyAccessMode {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"plans":             []map[string]interface{}{},
			"early_access_mode": true,
			"message":           "Access is currently invite-only during early access",
		})
	}

	if !h.subscriptionSvc.IsEnabled() {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "subscription catalog unavailable")
	}

	variants, err := h.subscriptionSvc.GetVariants()
	if err != nil {
		log.Error().Err(err).Msg("Failed to get variants")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to fetch available plans")
	}

	// Legacy grandfathering: users in LEMONSQUEEZY_LEGACY_USER_IDS retain
	// visibility of variants in LEMONSQUEEZY_LEGACY_VARIANT_IDS even when those
	// variants are filtered out of the normal visible catalog. This lets
	// specific users (e.g. founder-era supporters) repurchase at their original
	// pricing after a lapse, without opening that door to everyone. The same
	// rules are enforced on checkout and plan-change via isVariantAllowedForUser.
	userID := middleware.GetUserIDFromContext(c)

	plans := make([]map[string]interface{}, 0)
	for _, v := range variants {
		if !v.IsSubscription {
			continue
		}

		if err := h.isVariantAllowedForUser(userID, v.ID); err != nil {
			continue
		}

		plans = append(plans, map[string]interface{}{
			"id":              v.ID,
			"name":            v.Name,
			"description":     v.Description,
			"price":           v.Price,
			"price_formatted": v.PriceFormatted,
			"interval":        v.Interval,
			"interval_count":  v.IntervalCount,
			"is_subscription": v.IsSubscription,
			"sort":            v.Sort,
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"plans":             plans,
		"early_access_mode": false,
	})
}

// GetSubscriptionInvoices retrieves the user's subscription invoices
func (h *Handlers) GetSubscriptionInvoices(c echo.Context) error {
	if err := h.ensureSubscriptionsEnabled(); err != nil {
		return err
	}
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	user, err := h.services.User.GetByID(ctx, userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "user not found")
	}

	if user.SubscriptionID == nil || *user.SubscriptionID == "" {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"invoices": []interface{}{},
		})
	}

	invoices, err := h.subscriptionSvc.GetInvoices(*user.SubscriptionID)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to get invoices")
		return c.JSON(http.StatusOK, map[string]interface{}{
			"invoices": []interface{}{},
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"invoices": invoices,
	})
}

func invoiceToResponse(inv *lemonsqueezy.Invoice) map[string]interface{} {
	if inv == nil {
		return nil
	}

	resp := map[string]interface{}{
		"id":                       inv.ID,
		"subscription_id":          inv.SubscriptionID,
		"billing_reason":           inv.BillingReason,
		"status":                   inv.Status,
		"status_formatted":         inv.StatusFormatted,
		"card_brand":               inv.CardBrand,
		"card_last_four":           inv.CardLastFour,
		"currency":                 inv.Currency,
		"currency_rate":            inv.CurrencyRate,
		"subtotal":                 inv.Subtotal,
		"subtotal_formatted":       inv.SubtotalFormatted,
		"discount_total":           inv.DiscountTotal,
		"discount_total_formatted": inv.DiscountTotalFormatted,
		"tax":                      inv.Tax,
		"tax_formatted":            inv.TaxFormatted,
		"total":                    inv.Total,
		"total_formatted":          inv.TotalFormatted,
		"invoice_url":              inv.InvoiceURL,
		"refunded":                 inv.Refunded,
		"test_mode":                inv.TestMode,
	}

	if !inv.CreatedAt.IsZero() {
		resp["created_at"] = inv.CreatedAt.Format(time.RFC3339)
	}

	if !inv.UpdatedAt.IsZero() {
		resp["updated_at"] = inv.UpdatedAt.Format(time.RFC3339)
	}

	if inv.RefundedAt != nil && !inv.RefundedAt.IsZero() {
		resp["refunded_at"] = inv.RefundedAt.Format(time.RFC3339)
	}

	return resp
}
