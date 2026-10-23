package handler

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"budgero-server/internal/domain"
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
// blob stays live. A rename failure after a successful advance is reported as
// errBlobPublish wrapped together with the new version.
func (h *Handlers) commitBlob(spaceID, tempPath, blobPath string, advance func() (int64, error)) (int64, error) {
	lock := h.blobLocks.get(spaceID)
	lock.Lock()
	defer lock.Unlock()

	version, err := advance()
	if err != nil {
		_ = os.Remove(tempPath)
		return 0, err
	}
	if err := os.Rename(tempPath, blobPath); err != nil {
		_ = os.Remove(tempPath)
		return version, fmt.Errorf("%w: %w", errBlobPublish, err)
	}
	syncDir(filepath.Dir(blobPath))
	return version, nil
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
