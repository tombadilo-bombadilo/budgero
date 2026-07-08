-- +goose Up
CREATE TABLE sent_emails (
    user_id TEXT NOT NULL,
    template TEXT NOT NULL,
    sent_at DATETIME NOT NULL,
    PRIMARY KEY (user_id, template)
);
CREATE INDEX idx_sent_emails_sent_at ON sent_emails (sent_at);

-- +goose Down
DROP INDEX IF EXISTS idx_sent_emails_sent_at;
DROP TABLE IF EXISTS sent_emails;
