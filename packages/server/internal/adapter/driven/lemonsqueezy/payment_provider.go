// Package lemonsqueezy provides an implementation of the PaymentProvider port.
package lemonsqueezy

import (
	"budgero-server/internal/port/driven/external"
)

// PaymentProvider implements external.PaymentProvider using LemonSqueezy.
type PaymentProvider struct {
	client *Client
}

// NewPaymentProvider creates a new LemonSqueezy PaymentProvider.
func NewPaymentProvider(client *Client) *PaymentProvider {
	return &PaymentProvider{client: client}
}

var _ external.PaymentProvider = (*PaymentProvider)(nil)

// CreateCheckout creates a new checkout session for the given user and variant.
func (p *PaymentProvider) CreateCheckout(userID, userEmail, variantID string) (string, error) {
	return p.client.CreateCheckout(userID, userEmail, variantID)
}

// VerifyWebhookSignature verifies the signature of a LemonSqueezy webhook payload.
func (p *PaymentProvider) VerifyWebhookSignature(payload []byte, signature string) bool {
	return p.client.VerifyWebhookSignature(payload, signature)
}

// GetSubscription retrieves subscription details by subscription ID.
func (p *PaymentProvider) GetSubscription(subscriptionID string) (*external.SubscriptionDetails, error) {
	details, err := p.client.GetSubscription(subscriptionID)
	if err != nil {
		return nil, err
	}
	return convertSubscriptionDetails(details), nil
}

// CancelSubscription cancels the subscription with the given ID.
func (p *PaymentProvider) CancelSubscription(subscriptionID string) error {
	return p.client.CancelSubscription(subscriptionID)
}

// ResumeSubscription resumes a previously cancelled subscription.
func (p *PaymentProvider) ResumeSubscription(subscriptionID string) error {
	return p.client.ResumeSubscription(subscriptionID)
}

// UpdateSubscriptionPlan updates the subscription to a new plan variant.
func (p *PaymentProvider) UpdateSubscriptionPlan(subscriptionID, variantID string) error {
	return p.client.UpdateSubscriptionPlan(subscriptionID, variantID)
}

// GetSubscriptionInvoices retrieves all invoices for a subscription.
func (p *PaymentProvider) GetSubscriptionInvoices(subscriptionID string) ([]external.Invoice, error) {
	invoices, err := p.client.GetSubscriptionInvoices(subscriptionID)
	if err != nil {
		return nil, err
	}
	return convertInvoices(invoices), nil
}

// GetCustomerPortalURL returns the customer portal URL for the given customer.
func (p *PaymentProvider) GetCustomerPortalURL(customerID string) (string, error) {
	return p.client.GetCustomerPortalURL(customerID)
}

// GetCustomerPortalURLFromSubscription returns the customer portal URL for the given subscription.
func (p *PaymentProvider) GetCustomerPortalURLFromSubscription(subscriptionID string) (string, error) {
	return p.client.GetCustomerPortalURLFromSubscription(subscriptionID)
}

// GetProducts retrieves all products from the store.
func (p *PaymentProvider) GetProducts() ([]external.Product, error) {
	products, err := p.client.GetProducts()
	if err != nil {
		return nil, err
	}
	result := make([]external.Product, len(products))
	for i, prod := range products {
		result[i] = external.Product{
			ID:          prod.ID,
			Name:        prod.Name,
			Description: prod.Description,
			Price:       prod.Price,
			StoreID:     prod.StoreID,
		}
	}
	return result, nil
}

// GetVariants retrieves all product variants from the store.
func (p *PaymentProvider) GetVariants(_ string) ([]external.Variant, error) {
	// Note: LemonSqueezy client fetches all variants for all products in the store
	variants, err := p.client.GetVariants()
	if err != nil {
		return nil, err
	}
	result := make([]external.Variant, len(variants))
	for i, v := range variants {
		result[i] = external.Variant{
			ID:             v.ID,
			ProductID:      v.ProductID,
			Name:           v.Name,
			Description:    v.Description,
			Price:          v.Price,
			PriceFormatted: v.PriceFormatted,
			Interval:       v.Interval,
			IntervalCount:  v.IntervalCount,
			IsSubscription: v.IsSubscription,
			Sort:           v.Sort,
		}
	}
	return result, nil
}

// GetVariantByID retrieves a specific variant by its ID.
func (p *PaymentProvider) GetVariantByID(variantID int) (*external.Variant, error) {
	v, err := p.client.GetVariantByID(variantID)
	if err != nil {
		return nil, err
	}
	if v == nil {
		return nil, nil
	}
	return &external.Variant{
		ID:             v.ID,
		ProductID:      v.ProductID,
		Name:           v.Name,
		Description:    v.Description,
		Price:          v.Price,
		PriceFormatted: v.PriceFormatted,
		Interval:       v.Interval,
		IntervalCount:  v.IntervalCount,
		IsSubscription: v.IsSubscription,
		Sort:           v.Sort,
	}, nil
}

func convertSubscriptionDetails(d *SubscriptionDetails) *external.SubscriptionDetails {
	if d == nil {
		return nil
	}

	result := &external.SubscriptionDetails{
		ID:               d.ID,
		Status:           d.Status,
		VariantID:        d.VariantID,
		VariantName:      d.VariantName,
		ProductName:      d.ProductName,
		PriceCents:       d.PriceCents,
		PriceFormatted:   d.PriceFormatted,
		Interval:         d.Interval,
		IntervalCount:    d.IntervalCount,
		CardBrand:        d.CardBrand,
		CardLastFour:     d.CardLastFour,
		CustomerPortal:   d.CustomerPortal,
		UpdatePaymentURL: d.UpdatePaymentURL,
	}

	if d.CurrentPeriodEnd != nil {
		t, _ := parseLemonSqueezyTime(*d.CurrentPeriodEnd)
		if !t.IsZero() {
			result.CurrentPeriodEnd = &t
		}
	}
	if d.TrialEndsAt != nil {
		t, _ := parseLemonSqueezyTime(*d.TrialEndsAt)
		if !t.IsZero() {
			result.TrialEndsAt = &t
		}
	}
	if d.EndsAt != nil {
		t, _ := parseLemonSqueezyTime(*d.EndsAt)
		if !t.IsZero() {
			result.EndsAt = &t
		}
	}
	if d.RenewsAt != nil {
		t, _ := parseLemonSqueezyTime(*d.RenewsAt)
		if !t.IsZero() {
			result.RenewsAt = &t
		}
	}

	if d.LatestInvoice != nil {
		result.LatestInvoice = convertInvoice(d.LatestInvoice)
	}
	if d.UpcomingInvoice != nil {
		result.UpcomingInvoice = convertInvoice(d.UpcomingInvoice)
	}

	return result
}

func convertInvoices(invoices []Invoice) []external.Invoice {
	result := make([]external.Invoice, len(invoices))
	for i := range invoices {
		inv := &invoices[i]
		result[i] = *convertInvoice(inv)
	}
	return result
}

func convertInvoice(inv *Invoice) *external.Invoice {
	return &external.Invoice{
		ID:                     inv.ID,
		SubscriptionID:         inv.SubscriptionID,
		BillingReason:          inv.BillingReason,
		Status:                 inv.Status,
		StatusFormatted:        inv.StatusFormatted,
		CardBrand:              inv.CardBrand,
		CardLastFour:           inv.CardLastFour,
		Currency:               inv.Currency,
		CurrencyRate:           inv.CurrencyRate,
		Subtotal:               inv.Subtotal,
		SubtotalFormatted:      inv.SubtotalFormatted,
		DiscountTotal:          inv.DiscountTotal,
		DiscountTotalFormatted: inv.DiscountTotalFormatted,
		Tax:                    inv.Tax,
		TaxFormatted:           inv.TaxFormatted,
		Total:                  inv.Total,
		TotalFormatted:         inv.TotalFormatted,
		InvoiceURL:             inv.InvoiceURL,
		CreatedAt:              inv.CreatedAt,
		UpdatedAt:              inv.UpdatedAt,
		Refunded:               inv.Refunded,
		RefundedAt:             inv.RefundedAt,
		TestMode:               inv.TestMode,
	}
}

