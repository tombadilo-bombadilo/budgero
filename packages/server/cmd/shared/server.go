// Package shared provides common server startup and configuration logic
// used by both cloud and self-hosted deployments.
package shared //nolint:revive // var-naming: package is shared between cloud and selfhost commands

import (
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
	"io/fs"
	"math/big"
	"mime"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	serverpkg "budgero-server"
	"budgero-server/internal/adapter/driven/lemonsqueezy"
	"budgero-server/internal/adapter/driven/sqlite"
	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/adapter/driving/http/handler"
	appmw "budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/adapter/driving/http/routes"
	synchub "budgero-server/internal/adapter/driving/http/websocket"
	"budgero-server/internal/application"
	emailpkg "budgero-server/internal/application/email"
	"budgero-server/internal/config"

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

	e.Use(middleware.Recover())
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
		DenyHandler: func(ctx echo.Context, identifier string, err error) error {
			return ctx.JSON(http.StatusTooManyRequests, map[string]any{
				"message":    "rate limit exceeded",
				"identifier": identifier,
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

	services := WireServices(dbConn, cfg, selfHost)

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
			// Wire the email service into the trial-rewards service so
			// tier-unlock emails fire when a user reaches a level. Same
			// late-injection pattern as ClerkSync.
			if trs, ok := services.TrialRewards.(*application.TrialRewardsService); ok {
				trs.SetEmailService(emailSvc)
			}
		}
	}

	h := handler.NewHandlers(services, hub, handler.Options{SelfHost: selfHost, Config: cfg, Email: emailSvc})
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
	log.Fatal().Err(server.ListenAndServe()).Msg("Server failed to start")
}

// WireServices creates all repositories and services (composition root).
func WireServices(dbConn *sql.DB, cfg *config.Config, selfHost bool) *application.Services {
	queries := sqlc.New(dbConn)

	repos := &application.Repositories{
		User:            sqlite.NewUserRepository(queries),
		Space:           sqlite.NewSpaceRepository(queries),
		Credential:      sqlite.NewCredentialRepository(queries),
		Entitlement:     sqlite.NewEntitlementRepository(queries),
		Sync:            sqlite.NewSyncRepository(queries),
		Push:            sqlite.NewPushRepository(queries),
		ExchangeRate:    sqlite.NewExchangeRateRepository(queries),
		Activity:        sqlite.NewActivityRepository(dbConn, queries),
		Admin:           sqlite.NewAdminRepository(queries),
		DatabaseBrowser: sqlite.NewDatabaseBrowserRepository(dbConn),
		TrialRewards:    sqlite.NewTrialRewardsRepository(queries),
		Feedback:        sqlite.NewFeedbackRepository(dbConn),
		Queries:         queries,
	}

	// Wire the LemonSqueezy-backed discount issuer for SaaS only. Self-host
	// has no payment provider, so the issuer stays nil and the trial-rewards
	// service mints local codes only (the rewards endpoints are gated off in
	// self-host anyway).
	if !selfHost {
		lsClient := lemonsqueezy.NewClientWithConfig(cfg)
		lsCache := lemonsqueezy.NewProductCache(lsClient)
		repos.DiscountIssuer = lemonsqueezy.NewDiscountIssuer(lsClient, lsCache)
	}

	return application.NewServices(repos, cfg)
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
