-- +goose Up
-- email_answers backs the one-tap answer links in the day-2 and trial-ending
-- emails. A row (random token, no answer) is created when the email is sent;
-- tapping a reason fills in reason/answered_at, and the optional note on the
-- thank-you page fills in note. The token in the link is the only credential.
CREATE TABLE IF NOT EXISTS email_answers (
    token       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    template    TEXT NOT NULL,
    reason      TEXT,
    note        TEXT,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    answered_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_email_answers_user ON email_answers(user_id);
CREATE INDEX IF NOT EXISTS idx_email_answers_template ON email_answers(template);

-- +goose Down
DROP INDEX IF EXISTS idx_email_answers_template;
DROP INDEX IF EXISTS idx_email_answers_user;
DROP TABLE IF EXISTS email_answers;
