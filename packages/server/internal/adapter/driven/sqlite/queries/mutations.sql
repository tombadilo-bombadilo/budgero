-- name: CreateMutation :exec
INSERT INTO mutation_log (
    id, space_id, user_id, version, op, args,
    encrypted_payload, timestamp, base_version, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'));

-- name: GetLatestMutationVersion :one
SELECT COALESCE(MAX(version), 0) AS version
FROM mutation_log
WHERE space_id = ?;

-- name: CountUserMutations :one
SELECT COUNT(*) FROM mutation_log WHERE user_id = ?;

-- name: GetLastUserMutation :one
SELECT id, space_id, user_id, version, op, args, encrypted_payload, timestamp, base_version, created_at
FROM mutation_log
WHERE user_id = ?
ORDER BY timestamp DESC, version DESC
LIMIT 1;

-- name: ListUserMutationDays :many
SELECT
    substr(timestamp, 1, 10) AS day,
    COUNT(*) AS count
FROM mutation_log
WHERE user_id = ?
  AND substr(timestamp, 1, 10) >= ?
  AND substr(timestamp, 1, 10) < ?
GROUP BY substr(timestamp, 1, 10)
ORDER BY day ASC;
