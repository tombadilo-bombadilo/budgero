-- +goose Up
-- Saved queries for admin database explorer

CREATE TABLE IF NOT EXISTS saved_queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    query TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_saved_queries_name ON saved_queries(name);

-- +goose Down
DROP TABLE IF EXISTS saved_queries;
