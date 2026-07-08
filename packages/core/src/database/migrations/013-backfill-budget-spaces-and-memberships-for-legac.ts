import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration013: Migration = {
  version: 13,
  description: 'Backfill budget spaces and memberships for legacy databases',
  up: (db: MigrationDatabase) => {
    const safeExec = (sql: string) => {
      try {
        db.exec(sql);
      } catch (error) {
        debugLog('[Migration 13] statement failed', { sql, error });
      }
    };

    const hasSpaceIdColumn = (() => {
      try {
        const info = db.exec(`PRAGMA table_info(budgets)`);
        return (
          info && info.length > 0 && info[0].values.some((row: unknown[]) => row[1] === 'SpaceID')
        );
      } catch (error) {
        debugLog('[Migration 13] failed to inspect budgets table', { error });
        return false;
      }
    })();

    if (!hasSpaceIdColumn) {
      safeExec(`ALTER TABLE budgets ADD COLUMN SpaceID TEXT`);
    }

    safeExec(`
        CREATE TABLE IF NOT EXISTS budget_spaces (
          SpaceID        TEXT PRIMARY KEY,
          DisplayName    TEXT NOT NULL,
          OwnerBudgetID  INTEGER NOT NULL,
          CreatedAt      TEXT NOT NULL DEFAULT (datetime('now')),
          UpdatedAt      TEXT DEFAULT NULL,
          FOREIGN KEY (OwnerBudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE
        );
      `);

    safeExec(`
        CREATE TABLE IF NOT EXISTS budget_space_members (
          ID                   INTEGER PRIMARY KEY AUTOINCREMENT,
          SpaceID              TEXT NOT NULL,
          UserID               TEXT NOT NULL,
          Role                 TEXT NOT NULL DEFAULT 'member',
          EncryptedSpaceKey    TEXT NOT NULL DEFAULT '',
          InvitationStatus     TEXT NOT NULL DEFAULT 'accepted',
          InviteSecret         TEXT DEFAULT NULL,
          InvitedAt            TEXT NOT NULL DEFAULT (datetime('now')),
          AcceptedAt           TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (SpaceID) REFERENCES budget_spaces(SpaceID) ON DELETE CASCADE ON UPDATE CASCADE,
          UNIQUE (SpaceID, UserID)
        );
      `);

    safeExec(`CREATE INDEX IF NOT EXISTS idx_budgets_space ON budgets(SpaceID);`);
    safeExec(
      `CREATE INDEX IF NOT EXISTS idx_budget_space_members_space ON budget_space_members(SpaceID);`
    );
    safeExec(
      `CREATE INDEX IF NOT EXISTS idx_budget_space_members_user ON budget_space_members(UserID);`
    );

    safeExec(`
        UPDATE budgets
        SET SpaceID = lower(hex(randomblob(16)))
        WHERE SpaceID IS NULL OR SpaceID = '';
      `);

    safeExec(`
        INSERT OR IGNORE INTO budget_spaces (SpaceID, DisplayName, OwnerBudgetID)
        SELECT SpaceID, COALESCE(Name, 'Budget ' || ID), ID
        FROM budgets
        WHERE SpaceID IS NOT NULL AND SpaceID <> '';
      `);

    safeExec(`
        INSERT OR IGNORE INTO budget_space_members (
          SpaceID,
          UserID,
          Role,
          EncryptedSpaceKey,
          InvitationStatus,
          InviteSecret,
          InvitedAt,
          AcceptedAt
        )
        SELECT
          SpaceID,
          'legacy-owner',
          'owner',
          '',
          'accepted',
          NULL,
          datetime('now'),
          datetime('now')
        FROM budgets
        WHERE SpaceID IS NOT NULL AND SpaceID <> '';
      `);
  },
  verify: (db: MigrationDatabase) => {
    try {
      const budgetSpaces = db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='budget_spaces'`
      );
      if (!budgetSpaces || budgetSpaces.length === 0) {
        return false;
      }

      const membersTable = db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='budget_space_members'`
      );
      if (!membersTable || membersTable.length === 0) {
        return false;
      }

      const missingSpaceId = db.exec(
        `SELECT COUNT(1) FROM budgets WHERE SpaceID IS NULL OR SpaceID = ''`
      );
      const missingCount = (missingSpaceId?.[0]?.values?.[0]?.[0] as number) ?? 0;
      if (missingCount > 0) {
        return false;
      }

      return true;
    } catch (error) {
      debugLog('[Migration 13] verification failed', { error });
      return false;
    }
  },
};
