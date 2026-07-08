-- +goose Up
-- Track the client data-format version of each space's encrypted blob.
-- Format 2 = integer-milliunit money (app >= 1.5). The server cannot read
-- blob contents (zero-knowledge), so clients declare the format on upload and
-- the server refuses sync to clients that don't understand a space's format —
-- preventing an outdated client from writing decimal-money data into a
-- milliunit space.
ALTER TABLE budget_space_blobs ADD COLUMN data_format_version INTEGER NOT NULL DEFAULT 1;

-- +goose Down
ALTER TABLE budget_space_blobs DROP COLUMN data_format_version;
