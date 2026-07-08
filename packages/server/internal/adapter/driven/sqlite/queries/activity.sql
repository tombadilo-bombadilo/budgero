-- name: UpsertUserDailyActivity :exec
INSERT INTO user_daily_activity (
    user_id,
    day,
    first_seen_at,
    last_seen_at,
    hit_count
) VALUES (?, ?, ?, ?, 1)
ON CONFLICT(user_id, day) DO UPDATE SET
    first_seen_at = MIN(user_daily_activity.first_seen_at, excluded.first_seen_at),
    last_seen_at = MAX(user_daily_activity.last_seen_at, excluded.last_seen_at),
    hit_count = CASE
        WHEN user_daily_activity.last_seen_at < sqlc.arg(dedupe_cutoff) THEN user_daily_activity.hit_count + 1
        ELSE user_daily_activity.hit_count
    END;

-- name: ListUserDailyActivity :many
SELECT
    day,
    hit_count,
    last_seen_at
FROM user_daily_activity
WHERE user_id = ?
  AND day >= ?
  AND day < ?
ORDER BY day ASC;

-- name: GetLastUserActivityAt :one
SELECT last_seen_at
FROM user_daily_activity
WHERE user_id = ?
ORDER BY last_seen_at DESC
LIMIT 1;
