-- +goose Up
ALTER TABLE users ADD COLUMN is_analytics_disabled BOOLEAN NOT NULL DEFAULT 0;

-- +goose Down
-- SQLite doesn't support DROP COLUMN before 3.35.0; recreate if needed.
