-- +goose Up
-- where_heard_about records how the user discovered Budgero, captured on the
-- optional onboarding "How did you hear about us?" step. Stored as a free-form
-- string (preset key like 'search'/'product_hunt', or raw text for "Other").
-- Empty string means the user skipped the step. Used for acquisition analytics.
ALTER TABLE users ADD COLUMN where_heard_about TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE users DROP COLUMN where_heard_about;
