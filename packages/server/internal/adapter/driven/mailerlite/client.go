// Package mailerlite provides a client for the MailerLite API.
package mailerlite

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"
)

// Client handles MailerLite API interactions.
type Client struct {
	apiKey  string
	groupID string
}

// NewClient creates a new MailerLite client.
func NewClient(apiKey, groupID string) *Client {
	return &Client{
		apiKey:  apiKey,
		groupID: groupID,
	}
}

// AddSubscriber adds or updates a subscriber in MailerLite.
// Returns the API status code and any error.
func (c *Client) AddSubscriber(email, name string) (int, error) {
	if c.apiKey == "" {
		return 0, fmt.Errorf("MailerLite API key not configured")
	}

	groupID := c.groupID
	if groupID == "" {
		groupID = "early_access"
	}

	payload := map[string]interface{}{
		"email": strings.TrimSpace(email),
		"fields": map[string]string{
			"name": strings.TrimSpace(name),
		},
		"groups": []string{groupID},
		"status": "active",
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return 0, fmt.Errorf("failed to marshal payload: %w", err)
	}

	req, err := http.NewRequest("POST", "https://api.mailerlite.com/api/v2/subscribers", bytes.NewBuffer(jsonData))
	if err != nil {
		return 0, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-MailerLite-ApiKey", c.apiKey)

	resp, err := (&http.Client{}).Do(req)
	if err != nil {
		return 0, fmt.Errorf("failed to send request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	status := resp.StatusCode
	if status != http.StatusOK && status != http.StatusCreated {
		var errorResp map[string]interface{}
		if err := json.NewDecoder(resp.Body).Decode(&errorResp); err == nil {
			if status == http.StatusConflict {
				log.Debug().Interface("error", errorResp).Int("status", status).Msg("MailerLite API error")
			} else {
				log.Error().Interface("error", errorResp).Int("status", status).Msg("MailerLite API error")
			}
		}
		return status, fmt.Errorf("MailerLite API returned status %d", status)
	}

	return status, nil
}
