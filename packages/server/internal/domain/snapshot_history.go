package domain

import (
	"path/filepath"
	"time"
)

// Snapshot origins: how a space snapshot became current.
const (
	// SnapshotOriginSync is a normal device upload.
	SnapshotOriginSync = "sync"
	// SnapshotOriginOutOfBand is an import or restore upload (X-Out-Of-Band).
	SnapshotOriginOutOfBand = "out_of_band"
	// SnapshotOriginRestore is a promotion from the server-side history.
	SnapshotOriginRestore = "restore"
)

// SnapshotHistoryEntry is a space snapshot that was replaced and kept on the
// server so it can be downloaded or restored.
type SnapshotHistoryEntry struct {
	ID                   int64     `json:"id"`
	SpaceID              string    `json:"space_id"`
	FilePath             string    `json:"-"`
	SyncVersion          int64     `json:"sync_version"`
	MutationVersion      int64     `json:"mutation_version"`
	SizeBytes            int64     `json:"size_bytes"`
	Hash                 string    `json:"hash"`
	EncryptionKeyVersion int64     `json:"encryption_key_version"`
	DataFormatVersion    int64     `json:"data_format_version"`
	Origin               string    `json:"origin"`
	BecameCurrentAt      time.Time `json:"became_current_at"`
	ReplacedAt           time.Time `json:"replaced_at"`
}

// RestorableOver reports whether the entry can replace current: it must be
// encrypted with the space's current key and in a data format current
// clients of the space already understand.
func (e *SnapshotHistoryEntry) RestorableOver(current *SpaceBlob) bool {
	if e == nil || current == nil {
		return false
	}
	return e.EncryptionKeyVersion == current.EncryptionKeyVersion &&
		e.DataFormatVersion <= current.DataFormatVersion
}

// SpaceBlobHistoryDir is the directory holding a space's snapshot history:
// <blob dir>/history/<space id>.
func SpaceBlobHistoryDir(blobPath, spaceID string) string {
	return filepath.Join(filepath.Dir(blobPath), "history", spaceID)
}
