-- +goose Up
CREATE TABLE IF NOT EXISTS trial_signals (
    user_id  TEXT NOT NULL,
    kind     TEXT NOT NULL,
    day      TEXT NOT NULL,
    count    INTEGER NOT NULL DEFAULT 1,
    first_at DATETIME NOT NULL,
    last_at  DATETIME NOT NULL,
    PRIMARY KEY (user_id, kind, day),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_trial_signals_user_kind ON trial_signals(user_id, kind);

CREATE TABLE IF NOT EXISTS trial_progress (
    user_id                     TEXT PRIMARY KEY,
    trial_started_at            DATETIME NOT NULL,
    daily_logging_distinct_days INTEGER NOT NULL DEFAULT 0,
    reconciliation_count        INTEGER NOT NULL DEFAULT 0,
    first_reconciliation_at     DATETIME,
    second_reconciliation_at    DATETIME,
    budget_cycle_assigned_at    DATETIME,
    overspend_covered_at        DATETIME,
    goal_funded_at              DATETIME,
    rule_applied_historical_at  DATETIME,
    monthly_review_at           DATETIME,
    tier1_unlocked_at           DATETIME,
    tier2_unlocked_at           DATETIME,
    tier3_unlocked_at           DATETIME,
    updated_at                  DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trial_discount_codes (
    code            TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    tier            INTEGER NOT NULL,
    percent_off     INTEGER NOT NULL,
    ls_discount_id  TEXT NOT NULL DEFAULT '',
    generated_at    DATETIME NOT NULL,
    valid_from      DATETIME NOT NULL,
    valid_until     DATETIME NOT NULL,
    redeemed_at     DATETIME,
    redeemed_sub_id TEXT,
    UNIQUE (user_id, tier),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_trial_discount_codes_user ON trial_discount_codes(user_id);

-- +goose Down
DROP INDEX IF EXISTS idx_trial_discount_codes_user;
DROP TABLE IF EXISTS trial_discount_codes;
DROP TABLE IF EXISTS trial_progress;
DROP INDEX IF EXISTS idx_trial_signals_user_kind;
DROP TABLE IF EXISTS trial_signals;
