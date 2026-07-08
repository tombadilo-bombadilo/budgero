-- name: UpsertTrialSignal :exec
INSERT INTO trial_signals (
    user_id, kind, day, count, first_at, last_at
) VALUES (?, ?, ?, 1, ?, ?)
ON CONFLICT(user_id, kind, day) DO UPDATE SET
    count   = trial_signals.count + 1,
    last_at = excluded.last_at;

-- name: CountDistinctLoggingDaysInRange :one
SELECT COUNT(*) AS distinct_days
FROM trial_signals
WHERE user_id = ?
  AND kind = 'daily_logging'
  AND day >= ?
  AND day <= ?;

-- name: CountSignalsOfKind :one
SELECT CAST(COALESCE(SUM(count), 0) AS INTEGER) AS total
FROM trial_signals
WHERE user_id = ?
  AND kind = ?;

-- name: CountDistinctMonthsForKind :one
-- Counts distinct rows for a kind. For the *_in_month signal kinds the
-- `day` column stores YYYY-MM-01 of the month being tracked, so distinct
-- rows = distinct months. For other kinds the result is "distinct days
-- on which the signal fired" which isn't meaningful; callers should only
-- use this for the *_in_month kinds.
SELECT COUNT(*) AS total
FROM trial_signals
WHERE user_id = ?
  AND kind = ?;

-- name: GetEarliestSignalAt :one
SELECT first_at
FROM trial_signals
WHERE user_id = ?
  AND kind = ?
ORDER BY first_at ASC
LIMIT 1;

-- name: GetNthSignalAt :one
SELECT first_at
FROM trial_signals
WHERE user_id = ?
  AND kind = ?
ORDER BY first_at ASC
LIMIT 1 OFFSET ?;

-- name: UpsertTrialProgress :exec
INSERT INTO trial_progress (
    user_id,
    trial_started_at,
    daily_logging_distinct_days,
    reconciliation_count,
    first_reconciliation_at,
    second_reconciliation_at,
    budget_cycle_assigned_at,
    overspend_covered_at,
    goal_funded_at,
    rule_applied_historical_at,
    monthly_review_at,
    tier1_unlocked_at,
    tier2_unlocked_at,
    tier3_unlocked_at,
    updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(user_id) DO UPDATE SET
    daily_logging_distinct_days = excluded.daily_logging_distinct_days,
    reconciliation_count        = excluded.reconciliation_count,
    first_reconciliation_at     = COALESCE(trial_progress.first_reconciliation_at, excluded.first_reconciliation_at),
    second_reconciliation_at    = COALESCE(trial_progress.second_reconciliation_at, excluded.second_reconciliation_at),
    budget_cycle_assigned_at    = COALESCE(trial_progress.budget_cycle_assigned_at, excluded.budget_cycle_assigned_at),
    overspend_covered_at        = COALESCE(trial_progress.overspend_covered_at, excluded.overspend_covered_at),
    goal_funded_at              = COALESCE(trial_progress.goal_funded_at, excluded.goal_funded_at),
    rule_applied_historical_at  = COALESCE(trial_progress.rule_applied_historical_at, excluded.rule_applied_historical_at),
    monthly_review_at           = COALESCE(trial_progress.monthly_review_at, excluded.monthly_review_at),
    tier1_unlocked_at           = COALESCE(trial_progress.tier1_unlocked_at, excluded.tier1_unlocked_at),
    tier2_unlocked_at           = COALESCE(trial_progress.tier2_unlocked_at, excluded.tier2_unlocked_at),
    tier3_unlocked_at           = COALESCE(trial_progress.tier3_unlocked_at, excluded.tier3_unlocked_at),
    updated_at                  = excluded.updated_at;

-- name: GetTrialProgress :one
SELECT
    user_id,
    trial_started_at,
    daily_logging_distinct_days,
    reconciliation_count,
    first_reconciliation_at,
    second_reconciliation_at,
    budget_cycle_assigned_at,
    overspend_covered_at,
    goal_funded_at,
    rule_applied_historical_at,
    monthly_review_at,
    tier1_unlocked_at,
    tier2_unlocked_at,
    tier3_unlocked_at,
    updated_at
FROM trial_progress
WHERE user_id = ?;

-- name: CreateDiscountCode :exec
INSERT INTO trial_discount_codes (
    code, user_id, tier, percent_off, ls_discount_id,
    generated_at, valid_from, valid_until
) VALUES (?, ?, ?, ?, ?, ?, ?, ?);

-- name: GetDiscountCodeByCode :one
SELECT
    code, user_id, tier, percent_off, ls_discount_id,
    generated_at, valid_from, valid_until, redeemed_at, redeemed_sub_id
FROM trial_discount_codes
WHERE code = ?;

-- name: GetDiscountCodeByUserTier :one
SELECT
    code, user_id, tier, percent_off, ls_discount_id,
    generated_at, valid_from, valid_until, redeemed_at, redeemed_sub_id
FROM trial_discount_codes
WHERE user_id = ? AND tier = ?;

-- name: ListDiscountCodesByUser :many
SELECT
    code, user_id, tier, percent_off, ls_discount_id,
    generated_at, valid_from, valid_until, redeemed_at, redeemed_sub_id
FROM trial_discount_codes
WHERE user_id = ?
ORDER BY tier ASC;

-- name: MarkDiscountCodeRedeemed :exec
UPDATE trial_discount_codes
SET redeemed_at = ?, redeemed_sub_id = ?
WHERE code = ? AND redeemed_at IS NULL;

-- name: ExtendDiscountCodeValidity :exec
UPDATE trial_discount_codes
SET valid_until = ?
WHERE code = ?;

-- name: CountUserMutationsForForgeryCheck :one
SELECT COUNT(*) AS total
FROM mutation_log
WHERE user_id = ?;

-- name: DevDeleteTrialSignalsForUser :exec
DELETE FROM trial_signals WHERE user_id = ?;

-- name: DevDeleteTrialProgressForUser :exec
DELETE FROM trial_progress WHERE user_id = ?;

-- name: DevDeleteTrialDiscountCodesForUser :exec
DELETE FROM trial_discount_codes WHERE user_id = ?;
