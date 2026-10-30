package handler

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"budgero-server/internal/adapter/driving/http/middleware"
	synchub "budgero-server/internal/adapter/driving/http/websocket"
	"budgero-server/internal/config"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/external"

	clerkjwt "github.com/clerk/clerk-sdk-go/v2/jwt"
	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"
)

const defaultDevURL = "http://localhost:5173"

// getAllowedOrigins returns a list of allowed origins for WebSocket connections
func getAllowedOrigins(cfg *config.Config) []string {
	// Get allowed origins from config
	if len(cfg.WebSocket.AllowedOrigins) > 0 {
		return cfg.WebSocket.AllowedOrigins
	}

	// Default allowed origins based on APP_URL
	appURL := cfg.Server.AppURL
	if appURL == "" {
		appURL = defaultDevURL
	}

	// Parse APP_URL to get base domain
	parsedURL, err := url.Parse(appURL)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to parse APP_URL, using defaults")
		return []string{defaultDevURL, "http://localhost:3001"}
	}

	// Build list of allowed origins
	allowedOrigins := []string{appURL}

	// Add common development origins if running locally
	if strings.Contains(parsedURL.Host, "localhost") || strings.Contains(parsedURL.Host, "127.0.0.1") {
		allowedOrigins = append(allowedOrigins,
			defaultDevURL,
			"http://localhost:3001",
			"http://127.0.0.1:5173",
			"http://127.0.0.1:3001",
		)
	}

	// Add production domain variations
	if !strings.Contains(parsedURL.Host, "localhost") && !strings.Contains(parsedURL.Host, "127.0.0.1") {
		// Add both http and https versions
		if parsedURL.Scheme == "https" {
			allowedOrigins = append(allowedOrigins, "http://"+parsedURL.Host)
		} else {
			allowedOrigins = append(allowedOrigins, "https://"+parsedURL.Host)
		}

		// Add www variant if not present
		if !strings.HasPrefix(parsedURL.Host, "www.") {
			allowedOrigins = append(allowedOrigins,
				parsedURL.Scheme+"://www."+parsedURL.Host,
			)
		}
	}

	return allowedOrigins
}

// isOriginAllowed checks if the origin is in the allowed list.
func isOriginAllowed(origin string, allowedOrigins []string, isSelfHost bool) bool {
	// Self-host with no explicit allow-list: trust all origins (LAN use, the
	// operator controls the network). If WEBSOCKET_ALLOWED_ORIGINS is set, honor
	// it even in self-host so an internet-exposed instance can lock this down.
	if isSelfHost && len(allowedOrigins) == 0 {
		return true
	}
	for _, allowed := range allowedOrigins {
		if origin == allowed {
			return true
		}
	}
	return false
}

// getUpgrader returns a WebSocket upgrader configured with the given config
func getUpgrader(cfg *config.Config) websocket.Upgrader {
	return websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			allowedOrigins := getAllowedOrigins(cfg)
			isSelfHost := cfg.Auth.SelfHostable

			allowed := isOriginAllowed(origin, allowedOrigins, isSelfHost)

			if !allowed {
				log.Warn().
					Str("origin", origin).
					Strs("allowed_origins", allowedOrigins).
					Msg("WebSocket connection rejected due to CORS")
			}

			return allowed
		},
	}
}

// WebSocketHandler handles WebSocket connections for real-time sync notifications
func (h *Handlers) WebSocketHandler(c echo.Context) error {
	defer func() {
		if r := recover(); r != nil {
			log.Error().Interface("panic", r).Msg("WebSocket handler panicked")
		}
	}()
	log.Info().
		Str("method", c.Request().Method).
		Str("path", c.Request().URL.Path).
		Str("remote_addr", c.Request().RemoteAddr).
		Msg("WebSocket handler called")

	// Try to get user ID from context first (for normal auth middleware)
	userID := middleware.GetUserIDFromContext(c)
	log.Debug().Str("user_id_from_context", userID).Msg("Checking user ID from context")

	// If not found, try to get token from query params (WebSocket doesn't support headers)
	if userID == "" {
		token := c.QueryParam("token")
		log.Debug().
			Bool("has_token", token != "").
			Msg("Checking token from query params")

		if token != "" {
			claims, err := h.verifyWebsocketToken(c, token)
			if err != nil {
				log.Error().Err(err).Msg("Failed to verify WebSocket token from query params")
			} else {
				userID = claims.Subject
				log.Info().Str("user_id", userID).Msg("Successfully verified WebSocket token")
			}
		}
	}

	if userID == "" {
		log.Warn().Msg("WebSocket connection attempt without authentication")
		h.telemetry.WSConnectAttempt(external.WSOutcomeUnauthenticated)
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()

	// This route sits outside the auth middleware chain, so it applies the
	// block check itself (both Clerk and self-host tokens land here).
	if err := middleware.CheckNotBlocked(ctx, h.services.User, userID); err != nil {
		log.Warn().Err(err).Str("user_id", userID).Msg("WebSocket connection rejected: account blocked or status unavailable")
		h.telemetry.WSConnectAttempt(wsOutcomeForError(err, external.WSOutcomeBlocked))
		return err
	}
	spaceParam := c.QueryParam("space_id")
	spaceID, err := h.ensureWorkspaceAccess(ctx, userID, spaceParam)
	if err != nil {
		log.Error().Err(err).Str("user_id", userID).Str("space_param", spaceParam).Msg("Failed to authorize workspace for WebSocket connection")
		h.telemetry.WSConnectAttempt(wsOutcomeForError(err, external.WSOutcomeForbidden))
		return err
	}

	// Refuse mutation streams from clients that don't understand this space's
	// data format (see data_format.go) — their ops would carry mis-scaled
	// amounts. Spaces without a blob yet default to format 1 (no gate); any
	// other metadata error fails closed rather than risking format skew.
	blob, blobErr := h.services.Space.GetBlobMetadata(ctx, userID, spaceID)
	switch {
	case blobErr == nil:
		if gateErr := requireFormatSupport(c, blob.DataFormatVersion); gateErr != nil {
			log.Warn().
				Str("user_id", userID).
				Str("space_id", spaceID).
				Int64("blob_format", blob.DataFormatVersion).
				Int64("client_format", clientSupportedFormat(c)).
				Msg("WebSocket rejected: client does not support space data format")
			h.telemetry.WSConnectAttempt(external.WSOutcomeUpgradeRequired)
			return gateErr
		}
	case errors.Is(blobErr, domain.ErrSpaceNotFound):
		// No blob yet — nothing to gate.
	default:
		h.telemetry.WSConnectAttempt(external.WSOutcomeError)
		return internalErr("failed to verify space data format", fmt.Errorf("blob metadata for space %s: %w", spaceID, blobErr))
	}

	log.Info().
		Str("user_id", userID).
		Str("space_id", spaceID).
		Msg("Attempting to upgrade connection to WebSocket")

	// Upgrade HTTP connection to WebSocket
	upgrader := getUpgrader(h.cfg)
	ws, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		log.Error().
			Err(err).
			Str("user_id", userID).
			Str("space_id", spaceID).
			Msg("Failed to upgrade connection to WebSocket")
		h.telemetry.WSConnectAttempt(wsUpgradeOutcome(err))
		return err
	}

	// Create client and register with hub
	client := synchub.NewClient(h.syncHub, ws, userID, spaceID)
	h.syncHub.Register <- client

	// Start the write pump FIRST so it can send our initial data
	go client.WritePump()

	// Give the write pump a moment to start
	time.Sleep(50 * time.Millisecond)

	// Send initial sync state and database if it exists
	state, err := h.services.Space.GetSyncState(ctx, userID, spaceID)

	if err == nil {
		// Send sync state notification
		initialMsg := &synchub.Message{
			Type:    "sync_state_changed",
			UserID:  userID,
			SpaceID: spaceID,
			Version: state.Version,
			Hash:    state.Hash,
		}

		if !h.syncHub.TrySend(client, initialMsg) {
			log.Warn().Str("user_id", userID).Msg("Failed to send initial sync state")
		}

		// Note: Database blobs no longer sent via WebSocket - clients use HTTP Layer 2 endpoints
	} else {
		log.Warn().
			Str("user_id", userID).
			Err(err).
			Msg("Failed to get sync state")
	}

	// Re-check now that the client is registered: a block that landed while
	// this connection was being set up would have missed it when BlockUser
	// closed the user's sockets.
	if err := middleware.CheckNotBlocked(ctx, h.services.User, userID); err != nil {
		log.Warn().Err(err).Str("user_id", userID).Msg("Closing WebSocket: account blocked during connect")
		h.telemetry.WSConnectAttempt(wsOutcomeForError(err, external.WSOutcomeBlocked))
		h.syncHub.CloseClient(client, websocket.ClosePolicyViolation, synchub.CloseReasonBlocked)
		return nil
	}
	h.telemetry.WSConnectAttempt(external.WSOutcomeOK)

	// Run the read pump in this goroutine (blocks until disconnect)
	// This keeps the handler alive until the client disconnects
	// WritePump was already started above before sending initial data
	client.ReadPump()
	return nil
}

func (h *Handlers) verifyWebsocketToken(c echo.Context, token string) (*authClaims, error) {
	return h.verifyWebsocketTokenWithRetry(c, token, 0)
}

const maxTokenVerifyRetries = 3

func (h *Handlers) verifyWebsocketTokenWithRetry(c echo.Context, token string, attempt int) (*authClaims, error) {
	if h.selfHostMode {
		claims, err := middleware.ParseSelfHostToken(token)
		if err != nil {
			return nil, err
		}
		return &authClaims{Subject: claims.Subject}, nil
	}
	if err := middleware.CheckClerkTokenSize(token); err != nil {
		return nil, err
	}
	claims, err := clerkjwt.Verify(c.Request().Context(), &clerkjwt.VerifyParams{Token: token})
	if err != nil {
		errStr := strings.ToLower(err.Error())
		// Handle clock skew: token "issued in the future" due to clock drift
		if (strings.Contains(errStr, "issued in the future") || strings.Contains(errStr, "iat")) && attempt < maxTokenVerifyRetries {
			time.Sleep(1200 * time.Millisecond)
			return h.verifyWebsocketTokenWithRetry(c, token, attempt+1)
		}
		return nil, err
	}
	return &authClaims{Subject: claims.Subject}, nil
}

type authClaims struct {
	Subject string
}

// wsOutcomeForError maps a connect-time error onto a bounded outcome: the
// status says which kind of refusal it was, and anything 5xx is an error.
func wsOutcomeForError(err error, refused external.WSOutcome) external.WSOutcome {
	var he *echo.HTTPError
	if !errors.As(err, &he) {
		return external.WSOutcomeError
	}
	switch he.Code {
	case http.StatusUnauthorized:
		return external.WSOutcomeUnauthenticated
	case http.StatusForbidden:
		return refused
	case http.StatusNotFound, http.StatusPaymentRequired:
		return external.WSOutcomeForbidden
	case http.StatusUpgradeRequired:
		return external.WSOutcomeUpgradeRequired
	default:
		return external.WSOutcomeError
	}
}

// wsUpgradeOutcome classifies a failed upgrade; a rejected Origin is a
// forbidden attempt (usually WEBSOCKET_ALLOWED_ORIGINS), the rest are errors.
func wsUpgradeOutcome(err error) external.WSOutcome {
	var he websocket.HandshakeError
	if errors.As(err, &he) && strings.Contains(err.Error(), "origin") {
		return external.WSOutcomeForbidden
	}
	return external.WSOutcomeError
}
