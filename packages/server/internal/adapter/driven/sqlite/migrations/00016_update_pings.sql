-- +goose Up
-- update_pings aggregates anonymous update-check counts (SaaS only — selfhost
-- builds wire the repo but never record). One row per (day, version, build,
-- client_type); count = number of checks that day. No user, instance or
-- network identifiers are stored: a self-host server's daily update check
-- carries only its version, build sha and type, and that is all we keep.
CREATE TABLE IF NOT EXISTS update_pings (
    day         TEXT NOT NULL,
    version     TEXT NOT NULL,
    build       TEXT NOT NULL DEFAULT '',
    client_type TEXT NOT NULL,
    count       INTEGER NOT NULL DEFAULT 0,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (day, version, build, client_type)
);

-- +goose Down
DROP TABLE IF EXISTS update_pings;
