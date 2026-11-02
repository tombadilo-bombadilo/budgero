-- name: MarkSpaceBlobPublished :exec
UPDATE budget_space_blobs
SET origin = ?, published_at = ?
WHERE space_id = ?;

-- name: RestoreSpaceSyncStateCAS :one
-- Promotes a history entry: the current snapshot takes the entry's bytes
-- (hash, size, mutation cursor, key and data format) at the next version.
UPDATE budget_space_blobs
SET current_hash = ?,
    sync_version = sync_version + 1,
    size_bytes = ?,
    mutation_version = ?,
    encryption_key_version = ?,
    data_format_version = ?,
    updated_at = datetime('now')
WHERE space_id = ? AND sync_version = ?
RETURNING sync_version;

-- name: InsertSpaceBlobHistory :one
INSERT INTO space_blob_history (
    space_id, file_path, sync_version, mutation_version, size_bytes, hash,
    encryption_key_version, data_format_version, origin, became_current_at, replaced_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING id;

-- name: ListSpaceBlobHistory :many
SELECT * FROM space_blob_history
WHERE space_id = ?
ORDER BY sync_version DESC, id DESC;

-- name: GetSpaceBlobHistoryEntry :one
SELECT * FROM space_blob_history
WHERE space_id = ? AND id = ?;

-- name: DeleteSpaceBlobHistoryEntry :exec
DELETE FROM space_blob_history
WHERE space_id = ? AND id = ?;

-- name: DeleteSpaceBlobHistory :exec
DELETE FROM space_blob_history WHERE space_id = ?;

-- name: GetSpaceResetFloor :one
SELECT reset_floor FROM budget_space_blobs WHERE space_id = ?;

-- name: RaiseSpaceResetFloor :exec
UPDATE budget_space_blobs
SET reset_floor = MAX(reset_floor, CAST(sqlc.arg(floor) AS INTEGER))
WHERE space_id = sqlc.arg(space_id);
