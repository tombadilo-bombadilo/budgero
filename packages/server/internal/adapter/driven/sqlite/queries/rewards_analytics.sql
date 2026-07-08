-- The substr(col, 1, 19) calls below trim Go's t.String() output
-- ("2026-04-01 22:37:12.999 +0200 CEST m=+...") down to "2026-04-01 22:37:12"
-- which strftime can actually parse. Without this, modernc.org/sqlite's
-- t.String() bind format makes strftime return NULL for every row, collapsing
-- the chart to a single NULL bucket. Safe for RFC3339-style values too.

-- name: AnalyticsSignupsByPeriod :many
SELECT strftime(?, substr(created_at, 1, 19)) AS period, COUNT(*) AS count
FROM users
WHERE created_at IS NOT NULL
  AND created_at >= ?
  AND created_at < ?
  AND email NOT LIKE '%@clerk.user'
GROUP BY period
ORDER BY period;

-- name: AnalyticsSubscriptionsByPeriod :many
SELECT strftime(?, substr(subscribed_at, 1, 19)) AS period, COUNT(*) AS count
FROM users
WHERE subscribed_at IS NOT NULL
  AND subscribed_at >= ?
  AND subscribed_at < ?
GROUP BY period
ORDER BY period;

-- name: AnalyticsTier1UnlocksByPeriod :many
SELECT strftime(?, substr(tier1_unlocked_at, 1, 19)) AS period, COUNT(*) AS count
FROM trial_progress
WHERE tier1_unlocked_at IS NOT NULL
  AND tier1_unlocked_at >= ?
  AND tier1_unlocked_at < ?
GROUP BY period
ORDER BY period;

-- name: AnalyticsTier2UnlocksByPeriod :many
SELECT strftime(?, substr(tier2_unlocked_at, 1, 19)) AS period, COUNT(*) AS count
FROM trial_progress
WHERE tier2_unlocked_at IS NOT NULL
  AND tier2_unlocked_at >= ?
  AND tier2_unlocked_at < ?
GROUP BY period
ORDER BY period;

-- name: AnalyticsTier3UnlocksByPeriod :many
SELECT strftime(?, substr(tier3_unlocked_at, 1, 19)) AS period, COUNT(*) AS count
FROM trial_progress
WHERE tier3_unlocked_at IS NOT NULL
  AND tier3_unlocked_at >= ?
  AND tier3_unlocked_at < ?
GROUP BY period
ORDER BY period;

-- name: AnalyticsRedemptionsByPeriod :many
SELECT strftime(?, substr(redeemed_at, 1, 19)) AS period, COUNT(*) AS count
FROM trial_discount_codes
WHERE redeemed_at IS NOT NULL
  AND redeemed_at >= ?
  AND redeemed_at < ?
GROUP BY period
ORDER BY period;

-- name: AnalyticsFunnelByCohort :many
-- Cohort = signup period. Counts how many users from each signup cohort
-- reached each subsequent funnel stage at any later time.
SELECT
    strftime(?, substr(u.created_at, 1, 19)) AS cohort,
    CAST(COUNT(*) AS INTEGER) AS signups,
    CAST(SUM(CASE WHEN tp.tier1_unlocked_at IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS tier1,
    CAST(SUM(CASE WHEN tp.tier2_unlocked_at IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS tier2,
    CAST(SUM(CASE WHEN tp.tier3_unlocked_at IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS tier3,
    CAST(SUM(CASE WHEN u.subscribed_at IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS subscribed
FROM users u
LEFT JOIN trial_progress tp ON tp.user_id = u.id
WHERE u.created_at >= ?
  AND u.created_at < ?
  AND u.email NOT LIKE '%@clerk.user'
GROUP BY cohort
ORDER BY cohort;
