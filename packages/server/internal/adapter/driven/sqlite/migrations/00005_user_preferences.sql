-- +goose Up
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY,
    theme_mode TEXT NOT NULL DEFAULT 'system',
    theme_preset TEXT NOT NULL DEFAULT 'default',
    classic_font TEXT NOT NULL DEFAULT 'poppins',
    home_page TEXT NOT NULL DEFAULT 'dashboard',
    desktop_budget_layout TEXT NOT NULL DEFAULT 'table',
    compact_mobile_layout BOOLEAN NOT NULL DEFAULT 0,
    mobile_budget_layout TEXT NOT NULL DEFAULT 'cards',
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- +goose Down
DROP TABLE IF EXISTS user_preferences;
