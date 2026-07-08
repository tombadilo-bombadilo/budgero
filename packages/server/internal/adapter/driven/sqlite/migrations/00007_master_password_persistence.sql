-- +goose Up
ALTER TABLE user_preferences ADD COLUMN master_password_storage_mode TEXT NOT NULL DEFAULT 'memory';
ALTER TABLE user_preferences ADD COLUMN master_password_storage_days INTEGER NOT NULL DEFAULT 7;

-- +goose Down
ALTER TABLE user_preferences DROP COLUMN master_password_storage_days;
ALTER TABLE user_preferences DROP COLUMN master_password_storage_mode;
