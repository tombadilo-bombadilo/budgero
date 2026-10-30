// Package posthog provides the PostHog capture adapter for server-side
// product analytics, plus a no-op sender for self-host and unset keys.
package posthog

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"budgero-server/internal/port/driven/external"
)

// DefaultHost is PostHog's EU ingestion endpoint.
const DefaultHost = "https://eu.i.posthog.com"

// DefaultTimeout bounds every batch request.
const DefaultTimeout = 5 * time.Second

// Sender posts event batches to PostHog's /batch/ capture endpoint.
type Sender struct {
	endpoint string
	apiKey   string
	client   *http.Client
}

var _ external.AnalyticsSender = (*Sender)(nil)

// NewSender builds a sender for host (empty = DefaultHost) with the project
// API key. timeout <= 0 uses DefaultTimeout.
func NewSender(host, apiKey string, timeout time.Duration) *Sender {
	host = strings.TrimRight(strings.TrimSpace(host), "/")
	if host == "" {
		host = DefaultHost
	}
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	return &Sender{
		endpoint: host + "/batch/",
		apiKey:   apiKey,
		client:   &http.Client{Timeout: timeout},
	}
}

// Enabled reports true: a Sender is only built when a key is configured.
func (s *Sender) Enabled() bool { return true }

type batchEvent struct {
	Event      string         `json:"event"`
	Properties map[string]any `json:"properties"`
	Timestamp  string         `json:"timestamp"`
}

type batchBody struct {
	APIKey string       `json:"api_key"`
	Batch  []batchEvent `json:"batch"`
}

// Send posts events as one batch request.
func (s *Sender) Send(ctx context.Context, events []external.AnalyticsEvent) error {
	if len(events) == 0 {
		return nil
	}
	body := batchBody{APIKey: s.apiKey, Batch: make([]batchEvent, 0, len(events))}
	for _, ev := range events {
		props := make(map[string]any, len(ev.Properties)+len(ev.Payload)+3)
		for k, v := range ev.Properties {
			props[k] = v
		}
		for k, v := range ev.Payload {
			props[k] = v
		}
		props["distinct_id"] = ev.DistinctID
		props["$lib"] = "budgero-server"
		// Server requests carry the server's IP, not the user's: never geolocate.
		props["$geoip_disable"] = true
		body.Batch = append(body.Batch, batchEvent{
			Event:      ev.Name,
			Properties: props,
			Timestamp:  ev.Timestamp.UTC().Format(time.RFC3339Nano),
		})
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("posthog: encode batch: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.endpoint, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("posthog: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("posthog: send batch: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("posthog: batch rejected with status %d", resp.StatusCode)
	}
	return nil
}

// Noop drops everything. Used for self-host builds and when POSTHOG_KEY is unset.
type Noop struct{}

var _ external.AnalyticsSender = Noop{}

// Enabled reports false so the tracker never queues anything.
func (Noop) Enabled() bool { return false }

// Send does nothing.
func (Noop) Send(context.Context, []external.AnalyticsEvent) error { return nil }
