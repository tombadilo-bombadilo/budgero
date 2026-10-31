package application

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"budgero-server/internal/config"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
	"budgero-server/internal/port/driving"

	"github.com/rs/zerolog/log"
)

// SnapshotHistoryService keeps the snapshots that uploads replace, so a bad
// upload (a near-empty snapshot over a full one) can be undone. Files live in
// <blob dir>/history/<space id>/<sync version>.db, one row each in
// space_blob_history. Works the same on SaaS and self-host: everything is on
// the server's own disk.
type SnapshotHistoryService struct {
	spaceRepo repository.SpaceRepository
	keep      int
	days      int
}

var _ driving.SnapshotHistoryService = (*SnapshotHistoryService)(nil)

// NewSnapshotHistoryService creates a SnapshotHistoryService. A nil cfg uses
// the default retention.
func NewSnapshotHistoryService(spaceRepo repository.SpaceRepository, cfg *config.Config) *SnapshotHistoryService {
	keep, days := config.DefaultSnapshotHistoryKeep, config.DefaultSnapshotHistoryDays
	if cfg != nil {
		keep, days = cfg.SnapshotHistory.Keep, cfg.SnapshotHistory.Days
	}
	return &SnapshotHistoryService{spaceRepo: spaceRepo, keep: max(keep, 0), days: max(days, 0)}
}

// Enabled reports whether replaced snapshots are kept.
func (s *SnapshotHistoryService) Enabled() bool { return s.keep > 0 }

// Current returns the space's current blob metadata.
func (s *SnapshotHistoryService) Current(ctx context.Context, spaceID string) (*domain.SpaceBlob, error) {
	return s.spaceRepo.GetBlob(ctx, spaceID)
}

// Archive moves the current snapshot file into the history folder and records
// it. Nothing is kept when history is disabled or there is no current file
// (first upload). The returned undo moves the file back and drops the row,
// for a publish that fails after the move.
func (s *SnapshotHistoryService) Archive(
	ctx context.Context,
	current *domain.SpaceBlob,
	replacedAt time.Time,
) (*domain.SnapshotHistoryEntry, func() error, error) {
	if !s.Enabled() || current == nil || current.BlobPath == "" || current.SyncVersion == 0 {
		return nil, nil, nil
	}
	info, err := os.Stat(current.BlobPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	if info.IsDir() {
		return nil, nil, nil
	}

	dir := domain.SpaceBlobHistoryDir(current.BlobPath, current.SpaceID)
	if mkErr := os.MkdirAll(dir, 0o750); mkErr != nil {
		return nil, nil, mkErr
	}
	dst := filepath.Join(dir, fmt.Sprintf("%d.db", current.SyncVersion))
	if _, statErr := os.Stat(dst); statErr == nil {
		// Only after a failed publish left the version number reused; never
		// overwrite a kept snapshot.
		dst = filepath.Join(dir, fmt.Sprintf("%d-%d.db", current.SyncVersion, replacedAt.UnixNano()))
	}
	if renameErr := os.Rename(current.BlobPath, dst); renameErr != nil {
		return nil, nil, renameErr
	}
	syncDirBestEffort(dir)

	origin := current.Origin
	if origin == "" {
		origin = domain.SnapshotOriginSync
	}
	becameCurrent := current.PublishedAt
	if becameCurrent.IsZero() {
		becameCurrent = current.UpdatedAt
	}
	entry := &domain.SnapshotHistoryEntry{
		SpaceID:              current.SpaceID,
		FilePath:             dst,
		SyncVersion:          current.SyncVersion,
		MutationVersion:      current.MutationVersion,
		SizeBytes:            info.Size(),
		Hash:                 current.CurrentHash,
		EncryptionKeyVersion: current.EncryptionKeyVersion,
		DataFormatVersion:    current.DataFormatVersion,
		Origin:               origin,
		BecameCurrentAt:      becameCurrent.UTC(),
		ReplacedAt:           replacedAt.UTC(),
	}
	id, err := s.spaceRepo.InsertSnapshotHistory(ctx, entry)
	if err != nil {
		if restoreErr := os.Rename(dst, current.BlobPath); restoreErr != nil {
			return nil, nil, errors.Join(err, restoreErr)
		}
		return nil, nil, err
	}
	entry.ID = id

	// The undo must run even if the request was cancelled meanwhile.
	undoCtx := context.WithoutCancel(ctx)
	undo := func() error {
		rowErr := s.spaceRepo.DeleteSnapshotHistoryEntry(undoCtx, entry.SpaceID, entry.ID)
		return errors.Join(os.Rename(dst, current.BlobPath), rowErr)
	}
	return entry, undo, nil
}

// MarkPublished records how and when the current snapshot was published.
func (s *SnapshotHistoryService) MarkPublished(ctx context.Context, spaceID, origin string, at time.Time) error {
	return s.spaceRepo.MarkBlobPublished(ctx, spaceID, origin, at)
}

// AdvanceToEntry makes entry's metadata current at the next sync version.
func (s *SnapshotHistoryService) AdvanceToEntry(
	ctx context.Context,
	spaceID string,
	entry *domain.SnapshotHistoryEntry,
	expectedVersion int64,
) (int64, error) {
	return s.spaceRepo.RestoreSyncStateCAS(ctx, spaceID, entry, expectedVersion)
}

// Prune keeps the newest keep entries plus, for the last days days, the
// newest entry of each UTC day (by when it became current), and deletes the
// rest (row first, then file: a leftover file is harmless, a row without a
// file is not). A disabled history is left as it is.
func (s *SnapshotHistoryService) Prune(ctx context.Context, spaceID string, now time.Time) (int, error) {
	if !s.Enabled() {
		return 0, nil
	}
	entries, err := s.spaceRepo.ListSnapshotHistory(ctx, spaceID)
	if err != nil {
		return 0, err
	}
	removed := 0
	pruned := SnapshotsToPrune(entries, s.keep, s.days, now)
	for i := range pruned {
		e := &pruned[i]
		if err := s.spaceRepo.DeleteSnapshotHistoryEntry(ctx, spaceID, e.ID); err != nil {
			return removed, err
		}
		if err := os.Remove(e.FilePath); err != nil && !errors.Is(err, os.ErrNotExist) {
			log.Warn().Err(err).Str("space_id", spaceID).Int64("history_id", e.ID).
				Msg("Failed to remove pruned snapshot history file")
		}
		removed++
	}
	return removed, nil
}

// SnapshotsToPrune returns the entries retention drops. entries must be
// newest first. Kept: the first keep entries, and the newest entry of each
// UTC day among those that became current within the last days days.
func SnapshotsToPrune(entries []domain.SnapshotHistoryEntry, keep, days int, now time.Time) []domain.SnapshotHistoryEntry {
	kept := make(map[int64]bool, len(entries))
	for i := 0; i < len(entries) && i < keep; i++ {
		kept[entries[i].ID] = true
	}
	if days > 0 {
		cutoff := now.UTC().Add(-time.Duration(days) * 24 * time.Hour)
		seenDay := make(map[string]bool, days+1)
		for i := range entries {
			at := entries[i].BecameCurrentAt.UTC()
			if at.Before(cutoff) {
				continue
			}
			day := at.Format(time.DateOnly)
			if !seenDay[day] {
				seenDay[day] = true
				kept[entries[i].ID] = true
			}
		}
	}
	var drop []domain.SnapshotHistoryEntry
	for i := range entries {
		if !kept[entries[i].ID] {
			drop = append(drop, entries[i])
		}
	}
	return drop
}

// List returns the space's history, newest first.
func (s *SnapshotHistoryService) List(ctx context.Context, spaceID string) ([]domain.SnapshotHistoryEntry, error) {
	return s.spaceRepo.ListSnapshotHistory(ctx, spaceID)
}

// Get returns one entry of the space's history.
func (s *SnapshotHistoryService) Get(ctx context.Context, spaceID string, id int64) (*domain.SnapshotHistoryEntry, error) {
	return s.spaceRepo.GetSnapshotHistoryEntry(ctx, spaceID, id)
}

// removeSnapshotHistoryFiles deletes a space's history folder. Callers delete
// the rows (repository DeleteBlob) themselves.
func removeSnapshotHistoryFiles(blobPath, spaceID string) error {
	if blobPath == "" || spaceID == "" {
		return nil
	}
	return os.RemoveAll(domain.SpaceBlobHistoryDir(blobPath, spaceID))
}

// syncDirBestEffort fsyncs a directory so a completed rename survives a crash.
func syncDirBestEffort(dir string) {
	d, err := os.Open(dir) //nolint:gosec // G304: dir is the server-controlled history directory
	if err != nil {
		return
	}
	_ = d.Sync()
	_ = d.Close()
}
