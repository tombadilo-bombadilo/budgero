package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"budgero-server/internal/adapter/driving/http/middleware"
	"budgero-server/internal/domain"
	"budgero-server/internal/domain/analytics"

	"github.com/labstack/echo/v4"
)

// Snapshot shrink alarm: an accepted upload that replaces a snapshot of at
// least shrinkAlarmMinBytes with one smaller than 1/shrinkAlarmRatio of it.
const (
	shrinkAlarmMinBytes int64 = 256 * 1024
	shrinkAlarmRatio    int64 = 5
)

var (
	refusalSnapshotShrink = middleware.Refusal{
		Type: "SnapshotShrink", Code: analytics.ErrCodeSnapshotShrink, Status: http.StatusOK,
	}
	refusalSnapshotRestored = middleware.Refusal{
		Type: "SnapshotRestored", Code: analytics.ErrCodeSnapshotRestored, Status: http.StatusOK,
	}
)

// uploadOrigin is the snapshot origin recorded for an upload.
func uploadOrigin(outOfBand bool) string {
	if outOfBand {
		return domain.SnapshotOriginOutOfBand
	}
	return domain.SnapshotOriginSync
}

// checkSnapshotShrink warns (log + handled warning exception) when an
// accepted upload replaced a large snapshot with a much smaller one: the
// shape of a device overwriting a full budget with a near-empty one. The
// upload stays accepted; the replaced snapshot is in history.
func (h *Handlers) checkSnapshotShrink(c echo.Context, spaceID string, oldSize, newSize, newVersion int64) {
	if oldSize < shrinkAlarmMinBytes || newSize*shrinkAlarmRatio >= oldSize {
		return
	}
	logger := middleware.Logger(c)
	logger.Warn().
		Str("space_id", spaceID).
		Int64("previous_size_bytes", oldSize).
		Int64("size_bytes", newSize).
		Int64("version", newVersion).
		Msg("Snapshot shrank below 20% of the one it replaced; previous snapshot kept in history")
	h.reportRefusal(c, refusalSnapshotShrink)
}

// snapshotCurrentJSON is the "current" object of a history listing.
func snapshotCurrentJSON(b *domain.SpaceBlob) map[string]any {
	return map[string]any{
		"sync_version":           b.SyncVersion,
		"mutation_version":       b.MutationVersion,
		"size_bytes":             b.SizeBytes,
		"updated_at":             b.PublishedAt.UTC(),
		"encryption_key_version": b.EncryptionKeyVersion,
		"data_format_version":    b.DataFormatVersion,
		"origin":                 b.Origin,
	}
}

// snapshotEntryJSON is one entry of a history listing.
func snapshotEntryJSON(e *domain.SnapshotHistoryEntry, current *domain.SpaceBlob) map[string]any {
	return map[string]any{
		"id":                     e.ID,
		"sync_version":           e.SyncVersion,
		"mutation_version":       e.MutationVersion,
		"size_bytes":             e.SizeBytes,
		"became_current_at":      e.BecameCurrentAt.UTC(),
		"replaced_at":            e.ReplacedAt.UTC(),
		"origin":                 e.Origin,
		"encryption_key_version": e.EncryptionKeyVersion,
		"data_format_version":    e.DataFormatVersion,
		"restorable":             e.RestorableOver(current),
	}
}

// listSnapshotHistory builds the history listing for a resolved space.
func (h *Handlers) listSnapshotHistory(c echo.Context, spaceID string) error {
	hist := h.snapshotHistory()
	if hist == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "snapshot history unavailable")
	}
	ctx := c.Request().Context()

	lock := h.blobLocks.get(spaceID)
	lock.RLock()
	current, err := hist.Current(ctx, spaceID)
	var entries []domain.SnapshotHistoryEntry
	if err == nil {
		entries, err = hist.List(ctx, spaceID)
	}
	lock.RUnlock()
	if err != nil {
		return mapServiceError(err)
	}

	out := make([]map[string]any, 0, len(entries))
	for i := range entries {
		out = append(out, snapshotEntryJSON(&entries[i], current))
	}
	c.Response().Header().Set("Cache-Control", "no-store")
	return c.JSON(http.StatusOK, map[string]any{
		"space_id": spaceID,
		"current":  snapshotCurrentJSON(current),
		"entries":  out,
	})
}

func parseHistoryID(c echo.Context) (int64, error) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, echo.NewHTTPError(http.StatusBadRequest, "invalid history id")
	}
	return id, nil
}

// GetSnapshotHistory lists the space's kept snapshots, newest first
// (GET /database/blob/history?space_id=).
func (h *Handlers) GetSnapshotHistory(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	spaceID, err := h.services.Space.ResolveSpaceID(c.Request().Context(), userID, c.QueryParam("space_id"))
	if err != nil {
		return mapServiceError(err)
	}
	return h.listSnapshotHistory(c, spaceID)
}

// GetSnapshotHistoryEntry serves one kept snapshot's encrypted bytes with the
// same headers as the current blob download
// (GET /database/blob/history/:id?space_id=).
func (h *Handlers) GetSnapshotHistoryEntry(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	id, err := parseHistoryID(c)
	if err != nil {
		return err
	}
	hist := h.snapshotHistory()
	if hist == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "snapshot history unavailable")
	}
	ctx := c.Request().Context()
	spaceID, err := h.services.Space.ResolveSpaceID(ctx, userID, c.QueryParam("space_id"))
	if err != nil {
		return mapServiceError(err)
	}

	// Pruning runs under the write lock; open the file under the read lock so
	// the entry can't vanish between lookup and open.
	lock := h.blobLocks.get(spaceID)
	lock.RLock()
	entry, err := hist.Get(ctx, spaceID, id)
	var file *os.File
	var openErr error
	if err == nil {
		file, openErr = os.Open(entry.FilePath)
	}
	lock.RUnlock()
	if errors.Is(err, domain.ErrSnapshotHistoryNotFound) {
		return echo.NewHTTPError(http.StatusNotFound, "snapshot history entry not found")
	}
	if err != nil {
		return mapServiceError(err)
	}
	if openErr != nil {
		if errors.Is(openErr, os.ErrNotExist) {
			return echo.NewHTTPError(http.StatusNotFound, "snapshot history file not found")
		}
		return internalErr("failed to read snapshot history entry", openErr)
	}
	defer func() { _ = file.Close() }()

	if formatErr := requireFormatSupport(c, entry.DataFormatVersion); formatErr != nil {
		return formatErr
	}
	info, err := file.Stat()
	if err != nil {
		return internalErr("failed to read snapshot history entry", err)
	}

	logger := middleware.Logger(c)
	logger.Info().
		Str("space_id", spaceID).
		Int64("history_id", entry.ID).
		Int64("history_version", entry.SyncVersion).
		Int64("size_bytes", info.Size()).
		Msg("Serving snapshot history entry")

	c.Response().Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Response().Header().Set("Pragma", "no-cache")
	c.Response().Header().Set("Expires", "0")
	c.Response().Header().Set("Content-Type", "application/octet-stream")
	if entry.Hash != "" {
		c.Response().Header().Set("X-Database-Hash", entry.Hash)
	}
	c.Response().Header().Set("X-Budget-Space-ID", spaceID)
	c.Response().Header().Set("X-Database-Version", fmt.Sprintf("%d", entry.SyncVersion))
	if entry.MutationVersion > 0 {
		c.Response().Header().Set("X-Mutation-Version", fmt.Sprintf("%d", entry.MutationVersion))
	}
	c.Response().Header().Set("X-Encryption-Key-Version", fmt.Sprintf("%d", entry.EncryptionKeyVersion))
	c.Response().Header().Set(dataFormatHeader, fmt.Sprintf("%d", entry.DataFormatVersion))

	http.ServeContent(c.Response(), c.Request(), info.Name(), info.ModTime(), file)
	return nil
}

// RestoreSnapshotHistoryEntry promotes a kept snapshot to current
// (POST /database/blob/history/:id/restore?space_id=).
func (h *Handlers) RestoreSnapshotHistoryEntry(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	id, err := parseHistoryID(c)
	if err != nil {
		return err
	}
	spaceID, err := h.services.Space.ResolveSpaceID(c.Request().Context(), userID, c.QueryParam("space_id"))
	if err != nil {
		return mapServiceError(err)
	}
	return h.restoreSnapshotAndRespond(c, userID, spaceID, id, false)
}

// AdminGetSnapshotHistory lists any space's kept snapshots, for support
// (GET /admin/spaces/:space_id/blob-history).
func (h *Handlers) AdminGetSnapshotHistory(c echo.Context) error {
	spaceID := c.Param("space_id")
	if spaceID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "space_id is required")
	}
	return h.listSnapshotHistory(c, spaceID)
}

// AdminRestoreSnapshotHistoryEntry promotes a kept snapshot of any space, for
// support when the user can't (POST /admin/spaces/:space_id/blob-history/:id/restore).
func (h *Handlers) AdminRestoreSnapshotHistoryEntry(c echo.Context) error {
	spaceID := c.Param("space_id")
	if spaceID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "space_id is required")
	}
	id, err := parseHistoryID(c)
	if err != nil {
		return err
	}
	return h.restoreSnapshotAndRespond(c, middleware.GetUserIDFromContext(c), spaceID, id, true)
}

// restoreSnapshotAndRespond runs the promotion and writes the response.
func (h *Handlers) restoreSnapshotAndRespond(c echo.Context, actorID, spaceID string, id int64, byAdmin bool) error {
	logger := middleware.Logger(c)
	entry, version, hash, err := h.restoreSnapshot(c.Request().Context(), spaceID, id)
	switch {
	case errors.Is(err, domain.ErrSnapshotHistoryNotFound):
		return echo.NewHTTPError(http.StatusNotFound, "snapshot history entry not found")
	case errors.Is(err, domain.ErrSnapshotNotRestorable):
		return c.JSON(http.StatusConflict, map[string]any{
			"error":   "not_restorable",
			"message": "This snapshot was saved with a different encryption key or a newer data format and can't be restored.",
		})
	case errors.Is(err, domain.ErrSyncVersionConflict):
		return c.JSON(http.StatusConflict, map[string]any{
			"error":   "version_conflict",
			"message": "The workspace changed during the restore. Try again.",
		})
	case errors.Is(err, errBlobPublish):
		logger.Error().
			Err(err).
			Str("space_id", spaceID).
			Int64("history_id", id).
			Int64("reserved_version", version).
			Msg("CRITICAL: snapshot restore rename failed after sync version was advanced; stored blob is stale until re-upload")
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to restore snapshot")
	case err != nil:
		return mapServiceError(err)
	}

	if h.syncHub != nil {
		// Out-of-band: every connected device downloads the restored snapshot
		// instead of treating it as a normal incremental update.
		h.syncHub.NotifyDatabaseUpdate(spaceID, actorID, version, hash, true)
	}

	logger.Info().
		Str("space_id", spaceID).
		Int64("history_id", entry.ID).
		Int64("restored_from_version", entry.SyncVersion).
		Int64("version", version).
		Int64("mutation_version", entry.MutationVersion).
		Int64("size_bytes", entry.SizeBytes).
		Bool("by_admin", byAdmin).
		Msg("Snapshot restored from history")
	h.reportRefusal(c, refusalSnapshotRestored)

	return c.JSON(http.StatusOK, map[string]any{
		"version":          version,
		"mutation_version": entry.MutationVersion,
		"space_id":         spaceID,
		"hash":             hash,
	})
}

// restoreSnapshot promotes history entry id of spaceID under the space's blob
// write lock: the current snapshot goes to history (keeping its origin), a
// copy of the entry is published at the next sync version with the entry's
// metadata and origin "restore". The entry itself stays in history. The
// mutation-version regression guard deliberately does not apply.
func (h *Handlers) restoreSnapshot(
	ctx context.Context,
	spaceID string,
	id int64,
) (entry *domain.SnapshotHistoryEntry, version int64, hash string, err error) {
	hist := h.snapshotHistory()
	if hist == nil {
		return nil, 0, "", errors.New("snapshot history not wired")
	}

	lock := h.blobLocks.get(spaceID)
	lock.Lock()
	defer lock.Unlock()

	current, err := hist.Current(ctx, spaceID)
	if err != nil {
		return nil, 0, "", err
	}
	entry, err = hist.Get(ctx, spaceID, id)
	if err != nil {
		return nil, 0, "", err
	}
	if !entry.RestorableOver(current) {
		return entry, 0, "", domain.ErrSnapshotNotRestorable
	}

	if mkErr := os.MkdirAll(filepath.Dir(current.BlobPath), 0o750); mkErr != nil {
		return entry, 0, "", mkErr
	}
	tempPath, err := copyBlobTemp(entry.FilePath, current.BlobPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return entry, 0, "", domain.ErrSnapshotHistoryNotFound
		}
		return entry, 0, "", err
	}

	version, err = h.publishLocked(ctx, current, tempPath, domain.SnapshotOriginRestore, entry.MutationVersion, func() (int64, error) {
		return hist.AdvanceToEntry(ctx, spaceID, entry, current.SyncVersion)
	})
	return entry, version, entry.Hash, err
}
