package handler

import (
	"errors"
	"net"
	"net/http"

	"budgero-server/internal/adapter/driving/http/bankrelay"
	"budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/domain/analytics"

	"github.com/labstack/echo/v4"
)

// IssueBankRelayTicket exchanges the session JWT for a short-lived ticket
// that opens the bank relay WebSocket. It also echoes the caller's IP, which
// the client forwards (inside the TLS tunnel) as the PSU IP header so banks
// treat syncs as user-present fetches.
func (h *Handlers) IssueBankRelayTicket(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	ticket, expires, err := h.bankRelay.IssueTicket(userID)
	if errors.Is(err, bankrelay.ErrThrottled) {
		h.track(userID, analytics.BankRelayFailed(analytics.BankProviderEnableBanking, analytics.BankRelayErrThrottled))
		return echo.NewHTTPError(http.StatusTooManyRequests, "bank relay rate limit exceeded")
	}
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to issue relay ticket")
	}
	return c.JSON(http.StatusOK, map[string]any{
		"ticket":     ticket,
		"expires_at": expires.UTC(),
		"client_ip":  resolveClientIP(h.cfg.Server.SelfHostPublicIP, c.RealIP()),
	})
}

// resolveClientIP prefers an operator-configured public IP (SELF_HOST_PUBLIC_IP)
// over RealIP(), for reverse-proxy chains that never forward the end user's
// true public IP down to the app (see SELF_HOST_PUBLIC_IP in docs/build-flags.md).
// The override may be a DDNS hostname (common for residential connections
// with a rotating IP) — it's resolved fresh on every call rather than once
// at startup, since a cached value would go stale the next time the ISP
// reassigns the address.
func resolveClientIP(override, realIP string) string {
	if override == "" {
		return realIP
	}
	if net.ParseIP(override) != nil {
		return override
	}
	addrs, err := net.LookupHost(override)
	if err != nil || len(addrs) == 0 {
		return realIP
	}
	for _, addr := range addrs {
		if ip := net.ParseIP(addr); ip != nil && ip.To4() != nil {
			return addr
		}
	}
	return addrs[0]
}

// BankRelay upgrades to a Wisp WebSocket that only reaches the bank
// aggregator. The ticket sits in the path because libcurl.js appends nothing
// to the proxy URL and browsers can't set WebSocket headers.
func (h *Handlers) BankRelay(c echo.Context) error {
	// Invalid tickets have no user to attribute, so only valid ones are tracked.
	userID, release, err := h.bankRelay.AcquireUser(c.Param("ticket"))
	if errors.Is(err, bankrelay.ErrThrottled) {
		h.track(userID, analytics.BankRelayFailed(analytics.BankProviderEnableBanking, analytics.BankRelayErrThrottled))
		return echo.NewHTTPError(http.StatusTooManyRequests, "too many bank relay sessions")
	}
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "invalid relay ticket")
	}
	defer release()

	upgrader := getUpgrader(h.cfg)
	ws, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		h.track(userID, analytics.BankRelayFailed(analytics.BankProviderEnableBanking, analytics.BankRelayErrUpgradeFailed))
		return nil //nolint:nilerr // Upgrade already wrote the error response.
	}
	h.bankRelay.Serve(c.Request().Context(), ws)
	h.track(userID, analytics.BankRelayOK(analytics.BankProviderEnableBanking))
	return nil
}
