// Package config provides centralized configuration management for the server.
// All configuration is loaded from environment variables at startup.
package config

import (
	"crypto/rand"
	"fmt"
	"strings"

	"github.com/caarlos0/env/v11"
)

// Config holds all application configuration.
type Config struct {
	Server       ServerConfig
	Auth         AuthConfig
	Database     DatabaseConfig
	LemonSqueezy LemonSqueezyConfig
	Features     FeatureConfig
	RateLimit    RateLimitConfig
	External     ExternalConfig
	WebSocket    WebSocketConfig
	Email        EmailConfig
}

// ServerConfig contains HTTP server settings.
type ServerConfig struct {
	Port       int    `env:"PORT" envDefault:"3001"`
	LogLevel   string `env:"LOG_LEVEL" envDefault:"info"`
	AppURL     string `env:"APP_URL"`
	AppBaseURL string `env:"APP_BASE_URL"`
	AppVersion string `env:"APP_VERSION"`
}

// AuthConfig contains authentication and authorization settings.
type AuthConfig struct {
	// Self-host mode settings
	SelfHostable bool   `env:"SELF_HOSTABLE" envDefault:"false"`
	JWTSecret    string `env:"SELF_HOST_JWT_SECRET"`
	JWTTTLHours  int    `env:"SELF_HOST_JWT_TTL_HOURS" envDefault:"24"`

	// Clerk (SaaS mode) settings
	ClerkSecretKey string `env:"CLERK_SECRET_KEY"`
	ClerkJWTLeeway int    `env:"CLERK_JWT_LEEWAY_SECONDS" envDefault:"10"`

	// Admin access
	AdminEmails []string `env:"ADMIN_EMAILS" envSeparator:","`
}

// DatabaseConfig contains database settings.
type DatabaseConfig struct {
	Path string `env:"DB_PATH" envDefault:"data/budgero.db"`
}

// LemonSqueezyConfig contains payment provider settings.
type LemonSqueezyConfig struct {
	APIKey            string   `env:"LEMONSQUEEZY_API_KEY"`
	StoreID           string   `env:"LEMONSQUEEZY_STORE_ID"`
	WebhookSecret     string   `env:"LEMONSQUEEZY_WEBHOOK_SECRET"`
	TestMode          bool     `env:"LEMONSQUEEZY_TEST_MODE" envDefault:"false"`
	VisibleVariantIDs []string `env:"LEMONSQUEEZY_VISIBLE_VARIANT_IDS" envSeparator:","`
	// LegacyUserIDs is an allow-list of user IDs that retain access to legacy
	// (grandfathered) variants even after the main catalog hides them. When a
	// user in this list loads /subscription/plans, any variant listed in
	// LegacyVariantIDs is surfaced in addition to the normally-visible set.
	LegacyUserIDs []string `env:"LEMONSQUEEZY_LEGACY_USER_IDS" envSeparator:","`
	// LegacyVariantIDs lists the grandfathered variants that remain visible to
	// users in LegacyUserIDs. These variants should stay *enabled* in the
	// LemonSqueezy dashboard — disabling them in LS blocks checkout entirely,
	// so the allow-list would become decorative.
	LegacyVariantIDs []string `env:"LEMONSQUEEZY_LEGACY_VARIANT_IDS" envSeparator:","`
}

// FeatureConfig contains feature flags and feature-specific settings.
type FeatureConfig struct {

	// Early access
	EarlyAccessMode    bool   `env:"EARLY_ACCESS_MODE" envDefault:"false"`
	EarlyAccessMessage string `env:"EARLY_ACCESS_MESSAGE"`

	// Trial
	TrialDurationDays int `env:"TRIAL_DURATION_DAYS" envDefault:"35"`

	// DevToolsEnabled exposes development-only endpoints (force-unlock /
	// reset trial state) intended for QA in non-production deployments.
	// MUST stay false in production.
	DevToolsEnabled bool `env:"DEV_TOOLS_ENABLED" envDefault:"false"`

	// DisableRegistration blocks public self-host signup (/auth/local/register).
	// Set to true on an internet-exposed instance and create users via the
	// admin CLI instead.
	DisableRegistration bool `env:"DISABLE_REGISTRATION" envDefault:"false"`
}

// RateLimitConfig contains rate limiting settings.
type RateLimitConfig struct {
	RPS        float64 `env:"RATE_LIMIT_RPS" envDefault:"50"`
	Burst      int     `env:"RATE_LIMIT_BURST" envDefault:"100"`
	ExpiresMin int     `env:"RATE_LIMIT_EXPIRES_MIN" envDefault:"3"`
}

// ExternalConfig contains external service settings.
type ExternalConfig struct {
	// Currency exchange
	CurrencyLayerAPIKey string `env:"CURRENCYLAYER_API_KEY"`

	// Newsletter
	MailerLiteAPIKey  string `env:"MAILERLITE_API_KEY"`
	MailerLiteGroupID string `env:"MAILERLITE_GROUP_ID"`

	// Offline mode signing
	OfflineECDSAPrivPEM  string `env:"OFFLINE_ECDSA_PRIV_PEM"`
	OfflineECDSAPrivPath string `env:"OFFLINE_ECDSA_PRIV_PATH"`
}

// WebSocketConfig contains WebSocket settings.
type WebSocketConfig struct {
	AllowedOrigins []string `env:"WEBSOCKET_ALLOWED_ORIGINS" envSeparator:","`
}

// EmailConfig contains transactional + marketing email settings.
// The welcome email gets Reply-To; the marketing emails (inactivity,
// trial-ended) do not — their footer points users at hello@ instead.
type EmailConfig struct {
	ResendAPIKey      string `env:"RESEND_API_KEY"`
	FromAddress       string `env:"EMAIL_FROM" envDefault:"Budgero <updates@updates.budgero.app>"`
	ReplyTo           string `env:"EMAIL_REPLY_TO" envDefault:"hello@budgero.app"`
	Enabled           bool   `env:"EMAIL_ENABLED" envDefault:"true"`
	DryRun            bool   `env:"EMAIL_DRY_RUN" envDefault:"false"`
	TrialDiscountCode string `env:"EMAIL_TRIAL_DISCOUNT_CODE" envDefault:"COMEBACK30"`
	// AppURL is the base URL used in email CTAs. Intentionally decoupled
	// from Server.AppURL (which is "http://localhost:5173" in dev) so
	// emails sent from a dev box still link to the real app.
	AppURL string `env:"EMAIL_APP_URL" envDefault:"https://my.budgero.app"`
}

// Load reads configuration from environment variables.
// It returns an error if required configuration is missing or invalid.
func Load() (*Config, error) {
	cfg := &Config{}

	if err := env.Parse(cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}

	// Post-processing: trim whitespace from admin emails
	for i, email := range cfg.Auth.AdminEmails {
		cfg.Auth.AdminEmails[i] = strings.TrimSpace(strings.ToLower(email))
	}

	// Post-processing: trim whitespace from variant IDs
	for i, id := range cfg.LemonSqueezy.VisibleVariantIDs {
		cfg.LemonSqueezy.VisibleVariantIDs[i] = strings.TrimSpace(id)
	}
	for i, id := range cfg.LemonSqueezy.LegacyUserIDs {
		cfg.LemonSqueezy.LegacyUserIDs[i] = strings.TrimSpace(id)
	}
	for i, id := range cfg.LemonSqueezy.LegacyVariantIDs {
		cfg.LemonSqueezy.LegacyVariantIDs[i] = strings.TrimSpace(id)
	}

	// Default WebSocket origins to AppURL if not specified
	if len(cfg.WebSocket.AllowedOrigins) == 0 && cfg.Server.AppURL != "" {
		cfg.WebSocket.AllowedOrigins = []string{cfg.Server.AppURL}
	}

	// Generate JWT secret if not provided in self-host mode
	if cfg.Auth.SelfHostable && cfg.Auth.JWTSecret == "" {
		cfg.Auth.JWTSecret = generateSecureSecret()
	}

	return cfg, nil
}

// MustLoad loads configuration and panics on error.
// Use this in main() where recovery isn't possible.
func MustLoad() *Config {
	cfg, err := Load()
	if err != nil {
		panic(fmt.Sprintf("failed to load config: %v", err))
	}
	return cfg
}

// Validate performs additional validation beyond env parsing.
func (c *Config) Validate() error {
	// In SaaS mode, Clerk secret is required
	if !c.Auth.SelfHostable && c.Auth.ClerkSecretKey == "" {
		return fmt.Errorf("CLERK_SECRET_KEY is required in SaaS mode")
	}

	return nil
}

// IsSelfHost returns true if running in self-hosted mode.
func (c *Config) IsSelfHost() bool {
	return c.Auth.SelfHostable
}

// IsAdmin checks if an email is in the admin list.
func (c *Config) IsAdmin(email string) bool {
	if len(c.Auth.AdminEmails) == 0 {
		return false
	}
	normalized := strings.TrimSpace(strings.ToLower(email))
	for _, admin := range c.Auth.AdminEmails {
		if admin == normalized {
			return true
		}
	}
	return false
}

// HasLemonSqueezy returns true if LemonSqueezy is configured.
func (c *Config) HasLemonSqueezy() bool {
	return c.LemonSqueezy.APIKey != ""
}

// HasMailerLite returns true if MailerLite is configured.
func (c *Config) HasMailerLite() bool {
	return c.External.MailerLiteAPIKey != ""
}

// HasEmail returns true if transactional email is enabled and the Resend
// API key is set. Scheduler and per-event sends short-circuit when false.
func (c *Config) HasEmail() bool {
	return c.Email.Enabled && c.Email.ResendAPIKey != ""
}

// HasCurrencyLayer returns true if CurrencyLayer is configured.
func (c *Config) HasCurrencyLayer() bool {
	return c.External.CurrencyLayerAPIKey != ""
}

// generateSecureSecret generates a secure random secret for JWT signing.
func generateSecureSecret() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err == nil {
		return fmt.Sprintf("%x", b)
	}
	// Never fall back to a guessable, pid/time-derived signing key — fail loudly
	// instead of booting with a forgeable JWT secret.
	panic("cannot generate JWT signing secret: no source of randomness available")
}
