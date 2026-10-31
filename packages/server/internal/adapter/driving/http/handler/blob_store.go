package handler

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"budgero-server/internal/domain"
	"budgero-server/internal/port/driving"

	"github.com/rs/zerolog/log"
)

// errBlobPublish marks a failure to move an uploaded blob into place AFTER its
// sync metadata was advanced. It is the only window in which the stored bytes
// can lag the recorded hash; clients detect it by verifying X-Database-Hash.
var errBlobPublish = errors.New("failed to publish blob file")

// spaceBlobLocks serializes blob replacement against blob reads, per space.
// Writers hold the write lock across the metadata advance and the rename;
// readers hold the read lock across the metadata read and the file open, so a
// download never pairs new version/hash/cursor headers with old bytes.
type spaceBlobLocks struct {
	mu    sync.Mutex
	locks map[string]*sync.RWMutex
}

func (l *spaceBlobLocks) get(spaceID string) *sync.RWMutex {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.locks == nil {
		l.locks = make(map[string]*sync.RWMutex)
	}
	lock, ok := l.locks[spaceID]
	if !ok {
		lock = &sync.RWMutex{}
		l.locks[spaceID] = lock
	}
	return lock
}

// openSpaceBlob resolves the space, then reads its blob metadata and opens the
// blob file under the space's read lock. The returned file (nil when openErr is
// set) stays consistent with the metadata even if an upload replaces the path
// afterwards: rename swaps the directory entry, not the open inode. A non-nil
// err is a metadata/access error for mapServiceError.
func (h *Handlers) openSpaceBlob(ctx context.Context, userID, spaceParam string) (blob *domain.SpaceBlob, file *os.File, openErr, err error) {
	spaceID, err := h.services.Space.ResolveSpaceID(ctx, userID, spaceParam)
	if err != nil {
		return nil, nil, nil, err
	}

	lock := h.blobLocks.get(spaceID)
	lock.RLock()
	defer lock.RUnlock()

	blob, err = h.services.Space.GetBlobMetadata(ctx, userID, spaceID)
	if err != nil {
		return nil, nil, nil, err
	}
	file, openErr = os.Open(blob.BlobPath)
	if openErr != nil {
		return blob, nil, openErr, nil
	}
	return blob, file, nil, nil
}

// getSyncStateLocked reads a space's sync state under its blob read lock, so
// it never reports a version whose blob is still being moved into place.
func (h *Handlers) getSyncStateLocked(ctx context.Context, userID, spaceParam string) (*domain.SyncState, error) {
	spaceID, err := h.services.Space.ResolveSpaceID(ctx, userID, spaceParam)
	if err != nil {
		return nil, err
	}

	lock := h.blobLocks.get(spaceID)
	lock.RLock()
	defer lock.RUnlock()
	return h.services.Space.GetSyncState(ctx, userID, spaceID)
}

// writeBlobTemp writes data to a uniquely named temp file next to blobPath and
// fsyncs it, so concurrent uploads never share (and corrupt) a temp file and a
// later rename publishes complete bytes.
func writeBlobTemp(blobPath string, data []byte) (string, error) {
	tmp, err := os.CreateTemp(filepath.Dir(blobPath), filepath.Base(blobPath)+".upload-*")
	if err != nil {
		return "", err
	}
	tempPath := tmp.Name()
	if _, err = tmp.Write(data); err == nil {
		err = tmp.Sync()
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(tempPath)
		return "", err
	}
	return tempPath, nil
}

// commitBlob publishes an already-written temp file as the space's blob.
// Under the space's write lock it first runs advance (the sync-state update,
// usually a compare-and-swap) and only renames the temp file into place when
// that succeeds; on any advance error the temp file is discarded and the old
// blob stays live. The snapshot being replaced is moved into the space's
// history first (see publishLocked). A rename failure after a successful
// advance is reported as errBlobPublish wrapped together with the new version.
func (h *Handlers) commitBlob(
	ctx context.Context,
	spaceID, tempPath, blobPath, origin string,
	advance func() (int64, error),
) (int64, error) {
	lock := h.blobLocks.get(spaceID)
	lock.Lock()
	defer lock.Unlock()

	// Read under the lock: this is exactly the snapshot the rename replaces.
	prev := &domain.SpaceBlob{SpaceID: spaceID}
	if hist := h.snapshotHistory(); hist != nil {
		if current, err := hist.Current(ctx, spaceID); err == nil {
			prev = current
		} else {
			log.Warn().Err(err).Str("space_id", spaceID).
				Msg("Could not read the current snapshot; it will not be kept in history")
		}
	}
	prev.BlobPath = blobPath
	return h.publishLocked(ctx, prev, tempPath, origin, advance)
}

// publishLocked is the publish protocol; the caller holds prev.SpaceID's
// blob write lock. Order: advance the metadata, move the current file into
// history (best effort: a history failure never blocks sync), rename the temp
// file into place, record the origin, prune history. If the rename fails, the
// archived file is moved back so the (stale) blob stays served as before.
func (h *Handlers) publishLocked(
	ctx context.Context,
	prev *domain.SpaceBlob,
	tempPath, origin string,
	advance func() (int64, error),
) (int64, error) {
	version, err := advance()
	if err != nil {
		_ = os.Remove(tempPath)
		return 0, err
	}

	hist := h.snapshotHistory()
	now := time.Now().UTC()
	var undo func() error
	if hist != nil {
		archived, undoFn, archiveErr := hist.Archive(ctx, prev, now)
		if archiveErr != nil {
			log.Error().Err(archiveErr).
				Str("space_id", prev.SpaceID).
				Int64("replaced_version", prev.SyncVersion).
				Msg("Failed to keep replaced snapshot in history; publishing without it")
		} else if archived != nil {
			undo = undoFn
		}
	}

	if err := os.Rename(tempPath, prev.BlobPath); err != nil {
		_ = os.Remove(tempPath)
		if undo != nil {
			if undoErr := undo(); undoErr != nil {
				log.Error().Err(undoErr).Str("space_id", prev.SpaceID).
					Msg("CRITICAL: failed to move the archived snapshot back after a failed publish")
			}
		}
		return version, fmt.Errorf("%w: %w", errBlobPublish, err)
	}
	syncDir(filepath.Dir(prev.BlobPath))

	if hist != nil {
		if err := hist.MarkPublished(ctx, prev.SpaceID, origin, now); err != nil {
			log.Warn().Err(err).Str("space_id", prev.SpaceID).Msg("Failed to record snapshot origin")
		}
		if removed, err := hist.Prune(ctx, prev.SpaceID, now); err != nil {
			log.Warn().Err(err).Str("space_id", prev.SpaceID).Msg("Failed to prune snapshot history")
		} else if removed > 0 {
			log.Debug().Str("space_id", prev.SpaceID).Int("removed", removed).Msg("Pruned snapshot history")
		}
	}
	return version, nil
}

// snapshotHistory is the history service, or nil when it isn't wired.
func (h *Handlers) snapshotHistory() driving.SnapshotHistoryService {
	if h.services == nil || h.services.SnapshotHistory == nil {
		return nil
	}
	return h.services.SnapshotHistory
}

// copyBlobTemp copies src into a uniquely named, fsynced temp file next to
// blobPath, for publishing with commitBlob/publishLocked. src is untouched.
func copyBlobTemp(src, blobPath string) (string, error) {
	in, err := os.Open(src) //nolint:gosec // G304: src is a server-recorded history path
	if err != nil {
		return "", err
	}
	defer func() { _ = in.Close() }()

	tmp, err := os.CreateTemp(filepath.Dir(blobPath), filepath.Base(blobPath)+".restore-*")
	if err != nil {
		return "", err
	}
	tempPath := tmp.Name()
	if _, err = io.Copy(tmp, in); err == nil {
		err = tmp.Sync()
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(tempPath)
		return "", err
	}
	return tempPath, nil
}

// syncDir best-effort fsyncs a directory so a completed rename survives a crash.
func syncDir(dir string) {
	d, err := os.Open(dir) //nolint:gosec // G304: dir is the server-controlled blob directory
	if err != nil {
		return
	}
	_ = d.Sync()
	_ = d.Close()
}
