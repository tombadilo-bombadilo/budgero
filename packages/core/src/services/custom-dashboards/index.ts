import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, allRows, run } from '../../database/sql.js';

export interface DesktopWidgetLayout {
  colSpan: number;
  rowSpan: number;
}

export interface MobileWidgetLayout {
  size: 's' | 'm' | 'l';
}

export interface CustomDashboard {
  id: string;
  budgetId: number;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomDashboardWidget {
  id: string;
  dashboardId: string;
  reportId: string;
  chartId: string;
  sortOrder: number;
  desktopLayout: DesktopWidgetLayout;
  mobileLayout: MobileWidgetLayout;
  titleOverride?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomDashboardWithWidgets extends CustomDashboard {
  widgets: CustomDashboardWidget[];
}

export interface CreateCustomDashboardInput {
  budgetId: number;
  name: string;
}

export interface UpdateCustomDashboardInput {
  id: string;
  name?: string;
  sortOrder?: number;
}

export interface AddCustomDashboardWidgetInput {
  dashboardId: string;
  reportId: string;
  chartId: string;
  desktopLayout?: DesktopWidgetLayout;
  mobileLayout?: MobileWidgetLayout;
  titleOverride?: string;
}

export interface UpdateCustomDashboardWidgetInput {
  id: string;
  desktopLayout?: DesktopWidgetLayout;
  mobileLayout?: MobileWidgetLayout;
  sortOrder?: number;
  titleOverride?: string | null;
  chartId?: string;
  reportId?: string;
}

export interface ReorderCustomDashboardsInput {
  budgetId: number;
  orderedIds: string[];
}

export interface ReorderCustomDashboardWidgetsInput {
  dashboardId: string;
  orderedIds: string[];
}

export interface CustomDashboardService {
  getDashboards(budgetId: number): CustomDashboard[];
  getDashboard(id: string): CustomDashboardWithWidgets | null;
  createDashboard(input: CreateCustomDashboardInput): CustomDashboard;
  updateDashboard(input: UpdateCustomDashboardInput): CustomDashboard;
  deleteDashboard(id: string): void;
  addWidget(input: AddCustomDashboardWidgetInput): CustomDashboardWithWidgets;
  updateWidget(input: UpdateCustomDashboardWidgetInput): CustomDashboardWidget;
  deleteWidget(id: string): void;
  reorderDashboards(input: ReorderCustomDashboardsInput): void;
  reorderWidgets(input: ReorderCustomDashboardWidgetsInput): void;
}

interface DashboardRow {
  ID: string;
  BudgetID: number | bigint;
  Name: string;
  SortOrder: number;
  CreatedAt: string;
  UpdatedAt: string;
}

interface DashboardWidgetRow {
  ID: string;
  DashboardID: string;
  ReportID: string;
  ChartID: string;
  SortOrder: number;
  DesktopLayout: string;
  MobileLayout: string;
  TitleOverride: string | null;
  CreatedAt: string;
  UpdatedAt: string;
}

const DEFAULT_DESKTOP_LAYOUT: DesktopWidgetLayout = {
  colSpan: 6,
  rowSpan: 3,
};

const DEFAULT_MOBILE_LAYOUT: MobileWidgetLayout = {
  size: 'm',
};

const MIN_COL_SPAN = 1;
const MAX_COL_SPAN = 12;
const MIN_ROW_SPAN = 3;
const MAX_ROW_SPAN = 8;

function createId(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `cd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function clampDesktopLayout(layout: DesktopWidgetLayout): DesktopWidgetLayout {
  const colSpan = Number.isFinite(layout.colSpan)
    ? Math.max(MIN_COL_SPAN, Math.min(MAX_COL_SPAN, Math.trunc(layout.colSpan)))
    : DEFAULT_DESKTOP_LAYOUT.colSpan;
  const rowSpan = Number.isFinite(layout.rowSpan)
    ? Math.max(MIN_ROW_SPAN, Math.min(MAX_ROW_SPAN, Math.trunc(layout.rowSpan)))
    : DEFAULT_DESKTOP_LAYOUT.rowSpan;
  return { colSpan, rowSpan };
}

function clampMobileLayout(layout: MobileWidgetLayout): MobileWidgetLayout {
  if (layout.size === 's' || layout.size === 'm' || layout.size === 'l') {
    return { size: layout.size };
  }
  return DEFAULT_MOBILE_LAYOUT;
}

function parseDesktopLayout(raw: string | null | undefined): DesktopWidgetLayout {
  if (!raw) return DEFAULT_DESKTOP_LAYOUT;
  try {
    const parsed = JSON.parse(raw) as Partial<DesktopWidgetLayout>;
    return clampDesktopLayout({
      colSpan: Number(parsed.colSpan),
      rowSpan: Number(parsed.rowSpan),
    });
  } catch {
    return DEFAULT_DESKTOP_LAYOUT;
  }
}

function parseMobileLayout(raw: string | null | undefined): MobileWidgetLayout {
  if (!raw) return DEFAULT_MOBILE_LAYOUT;
  try {
    const parsed = JSON.parse(raw) as Partial<MobileWidgetLayout>;
    return clampMobileLayout({ size: parsed.size as MobileWidgetLayout['size'] });
  } catch {
    return DEFAULT_MOBILE_LAYOUT;
  }
}

function hasUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

export class DatabaseCustomDashboardService implements CustomDashboardService {
  constructor(private db: DatabaseAdapter) {}

  getDashboards(budgetId: number): CustomDashboard[] {
    const rows = allRows<DashboardRow>(
      this.db,
      `
      SELECT * FROM custom_dashboards
      WHERE BudgetID = ?
      ORDER BY SortOrder ASC, CreatedAt ASC
    `,
      budgetId
    );
    return rows.map((row) => this.mapDashboardRow(row));
  }

  getDashboard(id: string): CustomDashboardWithWidgets | null {
    const dashboardRow = getRow<DashboardRow>(
      this.db,
      `SELECT * FROM custom_dashboards WHERE ID = ?`,
      id
    );

    if (!dashboardRow) return null;

    const widgetRows = allRows<DashboardWidgetRow>(
      this.db,
      `
      SELECT * FROM custom_dashboard_widgets
      WHERE DashboardID = ?
      ORDER BY SortOrder ASC, CreatedAt ASC
    `,
      id
    );

    return {
      ...this.mapDashboardRow(dashboardRow),
      widgets: widgetRows.map((row) => this.mapWidgetRow(row)),
    };
  }

  createDashboard(input: CreateCustomDashboardInput): CustomDashboard {
    const name = input.name.trim();
    if (!name) {
      throw new Error('Dashboard name cannot be empty');
    }

    const orderResult = getRow<{ NextOrder?: number }>(
      this.db,
      `SELECT COALESCE(MAX(SortOrder), -1) + 1 as NextOrder FROM custom_dashboards WHERE BudgetID = ?`,
      input.budgetId
    );
    const sortOrder = orderResult?.NextOrder ?? 0;

    const id = createId();
    const now = new Date().toISOString();

    try {
      run(
        this.db,
        `
        INSERT INTO custom_dashboards (ID, BudgetID, Name, SortOrder, CreatedAt, UpdatedAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
        id,
        input.budgetId,
        name,
        sortOrder,
        now,
        now
      );
    } catch (error) {
      if (hasUniqueConstraintError(error)) {
        throw new Error(`A dashboard named "${name}" already exists for this budget.`);
      }
      throw error;
    }

    const dashboard = this.getDashboard(id);
    if (!dashboard) throw new Error('Dashboard not found after create');
    return dashboard;
  }

  updateDashboard(input: UpdateCustomDashboardInput): CustomDashboard {
    const updateFields: string[] = [];
    const values: (string | number)[] = [];

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) {
        throw new Error('Dashboard name cannot be empty');
      }
      updateFields.push('Name = ?');
      values.push(name);
    }

    if (input.sortOrder !== undefined) {
      updateFields.push('SortOrder = ?');
      values.push(Math.max(0, Math.trunc(input.sortOrder)));
    }

    if (updateFields.length === 0) {
      const existing = this.getDashboard(input.id);
      if (!existing) throw new Error('Dashboard not found');
      return existing;
    }

    updateFields.push('UpdatedAt = ?');
    values.push(new Date().toISOString());
    values.push(input.id);

    try {
      const result = run(
        this.db,
        `
        UPDATE custom_dashboards
        SET ${updateFields.join(', ')}
        WHERE ID = ?
      `,
        ...values
      );
      if (!result.changes) throw new Error('Dashboard not found');
    } catch (error) {
      if (hasUniqueConstraintError(error) && input.name) {
        throw new Error(`A dashboard named "${input.name.trim()}" already exists for this budget.`);
      }
      throw error;
    }

    const updated = this.getDashboard(input.id);
    if (!updated) throw new Error('Dashboard not found after update');
    return updated;
  }

  deleteDashboard(id: string): void {
    run(this.db, `DELETE FROM custom_dashboards WHERE ID = ?`, id);
  }

  addWidget(input: AddCustomDashboardWidgetInput): CustomDashboardWithWidgets {
    const dashboard = this.getDashboard(input.dashboardId);
    if (!dashboard) {
      throw new Error('Dashboard not found');
    }

    if (!input.reportId.trim()) {
      throw new Error('Report ID is required');
    }
    if (!input.chartId.trim()) {
      throw new Error('Chart ID is required');
    }

    const orderResult = getRow<{ NextOrder?: number }>(
      this.db,
      `SELECT COALESCE(MAX(SortOrder), -1) + 1 as NextOrder FROM custom_dashboard_widgets WHERE DashboardID = ?`,
      input.dashboardId
    );
    const sortOrder = orderResult?.NextOrder ?? 0;

    const now = new Date().toISOString();
    const id = createId();

    const desktopLayout = clampDesktopLayout(input.desktopLayout ?? DEFAULT_DESKTOP_LAYOUT);
    const mobileLayout = clampMobileLayout(input.mobileLayout ?? DEFAULT_MOBILE_LAYOUT);
    const titleOverride = input.titleOverride?.trim();

    run(
      this.db,
      `
      INSERT INTO custom_dashboard_widgets (
        ID, DashboardID, ReportID, ChartID, SortOrder, DesktopLayout, MobileLayout, TitleOverride, CreatedAt, UpdatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      id,
      input.dashboardId,
      input.reportId.trim(),
      input.chartId.trim(),
      sortOrder,
      JSON.stringify(desktopLayout),
      JSON.stringify(mobileLayout),
      titleOverride || null,
      now,
      now
    );

    const updatedDashboard = this.getDashboard(input.dashboardId);
    if (!updatedDashboard) {
      throw new Error('Dashboard not found after widget insert');
    }
    return updatedDashboard;
  }

  updateWidget(input: UpdateCustomDashboardWidgetInput): CustomDashboardWidget {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (input.reportId !== undefined) {
      fields.push('ReportID = ?');
      values.push(input.reportId.trim());
    }

    if (input.chartId !== undefined) {
      fields.push('ChartID = ?');
      values.push(input.chartId.trim());
    }

    if (input.sortOrder !== undefined) {
      fields.push('SortOrder = ?');
      values.push(Math.max(0, Math.trunc(input.sortOrder)));
    }

    if (input.desktopLayout !== undefined) {
      fields.push('DesktopLayout = ?');
      values.push(JSON.stringify(clampDesktopLayout(input.desktopLayout)));
    }

    if (input.mobileLayout !== undefined) {
      fields.push('MobileLayout = ?');
      values.push(JSON.stringify(clampMobileLayout(input.mobileLayout)));
    }

    if (input.titleOverride !== undefined) {
      fields.push('TitleOverride = ?');
      const title = input.titleOverride?.trim();
      values.push(title || null);
    }

    if (fields.length === 0) {
      const existing = this.getWidgetById(input.id);
      if (!existing) throw new Error('Widget not found');
      return existing;
    }

    fields.push('UpdatedAt = ?');
    values.push(new Date().toISOString());
    values.push(input.id);

    const result = run(
      this.db,
      `
      UPDATE custom_dashboard_widgets
      SET ${fields.join(', ')}
      WHERE ID = ?
    `,
      ...values
    );
    if (!result.changes) throw new Error('Widget not found');

    const updated = this.getWidgetById(input.id);
    if (!updated) throw new Error('Widget not found after update');
    return updated;
  }

  deleteWidget(id: string): void {
    run(this.db, `DELETE FROM custom_dashboard_widgets WHERE ID = ?`, id);
  }

  private validateReorderIds(existingIds: string[], orderedIds: string[], label: string): void {
    if (existingIds.length !== orderedIds.length) {
      throw new Error(`Reorder payload does not match ${label} count`);
    }
    const orderedSet = new Set(orderedIds);
    if (orderedSet.size !== existingIds.length || existingIds.some((id) => !orderedSet.has(id))) {
      throw new Error(`Reorder payload must include all ${label} exactly once`);
    }
  }

  reorderDashboards(input: ReorderCustomDashboardsInput): void {
    const dashboards = this.getDashboards(input.budgetId);
    const existingIds = dashboards.map((d) => d.id);

    this.validateReorderIds(existingIds, input.orderedIds, 'dashboards');

    this.db.transaction(() => {
      const stmt = this.db.prepare(
        `UPDATE custom_dashboards SET SortOrder = ?, UpdatedAt = ? WHERE ID = ? AND BudgetID = ?`
      );
      const now = new Date().toISOString();
      input.orderedIds.forEach((id, index) => {
        stmt.run(index, now, id, input.budgetId);
      });
      stmt.finalize();
    });
  }

  reorderWidgets(input: ReorderCustomDashboardWidgetsInput): void {
    const dashboard = this.getDashboard(input.dashboardId);
    if (!dashboard) {
      throw new Error('Dashboard not found');
    }

    const existingIds = dashboard.widgets.map((w) => w.id);
    this.validateReorderIds(existingIds, input.orderedIds, 'widgets');

    this.db.transaction(() => {
      const stmt = this.db.prepare(
        `UPDATE custom_dashboard_widgets SET SortOrder = ?, UpdatedAt = ? WHERE ID = ? AND DashboardID = ?`
      );
      const now = new Date().toISOString();
      input.orderedIds.forEach((id, index) => {
        stmt.run(index, now, id, input.dashboardId);
      });
      stmt.finalize();
    });
  }

  private getWidgetById(id: string): CustomDashboardWidget | null {
    const row = getRow<DashboardWidgetRow>(
      this.db,
      `SELECT * FROM custom_dashboard_widgets WHERE ID = ?`,
      id
    );
    return row ? this.mapWidgetRow(row) : null;
  }

  private mapDashboardRow(row: DashboardRow): CustomDashboard {
    return {
      id: row.ID,
      budgetId: Number(row.BudgetID),
      name: row.Name,
      sortOrder: row.SortOrder,
      createdAt: row.CreatedAt,
      updatedAt: row.UpdatedAt,
    };
  }

  private mapWidgetRow(row: DashboardWidgetRow): CustomDashboardWidget {
    return {
      id: row.ID,
      dashboardId: row.DashboardID,
      reportId: row.ReportID,
      chartId: row.ChartID,
      sortOrder: row.SortOrder,
      desktopLayout: parseDesktopLayout(row.DesktopLayout),
      mobileLayout: parseMobileLayout(row.MobileLayout),
      titleOverride: row.TitleOverride ?? undefined,
      createdAt: row.CreatedAt,
      updatedAt: row.UpdatedAt,
    };
  }
}
