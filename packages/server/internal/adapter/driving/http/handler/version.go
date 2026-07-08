package handler

import (
	"net/http"

	"budgero-server/internal/appmeta"

	"github.com/labstack/echo/v4"
)

// GetLatestVersion exposes the server's latest app version metadata.
func (h *Handlers) GetLatestVersion(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]string{
		"latest_version": appmeta.LatestVersion(),
		"build_version":  appmeta.BuildVersion(),
	})
}
