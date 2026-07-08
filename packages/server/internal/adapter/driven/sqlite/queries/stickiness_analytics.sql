-- Stickiness analytics: DAU/MAU + cohort retention.
--
-- Activity source: user_daily_activity, already (user_id, day)-bucketed
-- by the heartbeat handler. Day strings are stored YYYY-MM-DD so direct
-- lexical comparison works.
--
-- Cohort grouping uses strftime() on users.created_at. The substr() trim
-- mirrors rewards_analytics.sql -- modernc.org/sqlite's t.String() bind
-- format breaks strftime without it.

-- name: AnalyticsDAUByDayInRange :many
SELECT day, COUNT(DISTINCT user_id) AS dau
FROM user_daily_activity
WHERE day >= ? AND day <= ?
GROUP BY day
ORDER BY day;

-- name: AnalyticsMAURollingForDay :one
SELECT COUNT(DISTINCT user_id) AS mau
FROM user_daily_activity
WHERE day BETWEEN ? AND ?;

-- name: AnalyticsCohortSizes :many
SELECT
    strftime(?, substr(created_at, 1, 19)) AS cohort,
    COUNT(*) AS size
FROM users
WHERE created_at IS NOT NULL
  AND created_at >= ?
  AND email NOT LIKE '%@clerk.user'
GROUP BY cohort
ORDER BY cohort;

-- name: AnalyticsCohortRetention :many
SELECT
    strftime(?, substr(u.created_at, 1, 19)) AS cohort,
    CAST(julianday(a.day) - julianday(date(substr(u.created_at, 1, 19))) AS INTEGER) AS day_n,
    COUNT(DISTINCT a.user_id) AS active
FROM users u
JOIN user_daily_activity a ON a.user_id = u.id
WHERE u.created_at IS NOT NULL
  AND u.created_at >= ?
  AND u.email NOT LIKE '%@clerk.user'
  AND a.day >= date(substr(u.created_at, 1, 19))
  AND CAST(julianday(a.day) - julianday(date(substr(u.created_at, 1, 19))) AS INTEGER) <= CAST(? AS INTEGER)
GROUP BY cohort, day_n
ORDER BY cohort, day_n;
