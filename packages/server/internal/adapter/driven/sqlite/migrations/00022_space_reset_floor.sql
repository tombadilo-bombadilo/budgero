-- +goose Up
-- The change-log position of the latest "go back to this version" restore.
-- Going back keeps the change log but binds the restored copy to its newest
-- position, so the changes after the copy are skipped. A later "restore and
-- keep later changes" from a copy older than this point would replay exactly
-- those discarded changes, so such restores are refused.
ALTER TABLE budget_space_blobs ADD COLUMN reset_floor INTEGER NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE budget_space_blobs DROP COLUMN reset_floor;
