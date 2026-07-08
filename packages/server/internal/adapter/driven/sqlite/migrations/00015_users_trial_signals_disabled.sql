-- +goose Up
-- Trial-reward signals get their own opt-out, decoupled from analytics.
-- Analytics became opt-in (disabled by default), but trial signals are
-- functional — they compute a discount the user is actively earning and
-- carry no PII — so they stay ON by default and are gated only by this
-- explicit opt-out (Settings → Privacy).
ALTER TABLE users ADD COLUMN is_trial_signals_disabled BOOLEAN NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE users DROP COLUMN is_trial_signals_disabled;
