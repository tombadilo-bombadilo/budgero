import type { Migration, MigrationDatabase } from '../migrations.js';

export const migration030: Migration = {
  version: 30,
  description: 'Add custom dashboards and widgets tables',
  up: `
      CREATE TABLE IF NOT EXISTS custom_dashboards (
        ID         TEXT PRIMARY KEY,
        BudgetID   INTEGER NOT NULL,
        Name       TEXT NOT NULL,
        SortOrder  INTEGER NOT NULL DEFAULT 0,
        CreatedAt  TEXT NOT NULL,
        UpdatedAt  TEXT NOT NULL,
        FOREIGN KEY (BudgetID) REFERENCES budgets(ID) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_dashboards_budget_name
      ON custom_dashboards(BudgetID, Name COLLATE NOCASE);

      CREATE INDEX IF NOT EXISTS idx_custom_dashboards_budget_sort
      ON custom_dashboards(BudgetID, SortOrder);

      CREATE TABLE IF NOT EXISTS custom_dashboard_widgets (
        ID             TEXT PRIMARY KEY,
        DashboardID    TEXT NOT NULL,
        ReportID       TEXT NOT NULL,
        ChartID        TEXT NOT NULL,
        SortOrder      INTEGER NOT NULL DEFAULT 0,
        DesktopLayout  TEXT NOT NULL,
        MobileLayout   TEXT NOT NULL,
        TitleOverride  TEXT NULL,
        CreatedAt      TEXT NOT NULL,
        UpdatedAt      TEXT NOT NULL,
        FOREIGN KEY (DashboardID) REFERENCES custom_dashboards(ID) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_custom_dashboard_widgets_dashboard_sort
      ON custom_dashboard_widgets(DashboardID, SortOrder);

      CREATE INDEX IF NOT EXISTS idx_custom_dashboard_widgets_report
      ON custom_dashboard_widgets(ReportID);
    `,
  verify: (db: MigrationDatabase) => {
    try {
      const dashboardsTable = db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='custom_dashboards'`
      );
      if (!dashboardsTable || dashboardsTable.length === 0) {
        return false;
      }

      const widgetsTable = db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='custom_dashboard_widgets'`
      );
      if (!widgetsTable || widgetsTable.length === 0) {
        return false;
      }

      const dashboardsInfo = db.exec(`PRAGMA table_info(custom_dashboards)`);
      const dashboardColumns = dashboardsInfo?.[0]?.values?.map((row: unknown[]) => row[1]) ?? [];
      const widgetsInfo = db.exec(`PRAGMA table_info(custom_dashboard_widgets)`);
      const widgetColumns = widgetsInfo?.[0]?.values?.map((row: unknown[]) => row[1]) ?? [];

      return (
        dashboardColumns.includes('BudgetID') &&
        dashboardColumns.includes('Name') &&
        widgetColumns.includes('DashboardID') &&
        widgetColumns.includes('ReportID') &&
        widgetColumns.includes('ChartID')
      );
    } catch {
      return false;
    }
  },
};
