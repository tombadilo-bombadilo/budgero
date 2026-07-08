-- +goose Up
-- Add encryption_key_version to track when the blob encryption key changes
-- Used to prevent data corruption when master password is changed on one device
-- while another device still has the old password cached

ALTER TABLE budget_space_blobs ADD COLUMN encryption_key_version INTEGER NOT NULL DEFAULT 1;

-- +goose Down
-- SQLite doesn't support DROP COLUMN directly, would need table recreation
-- For a proper down migration, we'd need to:
-- 1. Create a new table without the column
-- 2. Copy data over
-- 3. Drop old table
-- 4. Rename new table
-- This is left as a no-op since down migrations are rarely used in production
