// Package lemonsqueezy provides client and types for LemonSqueezy payment integration.
package lemonsqueezy

import (
	"strings"
	"time"
)

// Subscription status constants (internal representation)
const (
	StatusActive    = "active"
	StatusTrialing  = "trialing"
	StatusOnTrial   = "on_trial" // LemonSqueezy uses this
	StatusPaused    = "paused"
	StatusPastDue   = "past_due"
	StatusCancelled = "cancelled"
	StatusExpired   = "expired"
	StatusInactive  = "inactive"
	StatusLifetime  = "lifetime"
)

// MapLemonSqueezyStatus maps LemonSqueezy status to internal status
func MapLemonSqueezyStatus(lsStatus string) string {
	switch strings.ToLower(lsStatus) {
	case StatusOnTrial:
		return StatusTrialing
	case StatusActive:
		return StatusActive
	case StatusPaused:
		return StatusPaused
	case StatusPastDue:
		return StatusPastDue
	case "unpaid":
		return StatusPastDue
	case StatusCancelled:
		return StatusCancelled
	case StatusExpired:
		return StatusExpired
	default:
		return StatusInactive
	}
}

// SubscriptionDetails represents subscription information from LemonSqueezy
type SubscriptionDetails struct {
	ID               string
	Status           string
	VariantID        string
	VariantName      string
	ProductName      string
	PriceCents       int
	PriceFormatted   string
	Interval         string
	IntervalCount    int
	CurrentPeriodEnd *string
	TrialEndsAt      *string
	EndsAt           *string
	RenewsAt         *string
	CardBrand        *string
	CardLastFour     *string
	CustomerPortal   string
	UpdatePaymentURL string
	LatestInvoice    *Invoice
	UpcomingInvoice  *Invoice
}

// Product represents a LemonSqueezy product
type Product struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Price       int    `json:"price"`
	StoreID     int    `json:"store_id"`
}

// Variant represents a LemonSqueezy product variant
type Variant struct {
	ID             string `json:"id"`
	ProductID      int    `json:"product_id"`
	Name           string `json:"name"`
	Description    string `json:"description"`
	Price          int    `json:"price"`
	PriceFormatted string `json:"price_formatted"`
	Interval       string `json:"interval"`
	IntervalCount  int    `json:"interval_count"`
	IsSubscription bool   `json:"is_subscription"`
	Sort           int    `json:"sort"`
}

// Customer represents a LemonSqueezy customer
type Customer struct {
	ID         string `json:"id"`
	Attributes struct {
		StoreID                      int    `json:"store_id"`
		Name                         string `json:"name"`
		Email                        string `json:"email"`
		MonthlyRecurringRevenueCents int    `json:"monthly_recurring_revenue_cents"`
		TotalRevenueCents            int         `json:"total_revenue_cents"`
		TotalRevenueCurrency         interface{} `json:"total_revenue_currency"`
	} `json:"attributes"`
}

// Invoice represents a subscription invoice
type Invoice struct {
	ID                     string     `json:"id"`
	SubscriptionID         int        `json:"subscription_id"`
	BillingReason          string     `json:"billing_reason"`
	Status                 string     `json:"status"`
	StatusFormatted        string     `json:"status_formatted"`
	CardBrand              string     `json:"card_brand"`
	CardLastFour           string     `json:"card_last_four"`
	Currency               string     `json:"currency"`
	CurrencyRate           string     `json:"currency_rate"`
	Subtotal               int        `json:"subtotal"`
	SubtotalFormatted      string     `json:"subtotal_formatted"`
	DiscountTotal          int        `json:"discount_total"`
	DiscountTotalFormatted string     `json:"discount_total_formatted"`
	Tax                    int        `json:"tax"`
	TaxFormatted           string     `json:"tax_formatted"`
	Total                  int        `json:"total"`
	TotalFormatted         string     `json:"total_formatted"`
	InvoiceURL             string     `json:"invoice_url"`
	CreatedAt              time.Time  `json:"created_at"`
	UpdatedAt              time.Time  `json:"updated_at"`
	Refunded               bool       `json:"refunded"`
	RefundedAt             *time.Time `json:"refunded_at,omitempty"`
	TestMode               bool       `json:"test_mode"`
}

// WebhookEvent represents a LemonSqueezy webhook event
type WebhookEvent struct {
	Meta struct {
		EventName  string `json:"event_name"`
		TestMode   bool   `json:"test_mode"`
		WebhookID  string `json:"webhook_id"`
		CustomData struct {
			UserID string `json:"user_id"`
			// TrialCode is the rewards-system code passed through checkout
			// custom_data, so subscription_created webhooks can mark the
			// code redeemed without an extra LS API roundtrip.
			TrialCode string `json:"trial_code,omitempty"`
		} `json:"custom_data"`
	} `json:"meta"`
	Data struct {
		ID         string `json:"id"`
		Type       string `json:"type"`
		Attributes struct {
			StoreID               int         `json:"store_id"`
			CustomerID            int         `json:"customer_id"`
			OrderID               int         `json:"order_id"`
			OrderItemID           int         `json:"order_item_id"`
			ProductID             int         `json:"product_id"`
			VariantID             int         `json:"variant_id"`
			ProductName           string      `json:"product_name"`
			VariantName           string      `json:"variant_name"`
			UserEmail             string      `json:"user_email"`
			UserName              string      `json:"user_name"`
			Status                string      `json:"status"`
			StatusFormatted       string      `json:"status_formatted"`
			CardBrand             *string     `json:"card_brand"`
			CardLastFour          *string     `json:"card_last_four"`
			Pause                 interface{} `json:"pause"`
			Cancelled             bool        `json:"cancelled"`
			TrialEndsAt           *string     `json:"trial_ends_at"`
			BillingAnchor         int         `json:"billing_anchor"`
			PaymentProcessor      string      `json:"payment_processor"`
			FirstSubscriptionItem struct {
				ID             int    `json:"id"`
				SubscriptionID int    `json:"subscription_id"`
				PriceID        int    `json:"price_id"`
				Quantity       int    `json:"quantity"`
				IsUsageBased   bool   `json:"is_usage_based"`
				CreatedAt      string `json:"created_at"`
				UpdatedAt      string `json:"updated_at"`
			} `json:"first_subscription_item"`
			URLs struct {
				UpdatePaymentMethod              string `json:"update_payment_method"`
				CustomerPortal                   string `json:"customer_portal"`
				CustomerPortalUpdateSubscription string `json:"customer_portal_update_subscription"`
			} `json:"urls"`
			RenewsAt  *string `json:"renews_at"`
			EndsAt    *string `json:"ends_at"`
			CreatedAt string  `json:"created_at"`
			UpdatedAt string  `json:"updated_at"`
			TestMode  bool    `json:"test_mode"`
		} `json:"attributes"`
	} `json:"data"`
}
