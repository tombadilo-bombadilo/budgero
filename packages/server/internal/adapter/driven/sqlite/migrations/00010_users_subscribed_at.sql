-- +goose Up
-- subscribed_at records the timestamp at which the user first transitioned
-- from trial/inactive to a paid subscription. Set by the LemonSqueezy
-- subscription_created webhook handler (only the first time it sees a user
-- subscribe — subsequent renewals don't update this). Used by the admin
-- analytics endpoint to track conversions over time.
ALTER TABLE users ADD COLUMN subscribed_at DATETIME;
CREATE INDEX IF NOT EXISTS idx_users_subscribed_at ON users(subscribed_at);

-- +goose Down
DROP INDEX IF EXISTS idx_users_subscribed_at;
ALTER TABLE users DROP COLUMN subscribed_at;
