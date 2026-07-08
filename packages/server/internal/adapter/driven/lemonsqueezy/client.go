package lemonsqueezy

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"budgero-server/internal/config"

	"github.com/rs/zerolog/log"
)

// Client handles all interactions with LemonSqueezy API
type Client struct {
	apiKey        string
	storeID       string
	webhookSecret string
	appURL        string
	httpClient    *http.Client
}

// NewClientWithConfig creates a new LemonSqueezy client using config.
func NewClientWithConfig(cfg *config.Config) *Client {
	return &Client{
		apiKey:        cfg.LemonSqueezy.APIKey,
		storeID:       cfg.LemonSqueezy.StoreID,
		webhookSecret: cfg.LemonSqueezy.WebhookSecret,
		appURL:        cfg.Server.AppURL,
		httpClient:    &http.Client{Timeout: 10 * time.Second},
	}
}

// CheckoutResponse represents the response from creating a checkout
type CheckoutResponse struct {
	Data struct {
		ID         string `json:"id"`
		Attributes struct {
			URL string `json:"url"`
		} `json:"attributes"`
	} `json:"data"`
}

// CreateCheckout creates a new checkout session.
func (c *Client) CreateCheckout(userID, userEmail, variantID string) (string, error) {
	return c.CreateCheckoutWithDiscount(userID, userEmail, variantID, "")
}

// CreateCheckoutWithDiscount creates a checkout session with an optional
// pre-applied discount code. The code must already exist on LemonSqueezy
// (via CreateDiscount). It is also stamped into custom_data.trial_code so
// the subscription_created webhook can identify it.
func (c *Client) CreateCheckoutWithDiscount(userID, userEmail, variantID, discountCode string) (string, error) {
	custom := map[string]interface{}{"user_id": userID}
	if discountCode != "" {
		custom["trial_code"] = discountCode
	}

	checkoutData := map[string]interface{}{
		"email":  userEmail,
		"custom": custom,
	}
	if discountCode != "" {
		checkoutData["discount_code"] = discountCode
	}

	payload := map[string]interface{}{
		"data": map[string]interface{}{
			"type": "checkouts",
			"attributes": map[string]interface{}{
				"checkout_data": checkoutData,
				"product_options": map[string]interface{}{
					"redirect_url": trimTrailingSlash(c.appURL) + "/subscription/success",
				},
				"expires_at": time.Now().Add(24 * time.Hour).Format(time.RFC3339),
			},
			"relationships": map[string]interface{}{
				"store": map[string]interface{}{
					"data": map[string]interface{}{
						"type": "stores",
						"id":   c.storeID,
					},
				},
				"variant": map[string]interface{}{
					"data": map[string]interface{}{
						"type": "variants",
						"id":   variantID,
					},
				},
			},
		},
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("failed to marshal payload: %w", err)
	}

	req, err := http.NewRequest("POST", "https://api.lemonsqueezy.com/v1/checkouts", bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "application/vnd.api+json")
	req.Header.Set("Content-Type", "application/vnd.api+json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("checkout creation failed with status %d: %s", resp.StatusCode, string(body))
	}

	var checkoutResp CheckoutResponse
	if err := json.NewDecoder(resp.Body).Decode(&checkoutResp); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	return checkoutResp.Data.Attributes.URL, nil
}

// CreateDiscount creates a single-redemption percentage discount on the LS
// store, scoped to a specific variant. Returns the discount's ID. The code
// must be unique across the store and must contain only uppercase letters
// and digits (3–256 chars per LS spec — no hyphens or other punctuation).
//
// Payload fields verified against the LS docs at
// https://docs.lemonsqueezy.com/api/discounts/create-discount and the
// third-party Go SDK type definitions: amount_type, is_limited_redemptions,
// max_redemptions, is_limited_to_products, duration ("repeating") with
// duration_in_months, starts_at, expires_at, and the variants relationship
// are all real fields with the shapes used here.
func (c *Client) CreateDiscount(code string, percentOff int, variantID string, expiresAt time.Time) (string, error) {
	if c.storeID == "" {
		return "", fmt.Errorf("LEMONSQUEEZY_STORE_ID not configured")
	}
	payload := map[string]interface{}{
		"data": map[string]interface{}{
			"type": "discounts",
			"attributes": map[string]interface{}{
				"name":        fmt.Sprintf("Trial reward — %s", code),
				"code":        code,
				"amount":      percentOff,
				"amount_type": "percent",
				// Apply the discount across 24 months of subscription. For
				// the annual plan that's the first 2 yearly payments;
				// renewals from year 3 onward are at the regular price.
				"duration":               "repeating",
				"duration_in_months":     24,
				"is_limited_redemptions": true,
				"max_redemptions":        1,
				"is_limited_to_products": true,
				"starts_at":              time.Now().UTC().Format(time.RFC3339),
				"expires_at":             expiresAt.UTC().Format(time.RFC3339),
			},
			"relationships": map[string]interface{}{
				"store": map[string]interface{}{
					"data": map[string]interface{}{"type": "stores", "id": c.storeID},
				},
				"variants": map[string]interface{}{
					"data": []map[string]interface{}{
						{"type": "variants", "id": variantID},
					},
				},
			},
		},
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal discount payload: %w", err)
	}

	req, err := http.NewRequest("POST", "https://api.lemonsqueezy.com/v1/discounts", bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("create discount request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.api+json")
	req.Header.Set("Content-Type", "application/vnd.api+json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("send discount request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("discount creation failed with status %d: %s", resp.StatusCode, string(body))
	}

	var discountResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&discountResp); err != nil {
		return "", fmt.Errorf("decode discount response: %w", err)
	}
	return discountResp.Data.ID, nil
}

// DeleteDiscount removes a discount from the LS store so it can no longer
// be redeemed at checkout. Idempotent in spirit: a 404 (already gone) is
// treated as success since the desired end-state is "discount gone."
func (c *Client) DeleteDiscount(discountID string) error {
	if discountID == "" {
		return nil
	}
	req, err := http.NewRequest("DELETE",
		fmt.Sprintf("https://api.lemonsqueezy.com/v1/discounts/%s", discountID), http.NoBody)
	if err != nil {
		return fmt.Errorf("create delete-discount request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.api+json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send delete-discount request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	switch resp.StatusCode {
	case http.StatusNoContent, http.StatusOK, http.StatusNotFound:
		return nil
	default:
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("delete discount failed with status %d: %s", resp.StatusCode, string(body))
	}
}

// VerifyWebhookSignature verifies the webhook signature from LemonSqueezy
func (c *Client) VerifyWebhookSignature(payload []byte, signature string) bool {
	if c.webhookSecret == "" {
		log.Warn().Msg("Webhook secret not configured; rejecting webhook")
		return false
	}
	h := hmac.New(sha256.New, []byte(c.webhookSecret))
	h.Write(payload)
	expectedSignature := hex.EncodeToString(h.Sum(nil))
	return hmac.Equal([]byte(expectedSignature), []byte(signature))
}

// GetCustomerPortalURLFromSubscription gets a customer portal URL by retrieving the subscription object
func (c *Client) GetCustomerPortalURLFromSubscription(subscriptionID string) (string, error) {
	req, err := http.NewRequest("GET", fmt.Sprintf("https://api.lemonsqueezy.com/v1/subscriptions/%s", subscriptionID), http.NoBody)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "application/vnd.api+json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("subscription retrieval failed with status %d: %s", resp.StatusCode, string(body))
	}

	var subscriptionResp struct {
		Data struct {
			Attributes struct {
				URLs struct {
					CustomerPortal string `json:"customer_portal"`
				} `json:"urls"`
			} `json:"attributes"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&subscriptionResp); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	portalURL := subscriptionResp.Data.Attributes.URLs.CustomerPortal
	if portalURL == "" {
		return "", fmt.Errorf("customer portal URL not found in response")
	}

	return portalURL, nil
}

// GetCustomerPortalURL gets a customer portal URL by retrieving the customer object
func (c *Client) GetCustomerPortalURL(customerID string) (string, error) {
	req, err := http.NewRequest("GET", fmt.Sprintf("https://api.lemonsqueezy.com/v1/customers/%s", customerID), http.NoBody)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "application/vnd.api+json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("customer retrieval failed with status %d: %s", resp.StatusCode, string(body))
	}

	var customerResp struct {
		Data struct {
			Attributes struct {
				URLs struct {
					CustomerPortal string `json:"customer_portal"`
				} `json:"urls"`
			} `json:"attributes"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&customerResp); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	portalURL := customerResp.Data.Attributes.URLs.CustomerPortal
	if portalURL == "" {
		return "", fmt.Errorf("customer portal URL not found in response")
	}

	return portalURL, nil
}

// GetCustomer fetches a single customer with revenue details.
func (c *Client) GetCustomer(customerID string) (*Customer, error) {
	req, err := http.NewRequest("GET", fmt.Sprintf("https://api.lemonsqueezy.com/v1/customers/%s", customerID), http.NoBody)
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
		return nil, fmt.Errorf("customer retrieval failed with status %d: %s", resp.StatusCode, string(body))
	}

	var customerResp struct {
		Data struct {
			ID         string `json:"id"`
			Attributes struct {
				StoreID                      int         `json:"store_id"`
				Name                         string      `json:"name"`
				Email                        string      `json:"email"`
				MonthlyRecurringRevenueCents int         `json:"monthly_recurring_revenue_cents"`
				TotalRevenueCents            int         `json:"total_revenue_cents"`
				TotalRevenueCurrency         interface{} `json:"total_revenue_currency"`
			} `json:"attributes"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&customerResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	customer := &Customer{ID: customerResp.Data.ID}
	customer.Attributes.StoreID = customerResp.Data.Attributes.StoreID
	customer.Attributes.Name = customerResp.Data.Attributes.Name
	customer.Attributes.Email = customerResp.Data.Attributes.Email
	customer.Attributes.MonthlyRecurringRevenueCents = customerResp.Data.Attributes.MonthlyRecurringRevenueCents
	customer.Attributes.TotalRevenueCents = customerResp.Data.Attributes.TotalRevenueCents
	customer.Attributes.TotalRevenueCurrency = customerResp.Data.Attributes.TotalRevenueCurrency

	return customer, nil
}

func trimTrailingSlash(s string) string {
	for s != "" && s[len(s)-1] == '/' {
		s = s[:len(s)-1]
	}
	return s
}
