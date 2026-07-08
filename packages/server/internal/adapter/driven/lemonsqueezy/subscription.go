package lemonsqueezy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// GetSubscription fetches subscription details from LemonSqueezy
func (c *Client) GetSubscription(subscriptionID string) (*SubscriptionDetails, error) {
	req, err := http.NewRequest("GET", fmt.Sprintf("https://api.lemonsqueezy.com/v1/subscriptions/%s", subscriptionID), http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "application/vnd.api+json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to fetch subscription with status %d: %s", resp.StatusCode, string(body))
	}

	var subResp struct {
		Data struct {
			ID         string `json:"id"`
			Attributes struct {
				Status           string  `json:"status"`
				VariantID        int     `json:"variant_id"`
				VariantName      string  `json:"variant_name"`
				ProductName      string  `json:"product_name"`
				CurrentPeriodEnd *string `json:"current_period_end"`
				RenewsAt         *string `json:"renews_at"`
				TrialEndsAt      *string `json:"trial_ends_at"`
				EndsAt           *string `json:"ends_at"`
				CardBrand        *string `json:"card_brand"`
				CardLastFour     *string `json:"card_last_four"`
				URLs             struct {
					CustomerPortal       string `json:"customer_portal"`
					UpdatePaymentMethod  string `json:"update_payment_method"`
					CustomerPortalUpdate string `json:"customer_portal_update_subscription"`
				} `json:"urls"`
			} `json:"attributes"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&subResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	details := &SubscriptionDetails{
		ID:               subResp.Data.ID,
		Status:           subResp.Data.Attributes.Status,
		VariantID:        fmt.Sprintf("%d", subResp.Data.Attributes.VariantID),
		VariantName:      subResp.Data.Attributes.VariantName,
		ProductName:      subResp.Data.Attributes.ProductName,
		CurrentPeriodEnd: subResp.Data.Attributes.CurrentPeriodEnd,
		RenewsAt:         subResp.Data.Attributes.RenewsAt,
		TrialEndsAt:      subResp.Data.Attributes.TrialEndsAt,
		EndsAt:           subResp.Data.Attributes.EndsAt,
		CardBrand:        subResp.Data.Attributes.CardBrand,
		CardLastFour:     subResp.Data.Attributes.CardLastFour,
		CustomerPortal:   subResp.Data.Attributes.URLs.CustomerPortal,
		UpdatePaymentURL: subResp.Data.Attributes.URLs.UpdatePaymentMethod,
	}

	// Fetch variant details for pricing/interval information.
	// Prefer the live variant name from the variants endpoint over the snapshot
	// embedded in the subscription response — LS does not propagate variant
	// renames to existing subscription records, so the snapshot goes stale after
	// any rename (e.g., renaming a variant to "Legacy").
	if subResp.Data.Attributes.VariantID != 0 {
		if variant, err := c.GetVariantByID(subResp.Data.Attributes.VariantID); err == nil && variant != nil {
			details.PriceCents = variant.Price
			details.PriceFormatted = variant.PriceFormatted
			details.Interval = variant.Interval
			details.IntervalCount = variant.IntervalCount
			if variant.Name != "" {
				details.VariantName = variant.Name
			}
		}
	}

	if details.PriceFormatted == "" && details.PriceCents > 0 {
		dollars := float64(details.PriceCents) / 100
		details.PriceFormatted = fmt.Sprintf("$%.2f", dollars)
	}

	// Enrich with latest and upcoming invoice information
	if invoices, err := c.GetSubscriptionInvoices(subscriptionID); err == nil && len(invoices) > 0 {
		now := time.Now()
		var latestPaid *Invoice
		var upcoming *Invoice

		for i := range invoices {
			inv := &invoices[i]

			if isPaidInvoiceStatus(inv.Status) {
				if latestPaid == nil || inv.CreatedAt.After(latestPaid.CreatedAt) {
					latestPaid = inv
				}
				continue
			}

			if isUpcomingInvoiceStatus(inv.Status, now, inv.CreatedAt) {
				if upcoming == nil || inv.CreatedAt.After(upcoming.CreatedAt) {
					upcoming = inv
				}
			}
		}

		// Fallback: if we did not detect an upcoming invoice explicitly, pick the most recent non-paid invoice.
		if upcoming == nil {
			for i := range invoices {
				inv := &invoices[i]
				if !isPaidInvoiceStatus(inv.Status) {
					if upcoming == nil || inv.CreatedAt.After(upcoming.CreatedAt) {
						upcoming = inv
					}
				}
			}
		}

		details.LatestInvoice = latestPaid
		details.UpcomingInvoice = upcoming
	}

	return details, nil
}

// CancelSubscription cancels a subscription
func (c *Client) CancelSubscription(subscriptionID string) error {
	req, err := http.NewRequest("DELETE", fmt.Sprintf("https://api.lemonsqueezy.com/v1/subscriptions/%s", subscriptionID), http.NoBody)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "application/vnd.api+json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("cancellation failed with status %d: %s", resp.StatusCode, string(body))
	}

	var cancelResp struct {
		Data struct {
			Attributes struct {
				Cancelled bool   `json:"cancelled"`
				Status    string `json:"status"`
				EndsAt    string `json:"ends_at"`
			} `json:"attributes"`
		} `json:"data"`
	}

	if err := json.Unmarshal(body, &cancelResp); err != nil {
		return nil // Don't fail if we can't parse but got 200 OK
	}

	if !cancelResp.Data.Attributes.Cancelled {
		return fmt.Errorf("subscription was not cancelled successfully")
	}

	return nil
}

// ResumeSubscription resumes a cancelled subscription
func (c *Client) ResumeSubscription(subscriptionID string) error {
	payload := map[string]interface{}{
		"data": map[string]interface{}{
			"type": "subscriptions",
			"id":   subscriptionID,
			"attributes": map[string]interface{}{
				"cancelled": false,
			},
		},
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	req, err := http.NewRequest("PATCH", fmt.Sprintf("https://api.lemonsqueezy.com/v1/subscriptions/%s", subscriptionID), bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "application/vnd.api+json")
	req.Header.Set("Content-Type", "application/vnd.api+json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("resume failed with status %d: %s", resp.StatusCode, string(body))
	}

	var resumeResp struct {
		Data struct {
			Attributes struct {
				Cancelled bool   `json:"cancelled"`
				Status    string `json:"status"`
			} `json:"attributes"`
		} `json:"data"`
	}

	if err := json.Unmarshal(body, &resumeResp); err != nil {
		return nil // Don't fail if we can't parse but got 200 OK
	}

	if resumeResp.Data.Attributes.Cancelled {
		return fmt.Errorf("subscription was not resumed successfully")
	}

	return nil
}

// UpdateSubscriptionPlan changes the subscription to a different variant/plan
func (c *Client) UpdateSubscriptionPlan(subscriptionID, variantID string) error {
	payload := map[string]interface{}{
		"data": map[string]interface{}{
			"type": "subscriptions",
			"id":   subscriptionID,
			"attributes": map[string]interface{}{
				"variant_id":          variantID,
				"invoice_immediately": true,
			},
		},
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	req, err := http.NewRequest("PATCH", fmt.Sprintf("https://api.lemonsqueezy.com/v1/subscriptions/%s", subscriptionID), bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "application/vnd.api+json")
	req.Header.Set("Content-Type", "application/vnd.api+json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("plan update failed with status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// GetSubscriptionInvoices retrieves all invoices for a subscription
func (c *Client) GetSubscriptionInvoices(subscriptionID string) ([]Invoice, error) {
	req, err := http.NewRequest("GET", fmt.Sprintf("https://api.lemonsqueezy.com/v1/subscription-invoices?filter[subscription_id]=%s", subscriptionID), http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "application/vnd.api+json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("invoice retrieval failed with status %d: %s", resp.StatusCode, string(body))
	}

	var invoiceResp struct {
		Data []struct {
			ID         string `json:"id"`
			Attributes struct {
				StoreID                int     `json:"store_id"`
				SubscriptionID         int     `json:"subscription_id"`
				BillingReason          string  `json:"billing_reason"`
				CardBrand              string  `json:"card_brand"`
				CardLastFour           string  `json:"card_last_four"`
				Currency               string  `json:"currency"`
				CurrencyRate           string  `json:"currency_rate"`
				Status                 string  `json:"status"`
				StatusFormatted        string  `json:"status_formatted"`
				Refunded               bool    `json:"refunded"`
				RefundedAt             *string `json:"refunded_at"`
				Subtotal               int     `json:"subtotal"`
				DiscountTotal          int     `json:"discount_total"`
				Tax                    int     `json:"tax"`
				Total                  int     `json:"total"`
				SubtotalFormatted      string  `json:"subtotal_formatted"`
				DiscountTotalFormatted string  `json:"discount_total_formatted"`
				TaxFormatted           string  `json:"tax_formatted"`
				TotalFormatted         string  `json:"total_formatted"`
				URLs                   struct {
					InvoiceURL string `json:"invoice_url"`
				} `json:"urls"`
				CreatedAt string `json:"created_at"`
				UpdatedAt string `json:"updated_at"`
				TestMode  bool   `json:"test_mode"`
			} `json:"attributes"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&invoiceResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	invoices := make([]Invoice, len(invoiceResp.Data))
	for i := range invoiceResp.Data {
		inv := &invoiceResp.Data[i]
		createdAt, _ := parseLemonSqueezyTime(inv.Attributes.CreatedAt)
		updatedAt, _ := parseLemonSqueezyTime(inv.Attributes.UpdatedAt)

		invoice := Invoice{
			ID:                     inv.ID,
			SubscriptionID:         inv.Attributes.SubscriptionID,
			BillingReason:          inv.Attributes.BillingReason,
			Status:                 inv.Attributes.Status,
			StatusFormatted:        inv.Attributes.StatusFormatted,
			CardBrand:              inv.Attributes.CardBrand,
			CardLastFour:           inv.Attributes.CardLastFour,
			Currency:               inv.Attributes.Currency,
			CurrencyRate:           inv.Attributes.CurrencyRate,
			Subtotal:               inv.Attributes.Subtotal,
			SubtotalFormatted:      inv.Attributes.SubtotalFormatted,
			DiscountTotal:          inv.Attributes.DiscountTotal,
			DiscountTotalFormatted: inv.Attributes.DiscountTotalFormatted,
			Tax:                    inv.Attributes.Tax,
			TaxFormatted:           inv.Attributes.TaxFormatted,
			Total:                  inv.Attributes.Total,
			TotalFormatted:         inv.Attributes.TotalFormatted,
			InvoiceURL:             inv.Attributes.URLs.InvoiceURL,
			CreatedAt:              createdAt,
			UpdatedAt:              updatedAt,
			Refunded:               inv.Attributes.Refunded,
			TestMode:               inv.Attributes.TestMode,
		}

		if inv.Attributes.RefundedAt != nil {
			if refundedAt, err := parseLemonSqueezyTime(*inv.Attributes.RefundedAt); err == nil {
				invoice.RefundedAt = &refundedAt
			}
		}

		invoices[i] = invoice
	}

	return invoices, nil
}

func parseLemonSqueezyTime(value string) (time.Time, error) {
	if value == "" {
		return time.Time{}, nil
	}

	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.000000Z07:00",
		"2006-01-02T15:04:05",
	}

	for _, layout := range layouts {
		if t, err := time.Parse(layout, value); err == nil {
			return t, nil
		}
	}

	return time.Time{}, fmt.Errorf("unable to parse LemonSqueezy time: %s", value)
}

func isPaidInvoiceStatus(status string) bool {
	switch strings.ToLower(status) {
	case "paid", "refunded":
		return true
	default:
		return false
	}
}

func isUpcomingInvoiceStatus(status string, now, createdAt time.Time) bool {
	switch strings.ToLower(status) {
	case "paid", "refunded", "void", "cancelled", "failed":
		return false
	case "pending", "unpaid", "open", "due", "upcoming", "planned", "draft", "past_due":
		return true
	default:
		if !createdAt.IsZero() && createdAt.After(now) {
			return true
		}
	}
	return false
}
