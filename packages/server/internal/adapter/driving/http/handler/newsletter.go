package handler

import (
	"net/http"

	"budgero-server/internal/adapter/driven/mailerlite"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"
)

// NewsletterSignup handles newsletter subscription requests
func (h *Handlers) NewsletterSignup(c echo.Context) error {
	var req struct {
		Email string `json:"email" validate:"required,email"`
		Name  string `json:"name"`
	}

	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request")
	}

	client := mailerlite.NewClient(h.cfg.External.MailerLiteAPIKey, h.cfg.External.MailerLiteGroupID)
	status, err := client.AddSubscriber(req.Email, req.Name)
	if err != nil {
		if status == http.StatusConflict {
			log.Info().Str("email", req.Email).Msg("Newsletter signup attempted for existing subscriber")
			return c.JSON(http.StatusOK, map[string]interface{}{
				"success": true,
				"message": "You're already subscribed to the newsletter",
				"status":  "already_subscribed",
			})
		}

		log.Error().Err(err).Str("email", req.Email).Msg("Failed to subscribe to newsletter")
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to subscribe to newsletter")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Successfully subscribed to newsletter",
	})
}
