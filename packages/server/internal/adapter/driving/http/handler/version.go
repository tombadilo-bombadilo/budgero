package handler

import (
	"context"
	"net/http"

	"budgero-server/internal/appmeta"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"
)

// LatestVersionSource resolves the latest published app version, typically
// backed by a cached remote fetch. ok=false means "no fresh answer" and the
// handler falls back to appmeta's env-override / build-version chain.
type LatestVersionSource interface {
	Latest(ctx context.Context) (string, bool)
}

// GetLatestVersion exposes the server's latest app version metadata. On SaaS
// this endpoint doubles as the anonymous update-ping sink: self-host servers
// call it with version/build/type query params, which are aggregated into
// daily counters. Nothing beyond those three strings is recorded.
func (h *Handlers) GetLatestVersion(c echo.Context) error {
	latest := appmeta.LatestVersion()
	if h.latestVersion != nil {
		if v, ok := h.latestVersion.Latest(c.Request().Context()); ok {
			latest = v
		}
	}

	if !h.selfHostMode {
		h.recordUpdatePing(c)
	}

	return c.JSON(http.StatusOK, map[string]string{
		"latest_version": latest,
		"build_version":  appmeta.BuildVersion(),
	})
}

// recordUpdatePing counts one update check. Requests without query params are
// our own frontend polling; requests with them are remote self-host servers.
// Never fails the response — a lost ping is an analytics gap, not an error.
func (h *Handlers) recordUpdatePing(c echo.Context) {
	clientType := c.QueryParam("type")
	version := c.QueryParam("version")
	build := c.QueryParam("build")
	if clientType == "" {
		clientType = "saas"
		version = appmeta.BuildVersion()
		build = ""
	}
	if err := h.services.UpdatePing.Record(c.Request().Context(), version, build, clientType); err != nil {
		log.Debug().Err(err).Msg("failed to record update ping")
	}
}
