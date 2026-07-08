-- name: GetUserByID :one
SELECT * FROM users WHERE id = ?;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = ?;

-- name: GetUserByCustomerID :one
SELECT * FROM users WHERE customer_id = ?;

-- name: CreateUser :one
-- Analytics is OPT-IN: new users start with analytics disabled and must
-- enable it explicitly in Settings (the column's legacy DEFAULT 0 predates
-- the opt-in policy and only governs pre-existing rows).
INSERT INTO users (
    id, name, email, db_path, is_master_password_set,
    subscription_status, trial_ends_at, created_at, primary_space_id,
    current_db_hash, sync_version, is_analytics_disabled
) VALUES (?, ?, ?, '', 0, ?, ?, ?, NULL, '', 0, 1)
RETURNING *;

-- name: UpdateUser :exec
UPDATE users SET name = ?, email = ? WHERE id = ?;

-- name: UpdateUserPrimarySpace :exec
UPDATE users SET primary_space_id = ? WHERE id = ?;

-- name: MarkUserSubscribedIfFirstTime :exec
-- Sets users.subscribed_at = ? only when the column is currently NULL.
-- Called from the subscription_created webhook handler to capture the
-- user's first paid transition; renewals are no-ops here.
UPDATE users SET subscribed_at = ? WHERE id = ? AND subscribed_at IS NULL;

-- name: SetMasterPasswordStatus :exec
UPDATE users SET is_master_password_set = ? WHERE id = ?;

-- name: SetOnboardingState :exec
UPDATE users
SET onboarding_status = ?, onboarding_completed_at = ?, onboarding_snoozed_until = ?
WHERE id = ?;

-- name: SetReferralSource :exec
-- Records how the user discovered Budgero (onboarding "How did you hear about
-- us?" step). Only written when the user provides a non-empty answer.
UPDATE users SET where_heard_about = ? WHERE id = ?;

-- name: UpdateBackupSettings :exec
UPDATE users
SET backup_reminder_frequency_days = ?, last_user_db_backup = ?
WHERE id = ?;

-- name: BlockUser :exec
UPDATE users SET is_blocked = ? WHERE id = ?;

-- name: IsUserBlocked :one
SELECT is_blocked FROM users WHERE id = ?;

-- name: DeleteUser :exec
DELETE FROM users WHERE id = ?;

-- name: UpdateSubscription :exec
UPDATE users
SET subscription_status = ?, subscription_id = ?, customer_id = ?,
    variant_id = ?, subscription_ends_at = ?, current_period_end = ?, trial_ends_at = ?
WHERE id = ?;

-- name: UpdateSubscriptionStatus :exec
UPDATE users
SET subscription_status = ?, subscription_ends_at = ?, current_period_end = ?
WHERE id = ?;

-- name: UpdateSubscriptionAfterResume :exec
UPDATE users
SET subscription_status = ?, subscription_ends_at = NULL,
    current_period_end = ?, variant_id = ?, trial_ends_at = ?
WHERE id = ?;

-- name: GrantFoundingMemberAccess :exec
UPDATE users
SET is_founding_member = 1, has_beta_access = 0, beta_expires_at = NULL
WHERE id = ?;

-- name: GrantBetaAccess :exec
UPDATE users SET has_beta_access = 1, beta_expires_at = ? WHERE id = ?;

-- name: RevokeBetaAccess :exec
UPDATE users SET has_beta_access = 0, beta_expires_at = NULL WHERE id = ?;

-- name: SetCollaborationAccess :exec
UPDATE users SET has_collaboration_access = ? WHERE id = ?;

-- name: ResetUserData :exec
UPDATE users
SET is_master_password_set = 0,
    current_db_hash = '',
    sync_version = 0,
    onboarding_status = 'pending',
    onboarding_completed_at = NULL,
    onboarding_snoozed_until = NULL,
    primary_space_id = NULL
WHERE id = ?;

-- name: BackfillTrialForInactiveUsers :execresult
UPDATE users
SET subscription_status = 'trialing',
    trial_ends_at = datetime(created_at, '+' || ? || ' days')
WHERE subscription_status = 'inactive'
AND trial_ends_at IS NULL;

-- name: ListAllUsers :many
SELECT * FROM users ORDER BY created_at DESC;

-- name: SetAnalyticsDisabled :exec
UPDATE users SET is_analytics_disabled = ? WHERE id = ?;

-- name: SetTrialSignalsDisabled :exec
UPDATE users SET is_trial_signals_disabled = ? WHERE id = ?;

-- name: ClearDanglingPrimarySpaceIDs :exec
UPDATE users SET primary_space_id = NULL
WHERE primary_space_id IS NOT NULL
AND primary_space_id NOT IN (SELECT space_id FROM budget_spaces);

-- name: CountUsers :one
SELECT COUNT(*) FROM users;

