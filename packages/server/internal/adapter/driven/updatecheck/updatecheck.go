// Package updatecheck resolves the latest published Budgero version from a
// remote source. Results are cached — including failures — so /version/latest
// never becomes a hot network path and air-gapped installs go quiet after a
// single failed attempt instead of retrying on every request.
package updatecheck

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

const (
	fetchTimeout = 3 * time.Second
	maxBodyBytes = 4096
)

// Provider lazily fetches and caches the latest released version.
type Provider struct {
	fetch   func(ctx context.Context) (string, error)
	ttl     time.Duration // how long a successful result is served from cache
	failTTL time.Duration // how long a failure suppresses re-fetching

	mu        sync.Mutex
	value     string
	checkedAt time.Time
}

// Latest returns the latest known version. ok is false when no fresh value is
// available; callers fall back to the build version. Holding the mutex across
// the fetch doubles as a single-flight guard: concurrent callers on a cold
// cache wait for the one in-flight request instead of stampeding.
func (p *Provider) Latest(ctx context.Context) (string, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if !p.checkedAt.IsZero() {
		maxAge := p.ttl
		if p.value == "" {
			maxAge = p.failTTL
		}
		if time.Since(p.checkedAt) < maxAge {
			return p.value, p.value != ""
		}
	}

	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()

	v, err := p.fetch(ctx)
	p.checkedAt = time.Now()
	if err != nil {
		p.value = ""
		log.Debug().Err(err).Msg("update check failed (cached; will retry later)")
		return "", false
	}
	p.value = v
	return v, true
}

// NewBucketProvider reads the plain-text version pointer (latest.txt) that the
// release pipeline publishes to the release bucket.
func NewBucketProvider(rawURL string, ttl, failTTL time.Duration) *Provider {
	client := &http.Client{Timeout: fetchTimeout}
	return &Provider{
		ttl:     ttl,
		failTTL: failTTL,
		fetch: func(ctx context.Context) (string, error) {
			body, err := get(ctx, client, rawURL, "")
			if err != nil {
				return "", err
			}
			v := normalizeVersion(string(body))
			if v == "" {
				return "", fmt.Errorf("latest version pointer was empty")
			}
			return v, nil
		},
	}
}

// NewServerProvider asks another Budgero server's /version/latest endpoint for
// the latest release, identifying this install by version, build and type so
// the receiving side can keep anonymous install counts. Nothing else is sent.
func NewServerProvider(rawURL, version, build, clientType string, ttl, failTTL time.Duration) *Provider {
	client := &http.Client{Timeout: fetchTimeout}
	userAgent := fmt.Sprintf("budgero/%s (%s)", version, clientType)
	return &Provider{
		ttl:     ttl,
		failTTL: failTTL,
		fetch: func(ctx context.Context) (string, error) {
			u, err := url.Parse(rawURL)
			if err != nil {
				return "", err
			}
			q := u.Query()
			q.Set("version", version)
			q.Set("build", build)
			q.Set("type", clientType)
			u.RawQuery = q.Encode()

			body, err := get(ctx, client, u.String(), userAgent)
			if err != nil {
				return "", err
			}
			var payload struct {
				LatestVersion string `json:"latest_version"`
			}
			if err := json.Unmarshal(body, &payload); err != nil {
				return "", err
			}
			v := normalizeVersion(payload.LatestVersion)
			if v == "" {
				return "", fmt.Errorf("latest_version missing in response")
			}
			return v, nil
		},
	}
}

func get(ctx context.Context, client *http.Client, rawURL, userAgent string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, http.NoBody)
	if err != nil {
		return nil, err
	}
	if userAgent != "" {
		req.Header.Set("User-Agent", userAgent)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %s fetching latest version", resp.Status)
	}
	return io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
}

// normalizeVersion trims whitespace and a leading "v" so bucket pointers
// ("v1.6.0") and package versions ("1.6.0") compare consistently downstream.
func normalizeVersion(v string) string {
	return strings.TrimPrefix(strings.TrimSpace(v), "v")
}
