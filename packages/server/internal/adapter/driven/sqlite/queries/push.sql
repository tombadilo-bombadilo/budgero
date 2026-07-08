-- name: GetPushQueueItem :one
SELECT * FROM push_queue WHERE id = ?;

-- name: CreatePushQueueItem :exec
INSERT INTO push_queue (
    id, user_id, space_id, message_id, encrypted_payload, status, created_at
) VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'));

-- name: MarkPushProcessed :exec
UPDATE push_queue
SET status = 'processed', processed_at = datetime('now')
WHERE id = ?;

-- name: UpdatePushQueueItemStatus :exec
UPDATE push_queue
SET status = ?, processed_at = datetime('now')
WHERE id = ? AND user_id = ?;

-- name: ListPendingPushItems :many
SELECT * FROM push_queue
WHERE space_id = ? AND status = 'pending'
ORDER BY created_at ASC;

-- name: ListPendingPushItemsForUser :many
SELECT * FROM push_queue
WHERE user_id = ? AND status = 'pending'
ORDER BY created_at ASC
LIMIT 100;

-- name: ListPendingPushItemsForUserAndSpace :many
SELECT * FROM push_queue
WHERE user_id = ? AND space_id = ? AND status = 'pending'
ORDER BY created_at ASC
LIMIT 100;

-- name: DeletePushQueueItem :exec
DELETE FROM push_queue WHERE id = ?;

-- name: DeleteProcessedPushItems :exec
DELETE FROM push_queue
WHERE status = 'processed' AND processed_at < ?;

-- name: ClearPendingPushQueue :execresult
DELETE FROM push_queue
WHERE user_id = ? AND status = 'pending';

-- name: ClearAllPushQueue :execresult
DELETE FROM push_queue
WHERE user_id = ?;

-- name: GetPushQueueStats :one
SELECT
    COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
    COALESCE(SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END), 0) AS processed_count,
    COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_count
FROM push_queue
WHERE user_id = ?;

-- name: CheckDuplicateMessageID :one
SELECT id, status FROM push_queue
WHERE space_id = ? AND message_id = ?
LIMIT 1;

-- name: GetPushAPIToken :one
SELECT * FROM push_api_tokens WHERE user_id = ?;

-- name: GetPushAPITokenByHash :one
SELECT * FROM push_api_tokens WHERE token_hash = ?;

-- name: CreatePushAPIToken :exec
INSERT INTO push_api_tokens (user_id, token_hash, space_id, created_at, is_enabled)
VALUES (?, ?, ?, datetime('now'), 1);

-- name: UpsertPushAPIToken :exec
INSERT INTO push_api_tokens (user_id, token_hash, space_id, created_at, is_enabled)
VALUES (?, ?, ?, datetime('now'), 1)
ON CONFLICT(user_id) DO UPDATE SET
    token_hash = excluded.token_hash,
    space_id = excluded.space_id,
    created_at = excluded.created_at,
    is_enabled = 1,
    last_used = NULL;

-- name: UpdatePushAPIToken :exec
UPDATE push_api_tokens
SET token_hash = ?, space_id = ?, last_used = NULL, is_enabled = 1
WHERE user_id = ?;

-- name: MarkPushTokenUsed :exec
UPDATE push_api_tokens
SET last_used = datetime('now')
WHERE user_id = ?;

-- name: SetPushTokenEnabled :exec
UPDATE push_api_tokens SET is_enabled = ? WHERE user_id = ?;

-- name: DisablePushToken :exec
UPDATE push_api_tokens SET is_enabled = 0 WHERE user_id = ?;

-- name: DeletePushAPIToken :exec
DELETE FROM push_api_tokens WHERE user_id = ?;
