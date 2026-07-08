-- +goose Up
-- user_feedback stores in-app feedback submissions (bug / idea / praise).
-- SaaS-only feature — selfhost builds don't register the route, so this
-- table just stays empty there. Auth is required (user_id is always set);
-- email/name are joined from the users table when needed, not duplicated here.
-- contact_back: user opt-in for the team to follow up. Surfaced in the UI
-- only for bug/idea (defaults to false; always false for praise).
CREATE TABLE IF NOT EXISTS user_feedback (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    category      TEXT NOT NULL,
    body          TEXT NOT NULL,
    contact_back  BOOLEAN NOT NULL DEFAULT 0,
    screen_path   TEXT NOT NULL DEFAULT '',
    app_version   TEXT NOT NULL DEFAULT '',
    user_agent    TEXT NOT NULL DEFAULT '',
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_feedback_user ON user_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_created ON user_feedback(created_at);

-- +goose Down
DROP INDEX IF EXISTS idx_user_feedback_created;
DROP INDEX IF EXISTS idx_user_feedback_user;
DROP TABLE IF EXISTS user_feedback;
