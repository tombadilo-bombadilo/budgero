import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration005: Migration = {
  version: 5,
  description: 'Add saved_reports table with unified chart configurations',
  up: `
      CREATE TABLE IF NOT EXISTS saved_reports (
        ID          TEXT PRIMARY KEY,
        Name        TEXT NOT NULL UNIQUE,
        Description TEXT,
        Query       TEXT NOT NULL,
        Charts      TEXT DEFAULT '[]',
        CreatedAt   DATETIME DEFAULT CURRENT_TIMESTAMP,
        UpdatedAt   DATETIME DEFAULT CURRENT_TIMESTAMP,
        Tags        TEXT DEFAULT '[]',
        IsFavorite  BOOLEAN DEFAULT FALSE
      );
      
      CREATE INDEX IF NOT EXISTS idx_saved_reports_name ON saved_reports(Name);
      CREATE INDEX IF NOT EXISTS idx_saved_reports_favorite ON saved_reports(IsFavorite);
      CREATE INDEX IF NOT EXISTS idx_saved_reports_updated_at ON saved_reports(UpdatedAt);
    `,
  verify: (db: MigrationDatabase) => {
    const result = db.exec(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='saved_reports'`
    );
    return result && result.length > 0;
  },
};
