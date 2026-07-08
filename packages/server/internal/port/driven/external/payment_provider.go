package external

import "time"

// SubscriptionDetails represents subscription information from a payment provider.
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
	CurrentPeriodEnd *time.Time
	TrialEndsAt      *time.Time
	EndsAt           *time.Time
	RenewsAt         *time.Time
	CardBrand        *string
	CardLastFour     *string
	CustomerPortal   string
	UpdatePaymentURL string
	LatestInvoice    *Invoice
	UpcomingInvoice  *Invoice
}

// Invoice represents a payment invoice.
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

// Product represents a product from the payment provider.
type Product struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Price       int    `json:"price"`
	StoreID     int    `json:"store_id"`
}

// Variant represents a product variant from the payment provider.
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

// WebhookEvent represents an incoming webhook event from the payment provider.
type WebhookEvent struct {
	EventName      string
	TestMode       bool
	UserID         string // Custom data user ID
	SubscriptionID string
	CustomerID     string
	VariantID      string
	Status         string
	TrialEndsAt    *time.Time
	EndsAt         *time.Time
	RenewsAt       *time.Time
}

// PaymentProvider defines methods for payment provider integrations (e.g., LemonSqueezy).
type PaymentProvider interface {
	// CreateCheckout creates a new checkout session and returns the URL.
	CreateCheckout(userID, userEmail, variantID string) (checkoutURL string, err error)

	// VerifyWebhookSignature verifies the webhook signature.
	VerifyWebhookSignature(payload []byte, signature string) bool

	// GetSubscription retrieves subscription details.
	GetSubscription(subscriptionID string) (*SubscriptionDetails, error)

	// CancelSubscription cancels a subscription.
	CancelSubscription(subscriptionID string) error

	// ResumeSubscription resumes a cancelled subscription.
	ResumeSubscription(subscriptionID string) error

	// UpdateSubscriptionPlan changes the subscription to a different variant/plan.
	UpdateSubscriptionPlan(subscriptionID, variantID string) error

	// GetSubscriptionInvoices retrieves all invoices for a subscription.
	GetSubscriptionInvoices(subscriptionID string) ([]Invoice, error)

	// GetCustomerPortalURL gets a customer portal URL.
	GetCustomerPortalURL(customerID string) (string, error)

	// GetCustomerPortalURLFromSubscription gets a customer portal URL from subscription.
	GetCustomerPortalURLFromSubscription(subscriptionID string) (string, error)

	// GetProducts retrieves available products.
	GetProducts() ([]Product, error)

	// GetVariants retrieves variants for a product.
	GetVariants(productID string) ([]Variant, error)

	// GetVariantByID retrieves a specific variant.
	GetVariantByID(variantID int) (*Variant, error)
}
