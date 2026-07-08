package handler

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/domain"
	"budgero-server/internal/pkg/crypto"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"
)

// PushPayload represents the expected payload format for push API.
type PushPayload struct {
	EncryptedPayload string `json:"encrypted_payload"`
	MessageID        string `json:"message_id,omitempty"`
}

// PushTokenResponse is returned when generating a new token.
type PushTokenResponse struct {
	Token     string    `json:"token"`
	SpaceID   string    `json:"space_id"`
	CreatedAt time.Time `json:"created_at"`
	IsEnabled bool      `json:"is_enabled"`
}

// GeneratePushToken creates or regenerates a push API token for the user.
func (h *Handlers) GeneratePushToken(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	token, spaceID, err := h.usecases.GeneratePushToken.Execute(ctx, userID)
	if err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("Failed to generate push API token")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to generate token")
	}

	log.Info().Str("user_id", userID).Str("space_id", spaceID).Msg("Generated new push API token")

	return c.JSON(http.StatusOK, PushTokenResponse{
		Token:     token,
		SpaceID:   spaceID,
		CreatedAt: time.Now(),
		IsEnabled: true,
	})
}

// GetPushTokenStatus returns the status of the user's push API token.
func (h *Handlers) GetPushTokenStatus(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	status, err := h.services.Push.GetTokenStatus(ctx, userID)
	if err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("Failed to get push token status")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get token status")
	}

	return c.JSON(http.StatusOK, status)
}

// TogglePushToken enables or disables the push API token.
func (h *Handlers) TogglePushToken(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	ctx := c.Request().Context()
	if err := h.services.Push.SetTokenEnabled(ctx, userID, req.Enabled); err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("Failed to toggle push token")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update token")
	}

	log.Info().Str("user_id", userID).Bool("enabled", req.Enabled).Msg("Toggled push API token")

	return c.JSON(http.StatusOK, map[string]bool{"enabled": req.Enabled})
}

// RevokePushToken deletes the user's push API token.
func (h *Handlers) RevokePushToken(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	if err := h.services.Push.RevokeToken(ctx, userID); err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("Failed to revoke push token")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to revoke token")
	}

	log.Info().Str("user_id", userID).Msg("Revoked push API token")

	return c.JSON(http.StatusOK, map[string]string{"status": "revoked"})
}

// PushMutation receives an encrypted mutation payload via push API.
func (h *Handlers) PushMutation(c echo.Context) error {
	// Extract token from Authorization header
	authHeader := c.Request().Header.Get("Authorization")
	if authHeader == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "missing authorization header")
	}

	// Expect "Bearer <token>" format
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
		return echo.NewHTTPError(http.StatusUnauthorized, "invalid authorization format")
	}
	token := parts[1]

	// Hash the token and validate
	tokenHash := crypto.HashToken(token)
	ctx := c.Request().Context()

	userID, spaceID, err := h.services.Push.ValidateTokenByHash(ctx, tokenHash)
	if err != nil {
		if errors.Is(err, domain.ErrInvalidCredentials) {
			return echo.NewHTTPError(http.StatusUnauthorized, "invalid token")
		}
		if strings.Contains(err.Error(), "disabled") {
			return echo.NewHTTPError(http.StatusForbidden, "push API is disabled for this account")
		}
		log.Error().Err(err).Msg("Failed to validate push token")
		return echo.NewHTTPError(http.StatusInternalServerError, "token validation failed")
	}

	// Parse the payload
	var payload PushPayload
	if err = c.Bind(&payload); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	if payload.EncryptedPayload == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "encrypted_payload is required")
	}

	messageID := strings.TrimSpace(payload.MessageID)

	// Check for duplicate message ID
	if messageID != "" {
		var existingID, existingStatus string
		var exists bool
		existingID, existingStatus, exists, err = h.services.Push.CheckDuplicateMessage(ctx, spaceID, messageID)
		if err != nil {
			log.Error().Err(err).Msg("Failed to check duplicate message_id")
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to validate request")
		}
		if exists {
			return echo.NewHTTPError(http.StatusConflict, fmt.Sprintf("duplicate message_id; existing item %s (%s)", existingID, existingStatus))
		}
	}

	// Queue the mutation
	queueID, err := h.services.Push.QueueMutation(ctx, userID, spaceID, messageID, payload.EncryptedPayload)
	if err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("Failed to queue push mutation")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to queue mutation")
	}

	log.Info().
		Str("queue_id", queueID).
		Str("user_id", userID).
		Str("space_id", spaceID).
		Str("message_id", messageID).
		Msg("Push mutation queued")

	return c.JSON(http.StatusAccepted, map[string]string{
		"id":      queueID,
		"status":  "queued",
		"message": "Mutation queued for processing",
	})
}

// GetPushQueue retrieves pending items from the push queue for the authenticated user.
func (h *Handlers) GetPushQueue(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	spaceID := c.QueryParam("space_id")
	ctx := c.Request().Context()

	items, err := h.services.Push.ListPendingItems(ctx, userID, spaceID)
	if err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("Failed to query push queue")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get queue")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"items": items,
		"count": len(items),
	})
}

// AckPushQueueItem marks a push queue item as processed.
func (h *Handlers) AckPushQueueItem(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	queueID := c.Param("id")
	if queueID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "queue item ID required")
	}

	var req struct {
		Status string `json:"status"`
	}
	if err := c.Bind(&req); err != nil {
		req.Status = "processed"
	}

	ctx := c.Request().Context()
	if err := h.services.Push.AckItem(ctx, userID, queueID, req.Status); err != nil {
		log.Error().Err(err).Str("queue_id", queueID).Msg("Failed to ack push queue item")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to acknowledge item")
	}

	log.Info().
		Str("queue_id", queueID).
		Str("user_id", userID).
		Str("status", req.Status).
		Msg("Push queue item acknowledged")

	return c.JSON(http.StatusOK, map[string]string{
		"id":     queueID,
		"status": req.Status,
	})
}

// GetPushQueueStats returns statistics about the push queue for the user.
func (h *Handlers) GetPushQueueStats(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	stats, err := h.services.Push.GetStats(ctx, userID)
	if err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("Failed to get push queue stats")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get stats")
	}

	return c.JSON(http.StatusOK, stats)
}

// ClearPushQueue clears all pending items from the push queue for the user.
func (h *Handlers) ClearPushQueue(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	// Optional flag to clear all statuses, not just pending
	clearAll := false
	if v := c.QueryParam("all"); v != "" {
		lower := strings.ToLower(strings.TrimSpace(v))
		clearAll = lower == "1" || lower == "true" || lower == "yes"
	}

	ctx := c.Request().Context()
	deleted, err := h.services.Push.ClearQueue(ctx, userID, clearAll)
	if err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("Failed to clear push queue")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to clear queue")
	}

	log.Info().Str("user_id", userID).Int64("deleted", deleted).Msg("Cleared push queue")

	return c.JSON(http.StatusOK, map[string]interface{}{
		"status":  "cleared",
		"deleted": deleted,
	})
}

// GetPushEncryptionInfo returns the encryption key info for the user.
func (h *Handlers) GetPushEncryptionInfo(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	spaceID, hasToken, err := h.usecases.GetPushEncryptionInfo.Execute(ctx, userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"space_id":  spaceID,
		"has_token": hasToken,
		"info": map[string]string{
			"algorithm":         "AES-GCM",
			"key_derivation":    "The same key used for your budget encryption",
			"payload_format":    "JSON with op and args fields, then encrypted",
			"encoding":          "Base64",
			"supported_opcodes": "transactions.add",
		},
	})
}

// GetPushAPISpec returns the API specification for the push endpoint.
func (h *Handlers) GetPushAPISpec(c echo.Context) error {
	spec := map[string]interface{}{
		"version": "2.0",
		"endpoint": map[string]string{
			"url":    "/api/v1/push",
			"method": "POST",
		},
		"authentication": map[string]string{
			"type":   "Bearer",
			"header": "Authorization: Bearer <your-api-token>",
		},
		"request_body": map[string]interface{}{
			"encrypted_payload": map[string]string{
				"type":        "string",
				"format":      "base64",
				"description": "Base64-encoded AES-GCM encrypted JSON payload",
			},
			"message_id": map[string]string{
				"type":        "string",
				"description": "Optional client-generated message ID to prevent duplicate pushes",
			},
		},
		"payload_format": map[string]interface{}{
			"description": "The decrypted payload should be JSON with the following structure. Monetary values are integer milliunits (1/1000 currency unit; 25.50 -> 25500).",
			"schema": map[string]interface{}{
				"v": map[string]string{
					"type":        "integer",
					"description": "Data format version; send 2. Payloads without this field are treated as legacy format 1 (decimal amounts) and upgraded on import.",
				},
				"op": map[string]string{
					"type":        "string",
					"description": "Operation code (e.g., 'transactions.add')",
				},
				"args": map[string]string{
					"type":        "object",
					"description": "Operation-specific arguments",
				},
			},
		},
		"supported_operations": map[string]interface{}{
			"transactions.add": map[string]interface{}{
				"description": "Add a new transaction",
				"args": map[string]interface{}{
					"inflow":     map[string]string{"type": "integer", "description": "Income amount in integer milliunits (use 0 for expenses)"},
					"outflow":    map[string]string{"type": "integer", "description": "Expense amount in integer milliunits (use 0 for income)"},
					"accountId":  map[string]string{"type": "integer", "description": "Account ID"},
					"categoryId": map[string]string{"type": "integer", "description": "Category ID"},
					"budgetId":   map[string]string{"type": "integer", "description": "Budget ID"},
					"date":       map[string]string{"type": "string", "format": "YYYY-MM-DD", "description": "Transaction date"},
					"memo":       map[string]string{"type": "string", "description": "Transaction description/memo"},
					"payee":      map[string]string{"type": "string", "description": "Payee name (optional)"},
				},
			},
		},
		"encryption": map[string]interface{}{
			"algorithm":  "AES-256-GCM",
			"key_source": "Your budget encryption key (same key used by the Budgero app)",
			"iv_length":  12,
			"tag_length": 16,
			"format":     "IV (12 bytes) + Ciphertext + Auth Tag (16 bytes), then Base64 encoded",
		},
		"responses": map[string]interface{}{
			"202": map[string]string{
				"description": "Mutation accepted and queued",
			},
			"400": map[string]string{
				"description": "Invalid request body",
			},
			"401": map[string]string{
				"description": "Invalid or missing API token",
			},
			"403": map[string]string{
				"description": "Push API disabled for this account",
			},
		},
	}

	return c.JSON(http.StatusOK, spec)
}
