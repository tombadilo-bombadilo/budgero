-- name: GetSpaceBlob :one
SELECT * FROM budget_space_blobs WHERE space_id = ?;

-- name: CreateSpaceBlob :exec
INSERT INTO budget_space_blobs (space_id, blob_path, current_hash, sync_version, size_bytes, encryption_key_version, updated_at)
VALUES (?, ?, '', 0, 0, 1, ?);

-- name: UpdateSpaceSyncState :one
UPDATE budget_space_blobs
SET current_hash = ?,
    sync_version = sync_version + 1,
    size_bytes = ?,
    mutation_version = ?,
    updated_at = datetime('now')
WHERE space_id = ?
RETURNING sync_version;

-- name: UpdateSpaceSyncStateCAS :one
UPDATE budget_space_blobs
SET current_hash = ?,
    sync_version = sync_version + 1,
    size_bytes = ?,
    mutation_version = ?,
    updated_at = datetime('now')
WHERE space_id = ? AND sync_version = ?
RETURNING sync_version;

-- name: UpdateSpaceBlobMetadata :exec
UPDATE budget_space_blobs
SET blob_path = ?, current_hash = ?, sync_version = ?, size_bytes = ?, updated_at = datetime('now')
WHERE space_id = ?;

-- name: DeleteSpaceBlob :exec
DELETE FROM budget_space_blobs WHERE space_id = ?;

-- name: ListSpaceBlobsByOwner :many
SELECT b.space_id, b.blob_path
FROM budget_space_blobs b
INNER JOIN budget_spaces s ON s.space_id = b.space_id
WHERE s.owner_user_id = ?;

-- name: RaiseSpaceDataFormatVersion :exec
UPDATE budget_space_blobs
SET data_format_version = MAX(data_format_version, ?),
    updated_at = datetime('now')
WHERE space_id = ?;

-- name: IncrementEncryptionKeyVersion :one
UPDATE budget_space_blobs
SET encryption_key_version = encryption_key_version + 1,
    updated_at = datetime('now')
WHERE space_id = ?
RETURNING encryption_key_version;
