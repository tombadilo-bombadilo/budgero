-- name: GetLocalCredential :one
SELECT * FROM local_credentials WHERE user_id = ?;

-- name: CreateLocalCredential :exec
INSERT INTO local_credentials (user_id, password_hash, is_admin, created_at)
VALUES (?, ?, ?, datetime('now'));

-- name: UpsertLocalCredential :exec
INSERT INTO local_credentials (user_id, password_hash, is_admin, updated_at)
VALUES (?, ?, ?, datetime('now'))
ON CONFLICT(user_id) DO UPDATE SET
    password_hash = excluded.password_hash,
    is_admin = excluded.is_admin,
    updated_at = datetime('now');

-- name: UpdateLocalCredentialPassword :exec
UPDATE local_credentials
SET password_hash = ?, updated_at = datetime('now')
WHERE user_id = ?;

-- name: SetLocalAdmin :exec
UPDATE local_credentials
SET is_admin = ?, updated_at = datetime('now')
WHERE user_id = ?;

-- name: MarkLocalLogin :exec
UPDATE local_credentials
SET last_login_at = datetime('now')
WHERE user_id = ?;

-- name: IsLocalAdmin :one
SELECT is_admin FROM local_credentials WHERE user_id = ?;
