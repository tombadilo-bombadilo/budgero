package handler

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/appmeta"
	"budgero-server/internal/domain"
	"budgero-server/internal/domain/analytics"
	"budgero-server/internal/pkg/crypto"
	"budgero-server/internal/port/driven/external"

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
	blob, file, openErr, err := h.openSpaceBlob(ctx, userID, spaceParam)
	if err != nil {
		return mapServiceError(err)
	}
	if file != nil {
		defer func() { _ = file.Close() }()
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

	if openErr != nil {
		if errors.Is(openErr, os.ErrNotExist) {
			log.Info().
				Str("user_id", userID).
				Str("space_id", blob.SpaceID).
				Str("db_path", blob.BlobPath).
				Msg("Database file not found")
			return echo.NewHTTPError(http.StatusNotFound, "database not found")
		}
		log.Error().
			Err(openErr).
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Str("db_path", blob.BlobPath).
			Msg("Failed to open database file")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read database file")
	}
	info, statErr := file.Stat()
	if statErr != nil {
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

	http.ServeContent(c.Response(), c.Request(), info.Name(), info.ModTime(), file)
	return nil
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

	if len(data) == 0 {
		log.Warn().
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Msg("Empty database upload attempted")
		return echo.NewHTTPError(http.StatusBadRequest, "empty database data")
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

	// Same guard as PostDatabaseBlob: never replace a snapshot with one bound
	// to an older mutation-log position (out-of-band uploads excepted).
	if stateErr == nil && c.Request().Header.Get("X-Out-Of-Band") != "1" &&
		mutationVersion < currentState.SnapshotMutationVersion {
		reqLog := middleware.Logger(c)
		reqLog.Warn().
			Str("space_id", blob.SpaceID).
			Int64("client_mutation_version", mutationVersion).
			Int64("server_mutation_version", currentState.SnapshotMutationVersion).
			Msg("Legacy upload rejected: snapshot would regress the mutation log position")
		h.reportRefusal(c, refusalSnapshotRegression)
		return c.JSON(http.StatusConflict, map[string]any{
			"error":                   "mutation_version_regression",
			"message":                 "This snapshot is older than the one on the server. Download the latest first.",
			"server_version":          currentState.Version,
			"server_mutation_version": currentState.SnapshotMutationVersion,
			"client_mutation_version": mutationVersion,
			"space_id":                currentState.SpaceID,
		})
	}

	tempPath, err := writeBlobTemp(blob.BlobPath, data)
	if err != nil {
		log.Error().
			Err(err).
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Str("db_path", blob.BlobPath).
			Int("data_size", len(data)).
			Msg("Failed to save database")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to save database")
	}

	// Same publish protocol as PostDatabaseBlob: metadata advance and rename
	// happen together under the space's blob lock.
	hash := crypto.ComputeDataHash(data)
	legacyOutOfBand := c.Request().Header.Get("X-Out-Of-Band") == "1"
	newVersion, err := h.commitBlob(ctx, blob.SpaceID, tempPath, blob.BlobPath, uploadOrigin(legacyOutOfBand), func() (int64, error) {
		return h.services.Space.UpdateSyncState(ctx, userID, blob.SpaceID, hash, int64(len(data)), mutationVersion)
	})
	if errors.Is(err, errBlobPublish) {
		log.Error().
			Err(err).
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Str("db_path", blob.BlobPath).
			Int64("reserved_version", newVersion).
			Msg("CRITICAL: database rename failed after sync version was advanced; stored blob is stale until re-upload")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to save database")
	}
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

	if !legacyOutOfBand && stateErr == nil {
		h.checkSnapshotShrink(c, blob.SpaceID, currentState.SnapshotSizeBytes, int64(len(data)), newVersion)
	}

	if h.syncHub != nil {
		h.syncHub.NotifyDatabaseUpdate(blob.SpaceID, userID, newVersion, hash, legacyOutOfBand)
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
	state, err := h.getSyncStateLocked(ctx, userID, spaceParam)
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

		"snapshot_mutation_version":    state.SnapshotMutationVersion,
		"snapshot_data_format_version": state.SnapshotDataFormatVersion,
		"snapshot_size_bytes":          state.SnapshotSizeBytes,
		"snapshot_updated_at":          state.SnapshotUpdatedAt,
	}
	if mutationVersion != nil {
		response["mutation_version"] = *mutationVersion
	}
	return c.JSON(http.StatusOK, response)
}

// GetMutationLog returns a page of the space's mutation log, newest first.
// Payloads stay end-to-end encrypted; clients decrypt them for display.
func (h *Handlers) GetMutationLog(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	if h.services == nil || h.services.Sync == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "sync unavailable")
	}

	parseInt := func(name string) (int64, error) {
		raw := c.QueryParam(name)
		if raw == "" {
			return 0, nil
		}
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v < 0 {
			return 0, echo.NewHTTPError(http.StatusBadRequest, "invalid "+name)
		}
		return v, nil
	}
	before, err := parseInt("before")
	if err != nil {
		return err
	}
	limit, err := parseInt("limit")
	if err != nil {
		return err
	}

	ctx := c.Request().Context()
	spaceID, err := h.services.Space.ResolveSpaceID(ctx, userID, c.QueryParam("space_id"))
	if err != nil {
		return mapServiceError(err)
	}
	latest, err := h.services.Sync.GetLatestVersion(ctx, spaceID)
	if err != nil {
		log.Error().Err(err).Str("space_id", spaceID).Msg("Failed to read latest mutation version")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read mutation log")
	}
	entries, err := h.services.Sync.ListMutationsBefore(ctx, spaceID, before, int(limit))
	if err != nil {
		log.Error().Err(err).Str("space_id", spaceID).Msg("Failed to list mutation log")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read mutation log")
	}

	c.Response().Header().Set("Cache-Control", "no-store")
	return c.JSON(http.StatusOK, map[string]any{
		"space_id":       spaceID,
		"latest_version": latest,
		"entries":        entries,
	})
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
	// Metadata and file are captured together under the space's blob lock, so
	// the version/hash/cursor headers below always describe the served bytes.
	blob, file, openErr, err := h.openSpaceBlob(ctx, userID, spaceParam)
	if err != nil {
		return mapServiceError(err)
	}
	if file != nil {
		defer func() { _ = file.Close() }()
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

	if openErr != nil {
		if errors.Is(openErr, os.ErrNotExist) {
			log.Info().
				Str("user_id", userID).
				Str("space_id", blob.SpaceID).
				Str("db_path", blob.BlobPath).
				Msg("Database blob not found")
			return echo.NewHTTPError(http.StatusNotFound, "database blob not found")
		}
		log.Error().
			Err(openErr).
			Str("user_id", userID).
			Str("space_id", blob.SpaceID).
			Str("db_path", blob.BlobPath).
			Msg("Failed to open database blob")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read database blob")
	}
	info, statErr := file.Stat()
	if statErr != nil {
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

	http.ServeContent(c.Response(), c.Request(), info.Name(), info.ModTime(), file)
	return nil
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
	start := time.Now()
	var rec blobUploadRecord
	err := h.postDatabaseBlob(c, &rec)
	h.telemetry.BlobUpload(rec.outcome(c, err), rec.size, time.Since(start))
	return err
}

// blobUploadRecord carries what the upload metric needs out of the handler.
type blobUploadRecord struct {
	size int64
	// keyOutdated marks the 409 sent for a stale encryption key, which is a
	// client-side refusal rather than a version (CAS) conflict.
	keyOutdated bool
	// regressed marks the 409 sent for a snapshot bound to an older mutation
	// position than the stored one: also a refusal, not a CAS conflict.
	regressed bool
}

func (r *blobUploadRecord) outcome(c echo.Context, err error) external.BlobUploadOutcome {
	status := responseStatusFor(c, err)
	switch {
	case status >= 200 && status < 300:
		return external.BlobUploadOK
	case status == http.StatusConflict && !r.keyOutdated && !r.regressed:
		return external.BlobUploadCASConflict
	case status >= 400 && status < 500:
		return external.BlobUploadRejected
	default:
		return external.BlobUploadError
	}
}

// responseStatusFor is the status written for c, or the one err will produce.
func responseStatusFor(c echo.Context, err error) int {
	if err == nil {
		return c.Response().Status
	}
	var he *echo.HTTPError
	if errors.As(err, &he) {
		return he.Code
	}
	return http.StatusInternalServerError
}

// Blob upload refusals reported as handled warning exceptions: the sync
// failures a client is expected to recover from, and the ones whose cause
// otherwise has to be guessed from client reports.
var (
	refusalSnapshotRegression = middleware.Refusal{
		Type: "SnapshotRegression", Code: analytics.ErrCodeSnapshotRegression, Status: http.StatusConflict,
	}
	refusalSnapshotConflict = middleware.Refusal{
		Type: "SnapshotConflict", Code: analytics.ErrCodeSnapshotConflict, Status: http.StatusConflict,
	}
	refusalEncryptionKeyOutdated = middleware.Refusal{
		Type: "EncryptionKeyOutdated", Code: analytics.ErrCodeEncryptionKeyOutdated, Status: http.StatusConflict,
	}
	refusalFormatTooNew = middleware.Refusal{
		Type: "FormatTooNew", Code: analytics.ErrCodeFormatTooNew, Status: http.StatusUpgradeRequired,
	}
)

// reportRefusal sends one handled $exception (level warning) for a request
// this handler refused on purpose. Safe when analytics is not wired; at
// most one event per request.
func (h *Handlers) reportRefusal(c echo.Context, r middleware.Refusal) {
	if h.services == nil || h.services.Analytics == nil {
		return
	}
	middleware.ReportRefusal(c, h.services.Analytics, appmeta.BuildVersion(), r)
}

func (h *Handlers) postDatabaseBlob(c echo.Context, rec *blobUploadRecord) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		log.Warn().Msg("Database blob upload request without authentication")
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	logger := middleware.Logger(c)

	ctx := c.Request().Context()
	spaceParam := c.QueryParam("space_id")
	blob, err := h.services.Space.GetBlobMetadata(ctx, userID, spaceParam)
	if err != nil {
		return mapServiceError(err)
	}

	logger.Info().
		Str("space_id", blob.SpaceID).
		Str("db_path", blob.BlobPath).
		Msg("Database blob upload request")

	// A legacy-format upload must not overwrite a newer-format blob: that is
	// exactly the corruption path this gate exists to close.
	uploadFormat := clientDeclaredFormat(c)
	if uploadFormat < blob.DataFormatVersion {
		logger.Warn().
			Str("space_id", blob.SpaceID).
			Int64("blob_format", blob.DataFormatVersion).
			Int64("upload_format", uploadFormat).
			Msg("Blob upload rejected: blob is in a newer data format than the client writes")
		h.reportRefusal(c, refusalFormatTooNew)
		return echo.NewHTTPError(
			http.StatusUpgradeRequired,
			"this space uses a newer data format; update the app to continue syncing",
		)
	}

	if err = os.MkdirAll(filepath.Dir(blob.BlobPath), 0o750); err != nil {
		logger.Error().
			Err(err).
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
		logger.Error().
			Err(err).
			Str("space_id", blob.SpaceID).
			Msg("Failed to read blob request body")
		return err
	}

	rec.size = int64(len(data))
	if len(data) == 0 {
		logger.Warn().
			Str("space_id", blob.SpaceID).
			Msg("Empty blob upload attempted")
		return echo.NewHTTPError(http.StatusBadRequest, "empty blob data")
	}

	mutationVersion, mvErr := h.resolveUploadMutationVersion(c, blob.SpaceID)
	if mvErr != nil {
		return mvErr
	}

	currentState, stateErr := h.services.Space.GetSyncState(ctx, userID, blob.SpaceID)

	// A snapshot bound to an older log position than the stored one would
	// replace a complete budget with a partial one (seen in production: a
	// device that reset its local DB uploaded a near-empty snapshot bound to
	// mutation 25 over one bound to 19369, eight seconds after the reset).
	// Out-of-band uploads (imports, restores) legitimately rewrite history and
	// are exempt; the catch-up path handles every other case by downloading.
	outOfBand := c.Request().Header.Get("X-Out-Of-Band") == "1"
	if stateErr == nil && !outOfBand && mutationVersion < currentState.SnapshotMutationVersion {
		logger.Warn().
			Str("space_id", blob.SpaceID).
			Int64("client_mutation_version", mutationVersion).
			Int64("server_mutation_version", currentState.SnapshotMutationVersion).
			Msg("Blob upload rejected: snapshot would regress the mutation log position")
		rec.regressed = true
		h.reportRefusal(c, refusalSnapshotRegression)
		return c.JSON(http.StatusConflict, map[string]any{
			"error":                   "mutation_version_regression",
			"message":                 "This snapshot is older than the one on the server. Download the latest first.",
			"server_version":          currentState.Version,
			"server_mutation_version": currentState.SnapshotMutationVersion,
			"client_mutation_version": mutationVersion,
			"space_id":                currentState.SpaceID,
		})
	}

	// -1 means "no usable version header": legacy clients and first uploads.
	clientVersion := int64(-1)
	if raw := c.Request().Header.Get("X-Database-Version"); raw != "" {
		if parsed, parseErr := strconv.ParseInt(raw, 10, 64); parseErr == nil && parsed >= 0 {
			clientVersion = parsed
		} else {
			logger.Warn().
				Str("space_id", blob.SpaceID).
				Str("header", raw).
				Msg("Ignoring unparseable X-Database-Version header on blob upload")
		}
	}

	if clientVersion >= 0 && stateErr == nil {
		if clientVersion != 0 && clientVersion < currentState.Version {
			logger.Warn().
				Str("space_id", blob.SpaceID).
				Int64("client_version", clientVersion).
				Int64("server_version", currentState.Version).
				Msg("Blob upload rejected due to version conflict")
			h.reportRefusal(c, refusalSnapshotConflict)
			return c.JSON(http.StatusConflict, map[string]any{
				"error":          "version_conflict",
				"message":        "Database version conflict. Client must download latest blob first.",
				"server_version": currentState.Version,
				"client_version": clientVersion,
				"space_id":       currentState.SpaceID,
			})
		}
		if clientVersion == 0 && currentState.Version > 0 {
			logger.Warn().
				Str("space_id", blob.SpaceID).
				Int64("server_version", currentState.Version).
				Msg("Client attempting blob upload with version 0 when server has existing data")
			h.reportRefusal(c, refusalSnapshotConflict)
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
				logger.Warn().
					Str("space_id", blob.SpaceID).
					Int64("client_key_version", clientKeyVersion).
					Int64("server_key_version", currentState.EncryptionKeyVersion).
					Msg("Blob upload rejected due to encryption key version mismatch")
				rec.keyOutdated = true
				h.reportRefusal(c, refusalEncryptionKeyOutdated)
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

	// Stage the bytes in a private temp file first; nothing is visible yet.
	tempPath, err := writeBlobTemp(blob.BlobPath, data)
	if err != nil {
		logger.Error().
			Err(err).
			Str("space_id", blob.SpaceID).
			Str("db_path", blob.BlobPath).
			Int("data_size", len(data)).
			Msg("Failed to write blob temp file")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to save blob")
	}

	// Advance the version, then publish the file, under the space's blob lock.
	// The sync_version row is the concurrency gate: with a version header the
	// advance is a compare-and-swap against the client's base version, so a
	// concurrent upload that raced past the pre-checks above loses here and its
	// temp file is discarded instead of overwriting the blob. Downloads take the
	// same lock, so they see old metadata with old bytes or new with new.
	newVersion, err := h.commitBlob(ctx, blob.SpaceID, tempPath, blob.BlobPath, uploadOrigin(outOfBand), func() (int64, error) {
		if clientVersion >= 0 {
			return h.services.Space.UpdateSyncStateCAS(ctx, userID, blob.SpaceID, hash, int64(len(data)), mutationVersion, clientVersion)
		}
		logger.Warn().
			Str("space_id", blob.SpaceID).
			Msg("Blob upload without usable X-Database-Version header; advancing sync version unconditionally")
		return h.services.Space.UpdateSyncState(ctx, userID, blob.SpaceID, hash, int64(len(data)), mutationVersion)
	})
	if errors.Is(err, domain.ErrSyncVersionConflict) {
		serverVersion := blob.SyncVersion
		if refreshed, refreshErr := h.services.Space.GetSyncState(ctx, userID, blob.SpaceID); refreshErr == nil {
			serverVersion = refreshed.Version
		}
		logger.Warn().
			Str("space_id", blob.SpaceID).
			Int64("client_version", clientVersion).
			Int64("server_version", serverVersion).
			Msg("Blob upload lost version compare-and-swap; rejecting")
		h.reportRefusal(c, refusalSnapshotConflict)
		return c.JSON(http.StatusConflict, map[string]any{
			"error":          "version_conflict",
			"message":        "Database version conflict. Client must download latest blob first.",
			"server_version": serverVersion,
			"client_version": clientVersion,
			"space_id":       blob.SpaceID,
		})
	}
	if errors.Is(err, errBlobPublish) {
		// Loud on purpose: the version was advanced but the rename failed, so
		// the stored blob lags the recorded hash until the client re-uploads.
		// Downloading clients detect the mismatch via X-Database-Hash.
		logger.Error().
			Err(err).
			Str("space_id", blob.SpaceID).
			Str("db_path", blob.BlobPath).
			Int64("reserved_version", newVersion).
			Msg("CRITICAL: blob rename failed after sync version was advanced; stored blob is stale until re-upload")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to save blob")
	}
	if err != nil {
		logger.Error().
			Err(err).
			Str("space_id", blob.SpaceID).
			Str("hash", hash).
			Msg("Failed to update sync state for blob upload")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update sync metadata")
	}

	if uploadFormat > blob.DataFormatVersion {
		// Fatal on failure: the v2 bytes are already stored, and without the
		// recorded format a later legacy upload would be allowed to overwrite
		// them. The client retries the (idempotent) upload.
		if err := h.services.Space.RaiseDataFormatVersion(ctx, userID, blob.SpaceID, uploadFormat); err != nil {
			logger.Error().
				Err(err).
				Str("space_id", blob.SpaceID).
				Int64("upload_format", uploadFormat).
				Msg("Failed to record blob data format version")
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to record data format version")
		}
		logger.Info().
			Str("space_id", blob.SpaceID).
			Int64("data_format", uploadFormat).
			Msg("Space blob data format raised")
	}

	if !outOfBand && stateErr == nil {
		h.checkSnapshotShrink(c, blob.SpaceID, currentState.SnapshotSizeBytes, int64(len(data)), newVersion)
	}

	if h.syncHub != nil {
		h.syncHub.NotifyDatabaseUpdate(blob.SpaceID, userID, newVersion, hash, outOfBand)
	}

	logger.Info().
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
