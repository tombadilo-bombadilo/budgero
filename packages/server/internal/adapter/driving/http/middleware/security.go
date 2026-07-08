package middleware

import (
	"strings"

	"budgero-server/internal/config"

	"github.com/labstack/echo/v4"
)

// SecurityHeaders returns a middleware that sets common security headers
// across all responses (API and static). The policy is conservative but
// compatible with a SPA using service workers and Clerk.
func SecurityHeaders(cfg *config.Config) echo.MiddlewareFunc {
	appURL := cfg.Server.AppURL
	// Content Security Policy allowing the app shell and required runtime features
	// - default-src 'self'
	// - block all object embedding
	// - disallow being framed
	// - allow inline style (for CSS-in-JS/theming) but restrict fonts/images
	// - allow connections to self, https endpoints, and wss (for WebSocket)
	// - allow workers from self/blob for PWAs
	csp := strings.Join([]string{
		"default-src 'self'",
		"base-uri 'self'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"img-src 'self' data: blob: https:",
		"font-src 'self' data:",
		"style-src 'self' 'unsafe-inline'",
		// Allow Clerk assets and loaders
		// Also allow cdn.jsdelivr.net for HuggingFace transformers.js (Whisper WASM)
		// Also allow s.budgero.app (PostHog reverse proxy) and eu-assets.i.posthog.com for PostHog analytics scripts
		// Also allow feedback.budgero.app for the Quackback feedback widget SDK
		"script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://*.clerk.accounts.dev https://clerk.com https://clerk.budgero.app https://accounts.budgero.app https://cdn.jsdelivr.net https://s.budgero.app https://eu-assets.i.posthog.com https://feedback.budgero.app",
		// Allow API/WebSocket connections to our Clerk instance as well
		// Also allow http: for local LLM endpoints (e.g., LM Studio, Ollama on local network)
		"connect-src 'self' https: http: wss: ws: https://clerk.budgero.app https://accounts.budgero.app https://s.budgero.app https://eu.i.posthog.com https://eu-assets.i.posthog.com",
		"worker-src 'self' blob:",
		"form-action 'self' https:",
		// Allow Clerk-hosted iframes (verification, user widgets) and the Quackback feedback widget
		"frame-src https://challenges.cloudflare.com https://*.clerk.accounts.dev https://clerk.com https://clerk.budgero.app https://accounts.budgero.app https://feedback.budgero.app",
	}, "; ")

	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			// Always set these headers (force overwrite any existing CSP)
			h := c.Response().Header()

			// Clear any existing CSP headers first
			h.Del("Content-Security-Policy")

			// Set the correct CSP
			h.Set("Content-Security-Policy", csp)
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")

			// Recommended hardening header for process isolation
			h.Set("Origin-Agent-Cluster", "?1")
			// Default CORP to same-origin for our assets
			h.Set("Cross-Origin-Resource-Policy", "same-origin")

			// Set HSTS only when serving over HTTPS (or APP_URL indicates https)
			// Many deployments are behind a reverse proxy; prefer X-Forwarded-Proto
			xfProto := c.Request().Header.Get("X-Forwarded-Proto")
			isHTTPS := strings.EqualFold(xfProto, "https") || strings.HasPrefix(strings.ToLower(appURL), "https://") || c.IsTLS()
			if isHTTPS {
				// 2 years, include subdomains, allow preload
				h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
			}

			return next(c)
		}
	}
}
