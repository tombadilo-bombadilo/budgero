-- +goose Up
CREATE TABLE IF NOT EXISTS user_daily_activity (
    user_id TEXT NOT NULL,
    day TEXT NOT NULL,
    first_seen_at DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_user_daily_activity_day ON user_daily_activity(day);

-- +goose Down
DROP INDEX IF EXISTS idx_user_daily_activity_day;
DROP TABLE IF EXISTS user_daily_activity;
