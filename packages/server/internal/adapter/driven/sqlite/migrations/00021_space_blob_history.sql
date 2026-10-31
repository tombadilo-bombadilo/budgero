-- +goose Up
-- Server-side snapshot history. Every publish moves the snapshot it replaces
-- into data/budget_spaces/history/<space_id>/<sync_version>.db and records it
-- here, so a bad upload (a near-empty snapshot over a full one) can be undone
-- by promoting an older entry. Retention is pruned after each publish
-- (SNAPSHOT_HISTORY_KEEP / SNAPSHOT_HISTORY_DAYS).
--
-- origin says how a snapshot became current: a normal device upload ('sync'),
-- an import/restore upload flagged X-Out-Of-Band ('out_of_band'), or a
-- promotion from this history ('restore').
ALTER TABLE budget_space_blobs ADD COLUMN origin TEXT DEFAULT 'sync'
    CHECK (origin IS NULL OR origin IN ('sync', 'out_of_band', 'restore'));
-- When the current snapshot was published. NULL for snapshots published
-- before this migration (history falls back to updated_at).
ALTER TABLE budget_space_blobs ADD COLUMN published_at DATETIME;

CREATE TABLE IF NOT EXISTS space_blob_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    sync_version INTEGER NOT NULL,
    mutation_version INTEGER NOT NULL DEFAULT 0,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    hash TEXT NOT NULL DEFAULT '',
    encryption_key_version INTEGER NOT NULL DEFAULT 1,
    data_format_version INTEGER NOT NULL DEFAULT 1,
    origin TEXT NOT NULL DEFAULT 'sync' CHECK (origin IN ('sync', 'out_of_band', 'restore')),
    became_current_at DATETIME NOT NULL,
    replaced_at DATETIME NOT NULL,
    FOREIGN KEY (space_id) REFERENCES budget_spaces(space_id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_space_blob_history_space
    ON space_blob_history(space_id, sync_version);

-- +goose Down
DROP INDEX IF EXISTS idx_space_blob_history_space;
DROP TABLE IF EXISTS space_blob_history;
ALTER TABLE budget_space_blobs DROP COLUMN published_at;
ALTER TABLE budget_space_blobs DROP COLUMN origin;
