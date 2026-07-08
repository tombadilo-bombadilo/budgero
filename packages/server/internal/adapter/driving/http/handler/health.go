package handler

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

// HealthCheck returns the service health status.
func (h *Handlers) HealthCheck(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]string{
		"status":  "healthy",
		"service": "zero-budget-web",
	})
}
