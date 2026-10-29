-- +goose Up
-- Weekly active self-host installs, counted from the update check (SaaS only).
-- A sender is the request IP hashed (HMAC-SHA256) with a random key that only
-- lives for the current UTC week. When the week rolls over, its distinct-sender
-- total is copied to selfhost_weekly_installs and the key and hashes are
-- deleted, so no IP, hash or other per-install record outlives its week.
CREATE TABLE IF NOT EXISTS update_ping_week_key (
    week TEXT PRIMARY KEY,
    key  BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS update_ping_week_senders (
    week   TEXT NOT NULL,
    sender TEXT NOT NULL,
    PRIMARY KEY (week, sender)
);

CREATE TABLE IF NOT EXISTS selfhost_weekly_installs (
    week     TEXT PRIMARY KEY,
    installs INTEGER NOT NULL
);

-- +goose Down
DROP TABLE IF EXISTS selfhost_weekly_installs;
DROP TABLE IF EXISTS update_ping_week_senders;
DROP TABLE IF EXISTS update_ping_week_key;
