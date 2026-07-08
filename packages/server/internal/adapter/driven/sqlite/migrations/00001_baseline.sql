-- +goose Up
-- Baseline schema for Budgero
-- Unified schema that supports both SaaS and self-host modes

-- Users table (unified schema for both SaaS and self-host modes)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    email TEXT UNIQUE NOT NULL,
    db_path TEXT NOT NULL DEFAULT '',
    is_master_password_set BOOLEAN NOT NULL DEFAULT 0,
    current_db_hash TEXT NOT NULL DEFAULT '',
    sync_version INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_user_db_backup DATETIME DEFAULT NULL,
    backup_reminder_frequency_days INTEGER NOT NULL DEFAULT 7,
    is_blocked BOOLEAN NOT NULL DEFAULT 0,
    -- SaaS subscription columns (unused in self-host mode)
    subscription_status TEXT DEFAULT 'inactive',
    subscription_id TEXT DEFAULT NULL,
    customer_id TEXT DEFAULT NULL,
    variant_id TEXT DEFAULT NULL,
    subscription_ends_at DATETIME DEFAULT NULL,
    trial_ends_at DATETIME DEFAULT NULL,
    current_period_end DATETIME DEFAULT NULL,
    has_beta_access BOOLEAN NOT NULL DEFAULT 0,
    beta_expires_at DATETIME DEFAULT NULL,
    is_founding_member BOOLEAN NOT NULL DEFAULT 0,
    has_collaboration_access BOOLEAN NOT NULL DEFAULT 0,
    -- Onboarding columns
    onboarding_status TEXT NOT NULL DEFAULT 'pending',
    onboarding_completed_at DATETIME DEFAULT NULL,
    onboarding_snoozed_until DATETIME DEFAULT NULL,
    primary_space_id TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_subscription ON users(subscription_status);
CREATE INDEX IF NOT EXISTS idx_users_primary_space ON users(primary_space_id);

-- Local credentials for optional password auth (SaaS mode)
CREATE TABLE IF NOT EXISTS local_credentials (
    user_id TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT 0,
    last_login_at DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_local_credentials_admin ON local_credentials(is_admin);

-- Budget spaces (collaborative workspaces)
CREATE TABLE IF NOT EXISTS budget_spaces (
    space_id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT NULL,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_budget_spaces_owner ON budget_spaces(owner_user_id);

-- Budget space members
CREATE TABLE IF NOT EXISTS budget_space_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    encrypted_space_key TEXT NOT NULL DEFAULT '',
    invitation_status TEXT NOT NULL DEFAULT 'accepted',
    invite_secret TEXT DEFAULT NULL,
    invited_at DATETIME NOT NULL DEFAULT (datetime('now')),
    accepted_at DATETIME DEFAULT (datetime('now')),
    UNIQUE(space_id, user_id),
    FOREIGN KEY (space_id) REFERENCES budget_spaces(space_id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_budget_space_members_space ON budget_space_members(space_id);
CREATE INDEX IF NOT EXISTS idx_budget_space_members_user ON budget_space_members(user_id);

-- Budget space blobs (encrypted database files)
CREATE TABLE IF NOT EXISTS budget_space_blobs (
    space_id TEXT PRIMARY KEY,
    blob_path TEXT NOT NULL,
    current_hash TEXT NOT NULL DEFAULT '',
    sync_version INTEGER NOT NULL DEFAULT 0,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (space_id) REFERENCES budget_spaces(space_id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Budget space invites
CREATE TABLE IF NOT EXISTS budget_space_invites (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    inviter_user_id TEXT NOT NULL,
    invitee_email TEXT,
    invite_secret TEXT NOT NULL,
    encrypted_bundle TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at DATETIME DEFAULT NULL,
    redeemed_at DATETIME DEFAULT NULL,
    redeemed_by TEXT DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (space_id) REFERENCES budget_spaces(space_id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (inviter_user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (redeemed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_budget_space_invites_space ON budget_space_invites(space_id);
CREATE INDEX IF NOT EXISTS idx_budget_space_invites_status ON budget_space_invites(space_id, status);

-- Beta invites (legacy beta access system)
CREATE TABLE IF NOT EXISTS beta_invites (
    code TEXT PRIMARY KEY,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    used_by TEXT DEFAULT NULL,
    used_at DATETIME DEFAULT NULL,
    expires_at DATETIME NOT NULL,
    grant_days INTEGER NOT NULL DEFAULT 30,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (used_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_invites_code ON beta_invites(code);
CREATE INDEX IF NOT EXISTS idx_invites_used ON beta_invites(used_by);

-- Push notification queue
CREATE TABLE IF NOT EXISTS push_queue (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    space_id TEXT NOT NULL,
    message_id TEXT,
    encrypted_payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    processed_at DATETIME DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_push_queue_user_status ON push_queue(user_id, status);
CREATE INDEX IF NOT EXISTS idx_push_queue_space_status ON push_queue(space_id, status);
CREATE INDEX IF NOT EXISTS idx_push_queue_created ON push_queue(created_at);

-- Push API tokens
CREATE TABLE IF NOT EXISTS push_api_tokens (
    user_id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    space_id TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
    last_used DATETIME DEFAULT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Mutation log for real-time sync
CREATE TABLE IF NOT EXISTS mutation_log (
    id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    op TEXT,
    args TEXT,
    encrypted_payload TEXT,
    timestamp DATETIME NOT NULL,
    base_version INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(space_id, version),
    UNIQUE(space_id, id)
);

CREATE INDEX IF NOT EXISTS idx_mutation_log_space_version ON mutation_log(space_id, version);
CREATE INDEX IF NOT EXISTS idx_mutation_log_space_timestamp ON mutation_log(space_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_mutation_log_space_user ON mutation_log(space_id, user_id);

-- Mutation snapshots for sync checkpoints
CREATE TABLE IF NOT EXISTS mutation_snapshots (
    space_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    data BLOB NOT NULL,
    hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(space_id, version)
);

CREATE INDEX IF NOT EXISTS idx_mutation_snapshots_space_version ON mutation_snapshots(space_id, version DESC);

-- Exchange rates cache
CREATE TABLE IF NOT EXISTS exchange_rates (
    base_currency TEXT NOT NULL,
    target_currency TEXT NOT NULL,
    month TEXT NOT NULL,
    rate REAL NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(base_currency, target_currency, month)
);

-- +goose Down
-- Intentionally empty - never drop baseline schema
