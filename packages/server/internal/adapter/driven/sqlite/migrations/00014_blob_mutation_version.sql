-- +goose Up
-- Bind each uploaded blob to its position in the mutation log. Clients send
-- their mutation cursor with the upload (X-Mutation-Version); a fresh device
-- restores the blob and replays the log from exactly this version, so a blob
-- that lags the log (uploads are debounced) never causes skipped or
-- double-applied mutations. 0 = unknown (legacy blob) — clients fall back to
-- the old seeding behavior.
ALTER TABLE budget_space_blobs ADD COLUMN mutation_version INTEGER NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE budget_space_blobs DROP COLUMN mutation_version;
