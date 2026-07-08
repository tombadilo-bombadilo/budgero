package handler

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/domain"
	"budgero-server/internal/pkg/crypto"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"
)

const maxDatabaseUploadBytes int64 = 200 * 1024 * 1024

func readLimitedBody(c echo.Context, limit int64, tooLargeMessage, badRequestMessage string) ([]byte, error) {
	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, limit)
	data, err := io.ReadAll(c.Request().Body)
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return nil, echo.NewHTTPError(http.StatusRequestEntityTooLarge, tooLargeMessage)
		}
		return nil, echo.NewHTTPError(http.StatusBadRequest, badRequestMessage)
	}
	return data, nil
}

// DownloadDatabase returns the user's encrypted database file
func (h *Handlers) DownloadDatabase(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		log.Warn().Msg("Database download request without authentication")
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	spaceParam := c.QueryParam("space_id")
	blob, err := h.services.Space.GetBlobMetadata(ctx, userID, spaceParam)
	if err != nil {
		return mapServiceError(err)
	}

	log.Info().
		Str("user_id", userID).
		Str("space_id", blob.SpaceID).
		Str("db_path", blob.BlobPath).
		Msg("Database download request")

	// A client that doesn't understand this blob's format would misread
	// milliunit amounts and write corruption back — refuse instead.
	if err := requireFormatSupport(c, blob.DataFormatVersion); err != nil {
		log.Warn().
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Int64("blob_format", blob.DataFormatVersion).
			Int64("client_format", clientSupportedFormat(c)).
			Msg("Download rejected: client does not support blob data format")
		return err
	}

	info, statErr := os.Stat(blob.BlobPath)
	if statErr != nil {
		if errors.Is(statErr, os.ErrNotExist) {
			log.Info().
				Str("user_id", userID).
				Str("space_id", blob.SpaceID).
				Str("db_path", blob.BlobPath).
				Msg("Database file not found")
			return echo.NewHTTPError(http.StatusNotFound, "database not found")
		}
		log.Error().
			Err(statErr).
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Str("db_path", blob.BlobPath).
			Msg("Failed to stat database file")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read database file")
	} else if info.IsDir() {
		log.Error().
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Str("db_path", blob.BlobPath).
			Msg("Database path refers to a directory")
		return echo.NewHTTPError(http.StatusInternalServerError, "invalid database path")
	}

	hash := blob.CurrentHash

	log.Info().
		Str("user_id", userID).
		Str("space_id", blob.SpaceID).
		Str("db_path", blob.BlobPath).
		Int64("size_bytes", info.Size()).
		Str("hash", hash).
		Msg("Serving database file")

	c.Response().Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Response().Header().Set("Pragma", "no-cache")
	c.Response().Header().Set("Expires", "0")
	c.Response().Header().Set("Content-Type", "application/octet-stream")
	c.Response().Header().Set("X-Budget-Space-ID", blob.SpaceID)
	c.Response().Header().Set("X-Database-Version", fmt.Sprintf("%d", blob.SyncVersion))
	if blob.MutationVersion > 0 {
		c.Response().Header().Set("X-Mutation-Version", fmt.Sprintf("%d", blob.MutationVersion))
	}
	c.Response().Header().Set(dataFormatHeader, fmt.Sprintf("%d", blob.DataFormatVersion))
	if hash != "" {
		c.Response().Header().Set("X-Database-Hash", hash)
	}

	return c.File(blob.BlobPath)
}

// UploadDatabase accepts an encrypted database file from the user
func (h *Handlers) UploadDatabase(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		log.Warn().Msg("Database upload request without authentication")
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	spaceParam := c.QueryParam("space_id")
	blob, err := h.services.Space.GetBlobMetadata(ctx, userID, spaceParam)
	if err != nil {
		return mapServiceError(err)
	}

	log.Info().
		Str("user_id", userID).
		Str("space_id", blob.SpaceID).
		Str("db_path", blob.BlobPath).
		Msg("Database upload request")

	// A legacy-format upload must not overwrite a newer-format blob: that is
	// exactly the corruption path this gate exists to close.
	uploadFormat := clientDeclaredFormat(c)
	if uploadFormat < blob.DataFormatVersion {
		log.Warn().
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Int64("blob_format", blob.DataFormatVersion).
			Int64("upload_format", uploadFormat).
			Msg("Upload rejected: blob is in a newer data format than the client writes")
		return echo.NewHTTPError(
			http.StatusUpgradeRequired,
			"this space uses a newer data format; update the app to continue syncing",
		)
	}

	if err = os.MkdirAll(filepath.Dir(blob.BlobPath), 0o750); err != nil {
		log.Error().
			Err(err).
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Msg("Failed to create space directory")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to prepare storage directory")
	}

	data, err := readLimitedBody(
		c,
		maxDatabaseUploadBytes,
		"database upload too large",
		"failed to read request body",
	)
	if err != nil {
		log.Error().
			Err(err).
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Msg("Failed to read request body")
		return err
	}

	currentState, stateErr := h.services.Space.GetSyncState(ctx, userID, blob.SpaceID)

	clientVersionStr := c.Request().Header.Get("X-DB-Version")
	if clientVersionStr != "" && stateErr == nil {
		var clientVersion int64
		if _, scanErr := fmt.Sscanf(clientVersionStr, "%d", &clientVersion); scanErr == nil {
			if clientVersion != 0 && clientVersion < currentState.Version {
				log.Warn().
					Str("user_id", userID).
					Str("space_id", blob.SpaceID).
					Int64("client_version", clientVersion).
					Int64("server_version", currentState.Version).
					Msg("Upload rejected due to version conflict")
				return c.JSON(http.StatusConflict, map[string]any{
					"error":          "version_conflict",
					"message":        "Database version conflict. Please sync before uploading.",
					"server_version": currentState.Version,
					"client_version": clientVersion,
					"space_id":       currentState.SpaceID,
				})
			}
			if clientVersion == 0 && currentState.Version > 0 {
				log.Warn().
					Str("user_id", userID).
					Str("space_id", blob.SpaceID).
					Int64("server_version", currentState.Version).
					Msg("Client attempting to upload with version 0 when server has existing data")
				return c.JSON(http.StatusConflict, map[string]any{
					"error":          "version_conflict",
					"message":        "Server already has a database. Please download it first.",
					"server_version": currentState.Version,
					"client_version": clientVersion,
					"space_id":       currentState.SpaceID,
				})
			}
		}
	}

	// Check encryption key version to prevent stale key uploads
	clientKeyVersionStr := c.Request().Header.Get("X-Encryption-Key-Version")
	if clientKeyVersionStr != "" && stateErr == nil {
		var clientKeyVersion int64
		if _, scanErr := fmt.Sscanf(clientKeyVersionStr, "%d", &clientKeyVersion); scanErr == nil {
			if clientKeyVersion < currentState.EncryptionKeyVersion {
				log.Warn().
					Str("user_id", userID).
					Str("space_id", blob.SpaceID).
					Int64("client_key_version", clientKeyVersion).
					Int64("server_key_version", currentState.EncryptionKeyVersion).
					Msg("Upload rejected due to encryption key version mismatch")
				return c.JSON(http.StatusConflict, map[string]any{
					"error":              "encryption_key_outdated",
					"message":            "Encryption key has been changed. Please re-enter your master password.",
					"server_key_version": currentState.EncryptionKeyVersion,
					"client_key_version": clientKeyVersion,
					"space_id":           currentState.SpaceID,
				})
			}
		}
	}

	mutationVersion, mvErr := h.resolveUploadMutationVersion(c, blob.SpaceID)
	if mvErr != nil {
		return mvErr
	}

	if err = os.WriteFile(blob.BlobPath, data, 0o600); err != nil {
		log.Error().
			Err(err).
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Str("db_path", blob.BlobPath).
			Int("data_size", len(data)).
			Msg("Failed to save database")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to save database")
	}

	hash := crypto.ComputeDataHash(data)
	newVersion, err := h.services.Space.UpdateSyncState(ctx, userID, blob.SpaceID, hash, int64(len(data)), mutationVersion)
	if err != nil {
		log.Error().
			Err(err).
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Str("hash", hash).
			Msg("Failed to update space sync state")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update sync metadata")
	}

	if uploadFormat > blob.DataFormatVersion {
		// Fatal on failure: the v2 bytes are already stored, and without the
		// recorded format a later legacy upload would be allowed to overwrite
		// them. The client retries the (idempotent) upload.
		if err := h.services.Space.RaiseDataFormatVersion(ctx, userID, blob.SpaceID, uploadFormat); err != nil {
			log.Error().
				Err(err).
				Str("user_id", userID).
				Str("space_id", blob.SpaceID).
				Int64("upload_format", uploadFormat).
				Msg("Failed to record blob data format version")
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to record data format version")
		}
		log.Info().
			Str("space_id", blob.SpaceID).
			Int64("data_format", uploadFormat).
			Msg("Space blob data format raised")
	}

	if h.syncHub != nil {
		outOfBand := c.Request().Header.Get("X-Out-Of-Band") == "1"
		h.syncHub.NotifyDatabaseUpdate(blob.SpaceID, userID, newVersion, hash, outOfBand)
	}

	log.Info().
		Str("user_id", userID).
		Str("space_id", blob.SpaceID).
		Str("db_path", blob.BlobPath).
		Int("data_size", len(data)).
		Str("hash", hash).
		Int64("version", newVersion).
		Msg("Database uploaded successfully")

	return c.JSON(http.StatusOK, map[string]any{
		"success":  true,
		"message":  "database uploaded successfully",
		"size":     len(data),
		"hash":     hash,
		"version":  newVersion,
		"space_id": blob.SpaceID,
	})
}

// GetDatabaseHash returns the current database hash for the user
func (h *Handlers) GetDatabaseHash(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		log.Warn().Msg("Database hash request without authentication")
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	spaceParam := c.QueryParam("space_id")
	hash, err := h.services.Space.GetDatabaseHash(ctx, userID, spaceParam)
	if err != nil {
		log.Error().
			Err(err).
			Str("user_id", userID).
			Str("space_id", spaceParam).
			Msg("Failed to get database hash")
		return mapServiceError(err)
	}

	state, stateErr := h.services.Space.GetSyncState(ctx, userID, spaceParam)
	if stateErr != nil {
		return mapServiceError(stateErr)
	}

	log.Info().
		Str("user_id", userID).
		Str("space_id", state.SpaceID).
		Str("hash", hash).
		Msg("Database hash requested")

	c.Response().Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Response().Header().Set("Pragma", "no-cache")
	c.Response().Header().Set("Expires", "0")

	return c.JSON(http.StatusOK, map[string]any{
		"hash":     hash,
		"space_id": state.SpaceID,
		"version":  state.Version,
	})
}

// GetDatabaseState returns the current sync state (version and hash) for the user
func (h *Handlers) GetDatabaseState(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		log.Warn().Msg("Database state request without authentication")
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	spaceParam := c.QueryParam("space_id")
	state, err := h.services.Space.GetSyncState(ctx, userID, spaceParam)
	if err != nil {
		log.Error().
			Err(err).
			Str("user_id", userID).
			Str("space_id", spaceParam).
			Msg("Failed to get sync state")
		return mapServiceError(err)
	}

	log.Info().
		Str("user_id", userID).
		Str("space_id", state.SpaceID).
		Int64("version", state.Version).
		Str("hash", state.Hash).
		Msg("Database state requested")

	var mutationVersion *int64
	if h.services != nil && h.services.Sync != nil {
		if latest, latestErr := h.services.Sync.GetLatestVersion(ctx, state.SpaceID); latestErr == nil {
			mutationVersion = &latest
		} else {
			log.Warn().
				Err(latestErr).
				Str("user_id", userID).
				Str("space_id", state.SpaceID).
				Msg("Failed to resolve latest mutation version for database state")
		}
	}

	// Set headers to prevent caching
	c.Response().Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Response().Header().Set("Pragma", "no-cache")
	c.Response().Header().Set("Expires", "0")

	response := map[string]any{
		"space_id":               state.SpaceID,
		"version":                state.Version,
		"hash":                   state.Hash,
		"encryption_key_version": state.EncryptionKeyVersion,
	}
	if mutationVersion != nil {
		response["mutation_version"] = *mutationVersion
	}
	return c.JSON(http.StatusOK, response)
}

// GetDatabaseBlob returns the user's encrypted database blob (Layer 2: HTTP blob storage)
func (h *Handlers) GetDatabaseBlob(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		log.Warn().Msg("Database blob download request without authentication")
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	spaceParam := c.QueryParam("space_id")
	blob, err := h.services.Space.GetBlobMetadata(ctx, userID, spaceParam)
	if err != nil {
		return mapServiceError(err)
	}

	log.Info().
		Str("user_id", userID).
		Str("space_id", blob.SpaceID).
		Str("db_path", blob.BlobPath).
		Msg("Database blob download request")

	// A client that doesn't understand this blob's format would misread
	// milliunit amounts and write corruption back — refuse instead.
	if err := requireFormatSupport(c, blob.DataFormatVersion); err != nil {
		log.Warn().
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Int64("blob_format", blob.DataFormatVersion).
			Int64("client_format", clientSupportedFormat(c)).
			Msg("Blob download rejected: client does not support blob data format")
		return err
	}

	info, statErr := os.Stat(blob.BlobPath)
	if statErr != nil {
		if errors.Is(statErr, os.ErrNotExist) {
			log.Info().
				Str("user_id", userID).
				Str("space_id", blob.SpaceID).
				Str("db_path", blob.BlobPath).
				Msg("Database blob not found")
			return echo.NewHTTPError(http.StatusNotFound, "database blob not found")
		}
		log.Error().
			Err(statErr).
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Str("db_path", blob.BlobPath).
			Msg("Failed to stat database blob")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read database blob")
	} else if info.IsDir() {
		log.Error().
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Str("db_path", blob.BlobPath).
			Msg("Database blob path refers to a directory")
		return echo.NewHTTPError(http.StatusInternalServerError, "invalid database blob path")
	}

	hash := blob.CurrentHash

	log.Info().
		Str("user_id", userID).
		Str("space_id", blob.SpaceID).
		Str("db_path", blob.BlobPath).
		Int64("size_bytes", info.Size()).
		Str("hash", hash).
		Msg("Serving database blob")

	c.Response().Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Response().Header().Set("Pragma", "no-cache")
	c.Response().Header().Set("Expires", "0")
	c.Response().Header().Set("Content-Type", "application/octet-stream")
	if hash != "" {
		c.Response().Header().Set("X-Database-Hash", hash)
	}
	c.Response().Header().Set("X-Budget-Space-ID", blob.SpaceID)
	c.Response().Header().Set("X-Database-Version", fmt.Sprintf("%d", blob.SyncVersion))
	if blob.MutationVersion > 0 {
		c.Response().Header().Set("X-Mutation-Version", fmt.Sprintf("%d", blob.MutationVersion))
	}
	c.Response().Header().Set("X-Encryption-Key-Version", fmt.Sprintf("%d", blob.EncryptionKeyVersion))
	c.Response().Header().Set(dataFormatHeader, fmt.Sprintf("%d", blob.DataFormatVersion))

	return c.File(blob.BlobPath)
}


// resolveUploadMutationVersion returns the mutation-log position an uploaded
// blob corresponds to. Preferred source is the client's own cursor
// (X-Mutation-Version — exact for debounced uploads). A malformed header is a
// client bug and is rejected outright: silently substituting the latest log
// version would record a wrong cursor. Legacy clients omit the header, so the
// absent case falls back to the current latest log version, which matches the
// old upload-after-every-mutation behavior.
func (h *Handlers) resolveUploadMutationVersion(c echo.Context, spaceID string) (int64, error) {
	if raw := c.Request().Header.Get("X-Mutation-Version"); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v < 0 {
			log.Warn().
				Str("space_id", spaceID).
				Str("header", raw).
				Msg("Rejecting upload with invalid X-Mutation-Version header")
			return 0, echo.NewHTTPError(http.StatusBadRequest, "invalid X-Mutation-Version header")
		}
		return v, nil
	}
	log.Warn().
		Str("space_id", spaceID).
		Msg("Upload without X-Mutation-Version header; falling back to latest mutation-log version")
	if h.services != nil && h.services.Sync != nil {
		if latest, err := h.services.Sync.GetLatestVersion(c.Request().Context(), spaceID); err == nil {
			return latest, nil
		}
	}
	return 0, nil
}

// PostDatabaseBlob accepts an encrypted database blob from the user (Layer 2: HTTP blob storage)
func (h *Handlers) PostDatabaseBlob(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		log.Warn().Msg("Database blob upload request without authentication")
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}

	ctx := c.Request().Context()
	spaceParam := c.QueryParam("space_id")
	blob, err := h.services.Space.GetBlobMetadata(ctx, userID, spaceParam)
	if err != nil {
		return mapServiceError(err)
	}

	log.Info().
		Str("user_id", userID).
		Str("space_id", blob.SpaceID).
		Str("db_path", blob.BlobPath).
		Msg("Database blob upload request")

	// A legacy-format upload must not overwrite a newer-format blob: that is
	// exactly the corruption path this gate exists to close.
	uploadFormat := clientDeclaredFormat(c)
	if uploadFormat < blob.DataFormatVersion {
		log.Warn().
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Int64("blob_format", blob.DataFormatVersion).
			Int64("upload_format", uploadFormat).
			Msg("Blob upload rejected: blob is in a newer data format than the client writes")
		return echo.NewHTTPError(
			http.StatusUpgradeRequired,
			"this space uses a newer data format; update the app to continue syncing",
		)
	}

	if err = os.MkdirAll(filepath.Dir(blob.BlobPath), 0o750); err != nil {
		log.Error().
			Err(err).
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Msg("Failed to create space directory")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to prepare storage directory")
	}

	data, err := readLimitedBody(
		c,
		maxDatabaseUploadBytes,
		"database blob upload too large",
		"failed to read blob request body",
	)
	if err != nil {
		log.Error().
			Err(err).
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Msg("Failed to read blob request body")
		return err
	}

	if len(data) == 0 {
		log.Warn().
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Msg("Empty blob upload attempted")
		return echo.NewHTTPError(http.StatusBadRequest, "empty blob data")
	}

	mutationVersion, mvErr := h.resolveUploadMutationVersion(c, blob.SpaceID)
	if mvErr != nil {
		return mvErr
	}

	currentState, stateErr := h.services.Space.GetSyncState(ctx, userID, blob.SpaceID)

	// -1 means "no usable version header": legacy clients and first uploads.
	clientVersion := int64(-1)
	if raw := c.Request().Header.Get("X-Database-Version"); raw != "" {
		if parsed, parseErr := strconv.ParseInt(raw, 10, 64); parseErr == nil && parsed >= 0 {
			clientVersion = parsed
		} else {
			log.Warn().
				Str("user_id", userID).
				Str("space_id", blob.SpaceID).
				Str("header", raw).
				Msg("Ignoring unparseable X-Database-Version header on blob upload")
		}
	}

	if clientVersion >= 0 && stateErr == nil {
		if clientVersion != 0 && clientVersion < currentState.Version {
			log.Warn().
				Str("user_id", userID).
				Str("space_id", blob.SpaceID).
				Int64("client_version", clientVersion).
				Int64("server_version", currentState.Version).
				Msg("Blob upload rejected due to version conflict")
			return c.JSON(http.StatusConflict, map[string]any{
				"error":          "version_conflict",
				"message":        "Database version conflict. Client must download latest blob first.",
				"server_version": currentState.Version,
				"client_version": clientVersion,
				"space_id":       currentState.SpaceID,
			})
		}
		if clientVersion == 0 && currentState.Version > 0 {
			log.Warn().
				Str("user_id", userID).
				Str("space_id", blob.SpaceID).
				Int64("server_version", currentState.Version).
				Msg("Client attempting blob upload with version 0 when server has existing data")
			return c.JSON(http.StatusConflict, map[string]any{
				"error":          "version_conflict",
				"message":        "Server already has a database blob. Please download it first.",
				"server_version": currentState.Version,
				"client_version": clientVersion,
				"space_id":       currentState.SpaceID,
			})
		}
	}

	// Check encryption key version to prevent stale key uploads
	clientKeyVersionStr := c.Request().Header.Get("X-Encryption-Key-Version")
	if clientKeyVersionStr != "" && stateErr == nil {
		var clientKeyVersion int64
		if _, scanErr := fmt.Sscanf(clientKeyVersionStr, "%d", &clientKeyVersion); scanErr == nil {
			if clientKeyVersion < currentState.EncryptionKeyVersion {
				log.Warn().
					Str("user_id", userID).
					Str("space_id", blob.SpaceID).
					Int64("client_key_version", clientKeyVersion).
					Int64("server_key_version", currentState.EncryptionKeyVersion).
					Msg("Blob upload rejected due to encryption key version mismatch")
				return c.JSON(http.StatusConflict, map[string]any{
					"error":              "encryption_key_outdated",
					"message":            "Encryption key has been changed. Please re-enter your master password.",
					"server_key_version": currentState.EncryptionKeyVersion,
					"client_key_version": clientKeyVersion,
					"space_id":           currentState.SpaceID,
				})
			}
		}
	}

	hash := crypto.ComputeDataHash(data)

	// Advance the version BEFORE writing the file: the sync_version row is the
	// concurrency gate. With a version header the advance is a compare-and-swap
	// against the client's base version, so a concurrent upload that raced past
	// the pre-checks above loses here instead of silently overwriting the blob.
	var newVersion int64
	if clientVersion >= 0 {
		newVersion, err = h.services.Space.UpdateSyncStateCAS(ctx, userID, blob.SpaceID, hash, int64(len(data)), mutationVersion, clientVersion)
		if errors.Is(err, domain.ErrSyncVersionConflict) {
			serverVersion := blob.SyncVersion
			if refreshed, refreshErr := h.services.Space.GetSyncState(ctx, userID, blob.SpaceID); refreshErr == nil {
				serverVersion = refreshed.Version
			}
			log.Warn().
				Str("user_id", userID).
				Str("space_id", blob.SpaceID).
				Int64("client_version", clientVersion).
				Int64("server_version", serverVersion).
				Msg("Blob upload lost version compare-and-swap; rejecting")
			return c.JSON(http.StatusConflict, map[string]any{
				"error":          "version_conflict",
				"message":        "Database version conflict. Client must download latest blob first.",
				"server_version": serverVersion,
				"client_version": clientVersion,
				"space_id":       blob.SpaceID,
			})
		}
	} else {
		log.Warn().
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Msg("Blob upload without usable X-Database-Version header; advancing sync version unconditionally")
		newVersion, err = h.services.Space.UpdateSyncState(ctx, userID, blob.SpaceID, hash, int64(len(data)), mutationVersion)
	}
	if err != nil {
		log.Error().
			Err(err).
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Str("hash", hash).
			Msg("Failed to update sync state for blob upload")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update sync metadata")
	}

	tempPath := blob.BlobPath + ".tmp"
	if err = os.WriteFile(tempPath, data, 0o600); err != nil {
		// Loud on purpose: the version was already reserved, so the stored
		// blob is now stale relative to the recorded hash until the client
		// retries. Recoverable via the mutation log.
		log.Error().
			Err(err).
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Str("temp_path", tempPath).
			Int("data_size", len(data)).
			Int64("reserved_version", newVersion).
			Msg("CRITICAL: blob write failed after sync version was advanced; stored blob is stale until re-upload")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to save blob")
	}

	if err = os.Rename(tempPath, blob.BlobPath); err != nil {
		log.Error().
			Err(err).
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Str("db_path", blob.BlobPath).
			Int64("reserved_version", newVersion).
			Msg("CRITICAL: blob rename failed after sync version was advanced; stored blob is stale until re-upload")
		_ = os.Remove(tempPath)
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to save blob")
	}

	if uploadFormat > blob.DataFormatVersion {
		// Fatal on failure: the v2 bytes are already stored, and without the
		// recorded format a later legacy upload would be allowed to overwrite
		// them. The client retries the (idempotent) upload.
		if err := h.services.Space.RaiseDataFormatVersion(ctx, userID, blob.SpaceID, uploadFormat); err != nil {
			log.Error().
				Err(err).
				Str("user_id", userID).
				Str("space_id", blob.SpaceID).
				Int64("upload_format", uploadFormat).
				Msg("Failed to record blob data format version")
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to record data format version")
		}
		log.Info().
			Str("space_id", blob.SpaceID).
			Int64("data_format", uploadFormat).
			Msg("Space blob data format raised")
	}

	if h.syncHub != nil {
		outOfBand := c.Request().Header.Get("X-Out-Of-Band") == "1"
		h.syncHub.NotifyDatabaseUpdate(blob.SpaceID, userID, newVersion, hash, outOfBand)
	}

	log.Info().
		Str("user_id", userID).
		Str("space_id", blob.SpaceID).
		Str("db_path", blob.BlobPath).
		Int("data_size", len(data)).
		Str("hash", hash).
		Int64("version", newVersion).
		Msg("Database blob uploaded successfully")

	return c.JSON(http.StatusOK, map[string]any{
		"success":  true,
		"message":  "database blob uploaded successfully",
		"size":     len(data),
		"hash":     hash,
		"version":  newVersion,
		"space_id": blob.SpaceID,
	})
}
