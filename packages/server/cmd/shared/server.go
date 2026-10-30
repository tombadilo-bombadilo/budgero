// Package shared provides common server startup and configuration logic
// used by both cloud and self-hosted deployments.
package shared //nolint:revive // var-naming: package is shared between cloud and selfhost commands

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"math/big"
	"mime"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	serverpkg "budgero-server"
	"budgero-server/internal/adapter/driven/currencyapi"
	"budgero-server/internal/adapter/driven/otelmetrics"
	"budgero-server/internal/adapter/driven/posthog"
	"budgero-server/internal/adapter/driven/sqlite"
	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/adapter/driven/updatecheck"
	"budgero-server/internal/adapter/driving/http/handler"
	appmw "budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/adapter/driving/http/routes"
	synchub "budgero-server/internal/adapter/driving/http/websocket"
	"budgero-server/internal/application"
	emailpkg "budgero-server/internal/application/email"
	"budgero-server/internal/appmeta"
	"budgero-server/internal/config"
	"budgero-server/internal/port/driven/external"

	"github.com/joho/godotenv"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"golang.org/x/time/rate"
)

// Run starts the web server with the given configuration.
func Run(selfHost bool) {
	if selfHost {
		_ = os.Setenv("SELF_HOSTABLE", "true")
	}

	if err := godotenv.Load(); err == nil {
		log.Info().Msg("Loaded environment variables from .env")
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to load configuration")
	}

	// Validate configuration (fail fast on missing required env vars)
	if validationErr := cfg.Validate(); validationErr != nil {
		log.Fatal().Err(validationErr).Msg("Configuration validation failed")
	}

	zerolog.TimeFieldFormat = time.RFC3339Nano
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: "15:04:05.000"})

	setupPWAMimeTypes()

	port := strconv.Itoa(cfg.Server.Port)

	printLogo()
	printServiceInfo(port)

	switch cfg.Server.LogLevel {
	case "debug":
		zerolog.SetGlobalLevel(zerolog.DebugLevel)
	case "info":
		zerolog.SetGlobalLevel(zerolog.InfoLevel)
	case "warn":
		zerolog.SetGlobalLevel(zerolog.WarnLevel)
	case "error":
		zerolog.SetGlobalLevel(zerolog.ErrorLevel)
	default:
		zerolog.SetGlobalLevel(zerolog.InfoLevel)
	}

	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	// Without this, RealIP() returns a raw client-supplied X-Forwarded-For, so
	// rotating that header hands out a fresh rate-limit bucket per request.
	// Walks XFF right-to-left and stops at the first non-private hop.
	e.IPExtractor = echo.ExtractIPFromXFFHeader()

	telemetry := newTelemetry(cfg, selfHost)

	// Request id first: every later middleware, handler log line and error
	// body carries it, so a user-reported failure can be found in the logs.
	e.Use(appmw.RequestIDMiddleware())
	// Metrics next, so it sees the final status of everything below (incl.
	// recovered panics and rate-limit rejections). No-op unless metrics are enabled.
	e.Use(appmw.Metrics(telemetry))
	// Panics reach the central error handler as errors (one log line with
	// the stack, one $exception) instead of being printed by Echo's logger.
	e.Use(middleware.RecoverWithConfig(appmw.RecoverConfig()))
	// Log failed API requests: 4xx/5xx are invisible otherwise, which has
	// hidden silent client-side failures (e.g. backup recording) for weeks.
	e.Use(appmw.RequestLogger(redactURI))
	e.Use(
		middleware.GzipWithConfig(middleware.GzipConfig{
			Skipper: func(c echo.Context) bool {
				// Large WASM assets (DuckDB/ORT) can be served partially by some
				// proxy/client combinations when gzip is enabled, which leads to
				// WebAssembly "section extends past end of module" compile errors.
				return strings.HasSuffix(c.Request().URL.Path, ".wasm")
			},
		}),
	)
	e.Use(appmw.SecurityHeaders(cfg))

	store := middleware.NewRateLimiterMemoryStoreWithConfig(
		middleware.RateLimiterMemoryStoreConfig{
			Rate:      rate.Limit(cfg.RateLimit.RPS),
			Burst:     cfg.RateLimit.Burst,
			ExpiresIn: time.Duration(cfg.RateLimit.ExpiresMin) * time.Minute,
		},
	)
	e.Use(middleware.RateLimiterWithConfig(middleware.RateLimiterConfig{
		Skipper: func(c echo.Context) bool {
			path := c.Request().URL.Path
			if !strings.HasPrefix(path, "/api/") {
				return true
			}
			if strings.HasPrefix(path, "/api/v1/health") {
				return true
			}
			return false
		},
		Store: store,
		IdentifierExtractor: func(ctx echo.Context) (string, error) {
			return ctx.RealIP(), nil
		},
		DenyHandler: func(ctx echo.Context, _ string, _ error) error {
			return ctx.JSON(http.StatusTooManyRequests, map[string]any{
				"message": "rate limit exceeded",
			})
		},
	}))

	// Stricter per-IP limiter for self-host credential endpoints: caps password
	// guessing at ~10/min/IP (burst 10) regardless of the global API limit.
	authStore := middleware.NewRateLimiterMemoryStoreWithConfig(
		middleware.RateLimiterMemoryStoreConfig{
			Rate:      rate.Limit(10.0 / 60.0),
			Burst:     10,
			ExpiresIn: 10 * time.Minute,
		},
	)
	e.Use(middleware.RateLimiterWithConfig(middleware.RateLimiterConfig{
		Skipper: func(c echo.Context) bool {
			path := c.Request().URL.Path
			return path != "/api/v1/auth/local/login" && path != "/api/v1/auth/local/register"
		},
		Store: authStore,
		IdentifierExtractor: func(ctx echo.Context) (string, error) {
			return ctx.RealIP(), nil
		},
		DenyHandler: func(ctx echo.Context, identifier string, err error) error {
			return ctx.JSON(http.StatusTooManyRequests, map[string]any{
				"message": "too many attempts, please try again later",
			})
		},
	}))

	dbConn, dbErr := sqlite.Open()
	if dbErr != nil {
		log.Fatal().Err(dbErr).Msg("Failed to initialize database")
	}

	services := wireServices(dbConn, cfg, selfHost, telemetry)

	// Central error handling: the same statuses and public messages as
	// before plus the request id in every error body; 5xx and panics get one
	// Error log line with the cause and one $exception event (cloud only,
	// see newAnalyticsSender; opted-out users are dropped by the tracker).
	e.HTTPErrorHandler = appmw.ErrorHandler(services.Analytics, appmeta.BuildVersion())

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Bootstrap a first-run admin account when no admin credentials exist yet (self-host only).
	if selfHost {
		bootstrapInitialAdmin(ctx, dbConn, services)
	}

	mutationLog, err := synchub.NewMutationLog(dbConn)
	if err != nil {
		cancel()
		if closeErr := sqlite.Close(dbConn); closeErr != nil {
			log.Error().Err(closeErr).Msg("Failed to close database")
		}
		log.Fatal().Err(err).Msg("Failed to initialize mutation log") //nolint:gocritic // defer is for success path; db closed manually above
	}
	defer func() {
		if err := sqlite.Close(dbConn); err != nil {
			log.Error().Err(err).Msg("Failed to close database")
		}
	}()
	hub := synchub.NewHub(mutationLog)
	hub.SetKeyVersionIncrementer(services.Space) // Allow WebSocket clients to increment encryption key version
	hub.SetTelemetry(telemetry)
	go hub.Run()

	// Email service is SaaS-only. Self-host has no billing / trial and
	// can't ship from the verified domain anyway.
	var emailSvc *emailpkg.Service
	if !selfHost {
		emailStore := emailpkg.NewStore(dbConn)
		svc, err := emailpkg.NewService(cfg, emailStore)
		if err != nil {
			log.Error().Err(err).Msg("Failed to initialize email service (continuing without email)")
		}
		emailSvc = svc

		if emailSvc != nil {
			scheduler := emailpkg.NewScheduler(emailSvc, emailStore)
			go scheduler.Run(context.Background())
		}
	}

	// Keep today's exchange rates warm for recently used currency pairs.
	go application.NewRateRefresher(services.ExchangeRate).Run(context.Background())

	h := handler.NewHandlers(services, hub, handler.Options{
		SelfHost:             selfHost,
		RegistrationDisabled: (config.RegistrationPolicy{DatabasePath: sqlite.ResolvePath(), EnvironmentDisabled: cfg.Features.DisableRegistration}).Disabled,
		Config:               cfg,
		Email:                emailSvc,
		LatestVersion:        newLatestVersionSource(cfg, selfHost),
		Telemetry:            telemetry,
	})
	if !selfHost {
		h.StartProviderSyncLoop(context.Background(), time.Hour)
	}
	routes.SetupRoutes(e, h, services, routes.Options{SelfHost: selfHost, Config: cfg})

	e.Use(pwaStaticMiddleware())

	log.Info().Str("port", port).Msg("Starting server...")

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      e,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
	serveUntilSignal(server, func(ctx context.Context) {
		// Flush the last metrics interval and queued analytics events.
		if closer, ok := services.Analytics.(interface{ Close() }); ok {
			closer.Close()
		}
		if err := telemetry.Shutdown(ctx); err != nil {
			log.Warn().Err(err).Msg("Failed to flush metrics on shutdown")
		}
	})
}

// shutdownTimeout bounds the graceful stop; Docker/Swarm kill after 10s.
const shutdownTimeout = 8 * time.Second

// serveUntilSignal runs server until SIGINT/SIGTERM, then stops accepting
// requests, waits for in-flight ones and runs flush within shutdownTimeout.
func serveUntilSignal(server *http.Server, flush func(ctx context.Context)) {
	errCh := make(chan error, 1)
	go func() { errCh <- server.ListenAndServe() }()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(sigCh)

	select {
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal().Err(err).Msg("Server failed to start") //nolint:gocritic // nothing to flush before the server ever ran
		}
		return
	case sig := <-sigCh:
		log.Info().Str("signal", sig.String()).Msg("Shutting down")
	}

	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Warn().Err(err).Msg("Graceful HTTP shutdown incomplete")
	}
	flush(ctx)
}

// newTelemetry returns the OpenTelemetry metrics recorder for cloud builds
// with OTEL_METRICS_ENABLED, POSTHOG_METRICS_ENDPOINT and POSTHOG_KEY set,
// and a no-op otherwise. Self-host never exports metrics, whatever the env says.
func newTelemetry(cfg *config.Config, selfHost bool) external.Telemetry {
	t, err := otelmetrics.New(context.Background(), otelmetrics.Options{
		Enabled:        cfg.Metrics.Enabled,
		SelfHost:       selfHost || cfg.IsSelfHost(),
		Endpoint:       cfg.Metrics.Endpoint,
		Token:          cfg.Analytics.PostHogKey,
		ServiceVersion: appmeta.BuildVersion(),
	})
	if err != nil {
		log.Error().Err(err).Msg("Server metrics disabled")
		return external.NoopTelemetry{}
	}
	if t.Enabled() {
		log.Info().Msg("Server metrics enabled (OTLP/HTTP, 60s interval)")
	}
	return t
}

const (
	defaultReleaseBucketLatestURL = "https://storage.googleapis.com/budgero_releases/latest.txt"
	defaultCloudVersionURL        = "https://my.budgero.app/api/v1/version/latest"
)

// newLatestVersionSource builds the cached latest-version fetcher, or nil when
// the update check is disabled or APP_LATEST_VERSION pins the answer. On
// self-host the lookup runs at most every 12h and carries only version, build
// sha and type — it is the app's sole unsolicited outbound call, documented as
// such in docs/selfhost-cli.md.
func newLatestVersionSource(cfg *config.Config, selfHost bool) handler.LatestVersionSource {
	if cfg.UpdateCheck.Disabled || appmeta.HasLatestVersionOverride() {
		return nil
	}
	url := cfg.UpdateCheck.URL
	if selfHost {
		if url == "" {
			url = defaultCloudVersionURL
		}
		return updatecheck.NewServerProvider(
			url, appmeta.BuildVersion(), os.Getenv("APP_BUILD_SHA"), "selfhost",
			12*time.Hour, time.Hour,
		)
	}
	if url == "" {
		url = defaultReleaseBucketLatestURL
	}
	return updatecheck.NewBucketProvider(url, 10*time.Minute, time.Minute)
}

// WireServices creates all repositories and services (composition root).
func WireServices(dbConn *sql.DB, cfg *config.Config, selfHost bool) *application.Services {
	return wireServices(dbConn, cfg, selfHost, nil)
}

func wireServices(dbConn *sql.DB, cfg *config.Config, selfHost bool, telemetry external.Telemetry) *application.Services {
	queries := sqlc.New(dbConn)

	repos := &application.Repositories{
		User:             sqlite.NewUserRepository(queries),
		Space:            sqlite.NewSpaceRepository(queries),
		Credential:       sqlite.NewCredentialRepository(queries),
		Entitlement:      sqlite.NewEntitlementRepository(queries),
		Sync:             sqlite.NewSyncRepository(queries),
		Push:             sqlite.NewPushRepository(queries),
		ExchangeRate:     sqlite.NewExchangeRateRepository(queries),
		Activity:         sqlite.NewActivityRepository(dbConn, queries),
		Admin:            sqlite.NewAdminRepository(queries),
		DatabaseBrowser:  sqlite.NewDatabaseBrowserRepository(dbConn),
		Feedback:         sqlite.NewFeedbackRepository(dbConn),
		UpdatePing:       sqlite.NewUpdatePingRepository(dbConn),
		UserPurge:        sqlite.NewUserPurgeRepository(dbConn),
		CurrencyProvider: currencyapi.New(cfg.External.CurrencyAPIBaseURL),
		AnalyticsSender:  newAnalyticsSender(cfg, selfHost),
		Telemetry:        telemetry,
		Queries:          queries,
	}

	return application.NewServices(repos, cfg)
}

// newAnalyticsSender returns the PostHog sender for cloud builds with a key,
// and a no-op otherwise. Self-host never sends analytics, whatever the env says.
func newAnalyticsSender(cfg *config.Config, selfHost bool) external.AnalyticsSender {
	if selfHost || cfg.IsSelfHost() || strings.TrimSpace(cfg.Analytics.PostHogKey) == "" {
		return posthog.Noop{}
	}
	return posthog.NewSender(cfg.Analytics.PostHogHost, strings.TrimSpace(cfg.Analytics.PostHogKey), posthog.DefaultTimeout)
}

func bootstrapInitialAdmin(ctx context.Context, dbConn *sql.DB, services *application.Services) {
	// Check if any admin users exist - if so, skip bootstrap
	// Note: is_admin is in local_credentials table, not users table
	var count int
	if err := dbConn.QueryRow("SELECT COUNT(*) FROM local_credentials WHERE is_admin = 1").Scan(&count); err == nil && count > 0 {
		return
	}

	// Generate a secure random password
	password := generateSecurePassword(16)

	// Create the admin user with username "admin"
	createLocalUser := application.NewCreateLocalUserUsecase(services.User, services.Credential)
	user, err := createLocalUser.Execute(ctx, "Admin", "admin", password, true)
	if err != nil {
		log.Error().Err(err).Msg("Failed to create initial admin user")
		return
	}

	// Display the generated credentials once — they will not be shown again.
	fmt.Println()
	fmt.Println("╔═══════════════════════════════════════════════════════════════════════╗")
	fmt.Println("║                     🔐 FIRST-TIME SETUP                               ║")
	fmt.Println("╚═══════════════════════════════════════════════════════════════════════╝")
	fmt.Println()
	fmt.Printf("  Admin account created:\n")
	fmt.Printf("    Username: %s\n", user.Email)
	fmt.Printf("    Password: %s\n", password)
	fmt.Println()
	fmt.Println("  ⚠️  Save this password now - it will NOT be shown again.")
	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════════════════")
	fmt.Println()
}

func generateSecurePassword(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, length)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		b[i] = charset[n.Int64()]
	}
	return string(b)
}

func printLogo() {
	paths := []string{"ascii_logo.txt", "packages/server/ascii_logo.txt", "../server/ascii_logo.txt"}
	for _, path := range paths {
		if data, err := os.ReadFile(path); err == nil { //nolint:gosec // G304: paths are hardcoded constants
			fmt.Print(string(data))
			fmt.Println()
			return
		}
	}
	fmt.Println()
	fmt.Println("╔════════════════════════════════════════════════════════════════════════╗")
	fmt.Println("║           BUDGERO SERVER               ║")
	fmt.Println("╚════════════════════════════════════════════════════════════════════════╝")
}

func printServiceInfo(port string) {
	fmt.Println()
	fmt.Println("╔═══════════════════════════════════════════════════════════════════════╗")
	fmt.Println("║                     🚀 BUDGERO SERVER STARTING 🚀                     ║")
	fmt.Println("╚═══════════════════════════════════════════════════════════════════════╝")
	fmt.Println()
	fmt.Printf("  📡 API Server:        http://localhost:%s/api/v1\n", port)
	fmt.Printf("  🌐 Web Application:   http://localhost:%s\n", port)
	fmt.Printf("  🔄 WebSocket Sync:    ws://localhost:%s/api/v1/sync\n", port)
	fmt.Printf("  ❤️  Health Check:     http://localhost:%s/api/v1/health\n", port)
	fmt.Println()
	fmt.Println("╔═══════════════════════════════════════════════════════════════════════╗")
	fmt.Println("║                    Press Ctrl+C to stop the server                    ║")
	fmt.Println("╚═══════════════════════════════════════════════════════════════════════╝")
	fmt.Println()
}

func setupPWAMimeTypes() {
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

func openEmbeddedAsset(path string) (fs.File, error) {
	file, err := serverpkg.WebAssets.Open("dist" + path)
	if err == nil {
		return file, nil
	}
	return serverpkg.WebAssets.Open("dist-fallback" + path)
}

func pwaStaticMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if strings.HasPrefix(c.Request().URL.Path, "/api/") {
				return next(c)
			}
			path := c.Request().URL.Path
			if path == "/" {
				path = "/index.html"
			}
			file, err := openEmbeddedAsset(path)
			if err != nil {
				if strings.HasSuffix(path, "/") || !strings.Contains(path, ".") {
					file, err = openEmbeddedAsset("/index.html")
					if err != nil {
						return next(c)
					}
					path = "/index.html"
				} else {
					return next(c)
				}
			}
			defer func() { _ = file.Close() }()
			setPWAHeaders(c, path)
			return c.Stream(http.StatusOK, getContentType(path), file)
		}
	}
}

func setPWAHeaders(c echo.Context, path string) {
	switch {
	case strings.HasSuffix(path, "/sw.js") || strings.Contains(path, "workbox"):
		c.Response().Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		c.Response().Header().Set("Pragma", "no-cache")
		c.Response().Header().Set("Expires", "0")
		c.Response().Header().Set("Service-Worker-Allowed", "/")
	case strings.HasSuffix(path, ".html"):
		// The HTML shell points at hashed assets and must be revalidated so a
		// deployment can publish a new entrypoint without leaving clients on a
		// stale PWA shell for the asset cache lifetime.
		c.Response().Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	case strings.HasSuffix(path, ".webmanifest"):
		c.Response().Header().Set("Cache-Control", "public, max-age=86400")
	default:
		c.Response().Header().Set("Cache-Control", "public, max-age=31536000")
	}
	c.Response().Header().Set("X-Content-Type-Options", "nosniff")
	c.Response().Header().Set("X-Frame-Options", "DENY")
}

func getContentType(path string) string {
	switch {
	case strings.HasSuffix(path, ".webmanifest"):
		return "application/manifest+json"
	case strings.HasSuffix(path, ".js"):
		return "application/javascript"
	case strings.HasSuffix(path, ".css"):
		return "text/css"
	case strings.HasSuffix(path, ".html"):
		return "text/html; charset=utf-8"
	case strings.HasSuffix(path, ".wasm"):
		return "application/wasm"
	}
	if idx := strings.LastIndex(path, "."); idx >= 0 {
		if ct := mime.TypeByExtension(strings.ToLower(path[idx:])); ct != "" {
			return ct
		}
	}
	return "application/octet-stream"
}

// redactURI keeps bank relay tickets (bearer capabilities that also name the
// user) out of the logs. The relay records counters only.
func redactURI(uri string) string {
	const relayPrefix = "/api/v1/bank-relay/"
	path, _, _ := strings.Cut(uri, "?")
	if strings.HasPrefix(path, relayPrefix) && path != relayPrefix+"ticket" {
		return relayPrefix + "[redacted]"
	}
	return uri
}
