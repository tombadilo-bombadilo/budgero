-- name: CountAllUsers :one
SELECT COUNT(*) FROM users;

-- name: CountActiveUsers :one
SELECT COUNT(*) FROM users
WHERE subscription_status IN ('active', 'trialing', 'on_trial')
OR is_founding_member = 1
OR (has_beta_access = 1 AND (beta_expires_at IS NULL OR beta_expires_at > datetime('now')));

-- name: CountTrialUsers :one
SELECT COUNT(*) FROM users
WHERE subscription_status IN ('trialing', 'on_trial');

-- name: CountPaidUsers :one
SELECT COUNT(*) FROM users
WHERE subscription_status = 'active';

-- name: CountBetaUsers :one
SELECT COUNT(*) FROM users
WHERE has_beta_access = 1;

-- name: CountFoundingMembers :one
SELECT COUNT(*) FROM users
WHERE is_founding_member = 1;

-- name: ListUsersForAdmin :many
SELECT
       u.id, u.name, u.email, u.created_at,
       c.last_login_at,
       subscription_status, subscription_id, customer_id, variant_id,
       subscription_ends_at, trial_ends_at, current_period_end,
       has_beta_access, beta_expires_at, is_founding_member,
       is_master_password_set, has_collaboration_access, is_blocked,
       COALESCE(c.is_admin, 0) AS is_admin
FROM users u
LEFT JOIN local_credentials c ON c.user_id = u.id
ORDER BY u.created_at DESC;

-- name: GetUserForAdmin :one
SELECT
       u.id, u.name, u.email, u.created_at,
       c.last_login_at,
       subscription_status, subscription_id, customer_id, variant_id,
       subscription_ends_at, trial_ends_at, current_period_end,
       has_beta_access, beta_expires_at, is_founding_member,
       is_master_password_set, has_collaboration_access, is_blocked,
       COALESCE(c.is_admin, 0) AS is_admin
FROM users u
LEFT JOIN local_credentials c ON c.user_id = u.id
WHERE u.id = ?
LIMIT 1;

-- name: RevokeAllUserAccess :exec
UPDATE users
SET subscription_status = 'inactive',
    has_beta_access = 0,
    beta_expires_at = NULL,
    is_founding_member = 0,
    has_collaboration_access = 0
WHERE id = ?;

-- name: ListUsersWithSubscription :many
SELECT id, subscription_id FROM users
WHERE subscription_id IS NOT NULL AND subscription_id <> '';

-- name: UpdateUserSubscriptionFull :exec
UPDATE users SET
    subscription_status = ?,
    subscription_id = ?,
    variant_id = ?,
    subscription_ends_at = ?,
    trial_ends_at = ?,
    current_period_end = ?
WHERE id = ?;

-- name: MigrateUserID :exec
UPDATE users SET id = ?, name = ?, email = ? WHERE id = ?;

-- Self-host admin queries

-- name: CountLocalAccounts :one
SELECT COUNT(*) FROM local_credentials;

-- name: CountAdminUsers :one
SELECT COUNT(*) FROM local_credentials WHERE is_admin = 1;

-- name: CountMasterPasswordUsers :one
SELECT COUNT(*) FROM users WHERE is_master_password_set = 1;

-- name: CountSpaces :one
SELECT COUNT(*) FROM budget_spaces;

-- name: CountSpacesWithMembers :one
SELECT COUNT(DISTINCT space_id) FROM budget_space_members;

-- name: CountMemberships :one
SELECT COUNT(*) FROM budget_space_members;

-- name: SumSpaceBlobBytes :one
SELECT COALESCE(SUM(size_bytes), 0) FROM budget_space_blobs;

-- name: CountPendingInvites :one
SELECT COUNT(*) FROM budget_space_invites WHERE status = 'pending';

-- name: ListRecentUsers :many
SELECT id, name, email, created_at
FROM users
ORDER BY created_at DESC
LIMIT 5;

-- name: ListSelfHostUsers :many
SELECT
    u.id,
    u.name,
    u.email,
    u.created_at,
    u.is_master_password_set,
    u.is_blocked,
    c.last_login_at,
    COALESCE(c.is_admin, 0) AS is_admin,
    CASE WHEN c.user_id IS NOT NULL THEN 1 ELSE 0 END AS has_local_password,
    (SELECT COUNT(*) FROM budget_space_members m WHERE m.user_id = u.id) AS membership_count,
    (SELECT COUNT(*) FROM budget_spaces s WHERE s.owner_user_id = u.id) AS owned_space_count
FROM users u
LEFT JOIN local_credentials c ON c.user_id = u.id
ORDER BY u.created_at DESC;

-- Saved queries for database explorer

-- name: ListSavedQueries :many
SELECT id, name, query, created_at, updated_at
FROM saved_queries
ORDER BY name ASC;

-- name: GetSavedQueryByName :one
SELECT id, name, query, created_at, updated_at
FROM saved_queries
WHERE name = ?;

-- name: CreateSavedQuery :one
INSERT INTO saved_queries (name, query)
VALUES (?, ?)
RETURNING id, name, query, created_at, updated_at;

-- name: UpdateSavedQuery :exec
UPDATE saved_queries
SET query = ?, updated_at = datetime('now')
WHERE name = ?;

-- name: DeleteSavedQuery :exec
DELETE FROM saved_queries WHERE name = ?;
