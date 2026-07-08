import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration001: Migration = {
  version: 1,
  description: 'Initial schema',
  up: `
       CREATE TABLE budgets (
        ID               INTEGER PRIMARY KEY AUTOINCREMENT,
        SpaceID          TEXT NOT NULL,
        Name             TEXT NOT NULL,
        DisplayCurrency  TEXT NOT NULL,
        BadgeIcon        TEXT NOT NULL,
        NumberFormat     TEXT NOT NULL
      );

      CREATE TABLE budget_spaces (
        SpaceID        TEXT PRIMARY KEY,
        DisplayName    TEXT NOT NULL,
        OwnerBudgetID  INTEGER NOT NULL,
        CreatedAt      TEXT NOT NULL DEFAULT (datetime('now')),
        UpdatedAt      TEXT DEFAULT NULL,
        FOREIGN KEY (OwnerBudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE TABLE budget_space_members (
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

      CREATE TABLE category_groups (
        ID         INTEGER PRIMARY KEY AUTOINCREMENT,
        Name       TEXT NOT NULL,
        Note       TEXT NOT NULL DEFAULT '',
        BudgetID   INTEGER NOT NULL,
        FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE TABLE categories (
        ID                 INTEGER PRIMARY KEY AUTOINCREMENT,
        Name               TEXT NOT NULL,
        Note               TEXT NOT NULL DEFAULT '',
        CategoryGroupID    INTEGER NOT NULL,
        BudgetID           INTEGER NOT NULL,
        FOREIGN KEY (CategoryGroupID) REFERENCES category_groups(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (BudgetID)         REFERENCES budgets(ID)         ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE TABLE goals (
        ID           INTEGER PRIMARY KEY AUTOINCREMENT,
        Type         TEXT NOT NULL,
        CategoryID   INTEGER NOT NULL UNIQUE,
        Target       REAL NOT NULL,
        StartDate    TEXT NOT NULL,
        TargetDate   TEXT NOT NULL DEFAULT '1970-01-01',
        FOREIGN KEY (CategoryID) REFERENCES categories(ID) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE TABLE accounts (
        ID                INTEGER PRIMARY KEY AUTOINCREMENT,
        Name              TEXT NOT NULL,
        Currency          TEXT NOT NULL,
        Type              TEXT NOT NULL,
        ReconciledAt      DATE,
        Balance           REAL NOT NULL DEFAULT 0.0,
        BalanceConverted  REAL DEFAULT NULL,
        BudgetID          INTEGER NOT NULL,
        FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE TABLE transactions (
        ID                     INTEGER PRIMARY KEY AUTOINCREMENT,
        CategoryID             INTEGER NOT NULL,
        AccountID              INTEGER NOT NULL,
        TransferID             TEXT DEFAULT NULL,
        Date                   TEXT    NOT NULL,
        Month                  TEXT GENERATED ALWAYS AS (substr(Date, 1, 7)) STORED,
        Memo                   TEXT    NOT NULL DEFAULT '',
        Reconciled             BOOLEAN NOT NULL DEFAULT FALSE,
        Inflow                 REAL    NOT NULL DEFAULT 0.0,
        Outflow                REAL    NOT NULL DEFAULT 0.0,
        InflowOriginal         REAL    DEFAULT NULL,
        OutflowOriginal        REAL    DEFAULT NULL,
        RunningBalance         REAL    DEFAULT 0.0,
        RunningBalanceOriginal REAL DEFAULT NULL,
        BudgetID               INTEGER NOT NULL,
        FOREIGN KEY (CategoryID) REFERENCES categories(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (AccountID)  REFERENCES accounts(ID)    ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (BudgetID)   REFERENCES budgets(ID)     ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE TABLE currency_rates (
        ID           INTEGER PRIMARY KEY AUTOINCREMENT,
        FromCurrency TEXT NOT NULL,
        ToCurrency   TEXT NOT NULL,
        Rate         REAL NOT NULL,
        Month        TEXT NOT NULL,
        LastUpdated  TEXT NOT NULL,
        BudgetID     INTEGER NOT NULL,
        FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        UNIQUE(FromCurrency, ToCurrency, Month, BudgetID)
      );

      CREATE TABLE assignments (
        ID           INTEGER PRIMARY KEY AUTOINCREMENT,
        CategoryID   INTEGER NOT NULL,
        Amount       REAL    NOT NULL,
        Month        TEXT    NOT NULL,
        BudgetID     INTEGER NOT NULL,
        FOREIGN KEY (CategoryID) REFERENCES categories(ID) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (BudgetID)   REFERENCES budgets(ID)     ON DELETE CASCADE ON UPDATE CASCADE
      );


      -- Indexes
      CREATE INDEX idx_transactions_month_category  ON transactions(Month, CategoryID);
      CREATE INDEX idx_transactions_account_date    ON transactions(AccountID, Date DESC);
      CREATE INDEX idx_transactions_budget_date     ON transactions(BudgetID, Date DESC);
      CREATE INDEX idx_transactions_category_date   ON transactions(CategoryID, Date DESC);
      CREATE INDEX idx_goals_category_id            ON goals(CategoryID);
      CREATE INDEX idx_assignments_category_month   ON assignments(CategoryID, Month);
      CREATE INDEX idx_assignments_budget_month     ON assignments(BudgetID, Month);
      CREATE INDEX idx_categories_budget            ON categories(BudgetID);
      CREATE INDEX idx_category_groups_budget       ON category_groups(BudgetID);
      CREATE INDEX idx_accounts_budget              ON accounts(BudgetID);
      CREATE INDEX idx_transactions_category_month  ON transactions (CategoryID, Month);
      CREATE INDEX idx_currency_rates_lookup        ON currency_rates(FromCurrency, ToCurrency, Month, BudgetID);
      CREATE INDEX idx_currency_rates_budget_month  ON currency_rates(BudgetID, Month);
      CREATE INDEX idx_budgets_space                ON budgets(SpaceID);
      CREATE INDEX idx_budget_space_members_space   ON budget_space_members(SpaceID);
      CREATE INDEX idx_budget_space_members_user    ON budget_space_members(UserID);
    `,
  verify: (db: MigrationDatabase) => {
    const tables = [
      'budgets',
      'budget_spaces',
      'budget_space_members',
      'accounts',
      'category_groups',
      'categories',
      'goals',
      'transactions',
      'currency_rates',
      'assignments',
    ];
    for (const table of tables) {
      const result = db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`
      );
      if (!result || result.length === 0) return false;
    }
    try {
      const budgetsInfo = db.exec(`PRAGMA table_info(budgets)`);
      const hasSpaceId =
        budgetsInfo &&
        budgetsInfo.length > 0 &&
        budgetsInfo[0].values.some((row: unknown[]) => row[1] === 'SpaceID');
      if (!hasSpaceId) {
        return false;
      }
    } catch {
      return false;
    }
    return true;
  },
};
