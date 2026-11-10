import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, allRows, run } from '../../database/sql.js';
import { clock } from '../../utils/clock.js';

export interface DesktopWidgetLayout {
  colSpan: number;
  rowSpan: number;
  /** Not shown on desktop (a card that only belongs on the phone layout). */
  hidden?: boolean;
}

export interface MobileWidgetLayout {
  size: 's' | 'm' | 'l';
  /**
   * Position on the phone when it differs from the desktop order. Widgets
   * without one follow, in desktop order.
   */
  order?: number;
  /** Not shown on the phone. */
  hidden?: boolean;
}

/**
 * Layout patches as sent by callers: a key left out keeps its stored value
 * (older builds send only colSpan/rowSpan or size); `order: null` clears it.
 */
export type DesktopWidgetLayoutInput = Omit<DesktopWidgetLayout, 'hidden'> & {
  hidden?: boolean | null;
};
export type MobileWidgetLayoutInput = Omit<MobileWidgetLayout, 'order' | 'hidden'> & {
  order?: number | null;
  hidden?: boolean | null;
};

/** Origin of a dashboard made from the default home on its first edit. */
export const HOME_DEFAULT_ORIGIN = 'home_default';

/**
 * Origin of a second copy of the default home that reached this database
 * while the budget already had one: two devices customised the home before
 * syncing. Older builds store it as a normal dashboard; this build hides it
 * and applies what is done to it to the budget's copy, so every device ends
 * with one home holding both devices' edits, whatever order they arrive in.
 */
export const HOME_ALIAS_ORIGIN = 'home_alias';

/**
 * Card widgets seeded into a copy of the default home have the ID
 * `<dashboard id>:<card key>`, which pairs a copy's card with the same card
 * of another copy.
 */
export function seededWidgetId(dashboardId: string, cardKey: string): string {
  return `${dashboardId}:${cardKey}`;
}

function seededCardKey(widgetId: string, dashboardId: string): string | null {
  const prefix = `${dashboardId}:`;
  return widgetId.startsWith(prefix) ? widgetId.slice(prefix.length) : null;
}

/**
 * Dashboard-level filters as stored: a plain JSON object the app owns
 * (date range, accounts, category groups). Core only checks shape and size.
 */
export type CustomDashboardFilters = Record<string, unknown>;

export interface CustomDashboard {
  id: string;
  budgetId: number;
  name: string;
  sortOrder: number;
  /** Null when the dashboard has no filters set. */
  filters: CustomDashboardFilters | null;
  /** The home page shows this dashboard (at most one per budget). */
  isHome: boolean;
  /** Where it came from: HOME_DEFAULT_ORIGIN, or null for one made by hand. */
  origin: string | null;
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
  /** Restores a deleted dashboard under its original ID (undo). */
  id?: string;
  budgetId: number;
  name: string;
  origin?: string | null;
}

export interface UpdateCustomDashboardInput {
  id: string;
  name?: string;
  sortOrder?: number;
  /** Null clears the filters. */
  filters?: CustomDashboardFilters | null;
  /** true makes it the budget's home dashboard (clearing any other); false unsets it. */
  isHome?: boolean;
}

export interface AddCustomDashboardWidgetInput {
  /** Restores a deleted widget under its original ID (undo). */
  id?: string;
  dashboardId: string;
  reportId: string;
  chartId: string;
  desktopLayout?: DesktopWidgetLayoutInput;
  mobileLayout?: MobileWidgetLayoutInput;
  titleOverride?: string;
  /**
   * Part of the first seeding of a copy of the default home. A seeded card
   * added to a hidden second copy then stays there; added later (an undo of
   * its removal) it also comes back on the budget's copy.
   */
  seed?: boolean;
}

export interface UpdateCustomDashboardWidgetInput {
  id: string;
  desktopLayout?: DesktopWidgetLayoutInput;
  mobileLayout?: MobileWidgetLayoutInput;
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
  /** ID of the dashboard the home page shows, or null for the default home. */
  getHomeDashboardId(budgetId: number): string | null;
  getWidgetById(id: string): CustomDashboardWidget | null;
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
  Filters?: string | null;
  IsHome?: number | bigint | null;
  Origin?: string | null;
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
  return `cd_${clock.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const MAX_MOBILE_ORDER = 10_000;

function clampOrder(value: unknown): number | undefined {
  const order = Number(value);
  if (value === null || value === undefined || !Number.isFinite(order)) return undefined;
  return Math.max(0, Math.min(MAX_MOBILE_ORDER, Math.trunc(order)));
}

/**
 * Stored desktop layout: spans clamped, `hidden` only when set. `previous`
 * supplies keys the input leaves out (a patch from an older build).
 */
function clampDesktopLayout(
  layout: DesktopWidgetLayoutInput,
  previous?: DesktopWidgetLayout
): DesktopWidgetLayout {
  const colSpan = Number.isFinite(layout.colSpan)
    ? Math.max(MIN_COL_SPAN, Math.min(MAX_COL_SPAN, Math.trunc(layout.colSpan)))
    : DEFAULT_DESKTOP_LAYOUT.colSpan;
  const rowSpan = Number.isFinite(layout.rowSpan)
    ? Math.max(MIN_ROW_SPAN, Math.min(MAX_ROW_SPAN, Math.trunc(layout.rowSpan)))
    : DEFAULT_DESKTOP_LAYOUT.rowSpan;
  const hidden = 'hidden' in layout ? layout.hidden === true : previous?.hidden === true;
  return hidden ? { colSpan, rowSpan, hidden } : { colSpan, rowSpan };
}

function clampMobileLayout(
  layout: MobileWidgetLayoutInput,
  previous?: MobileWidgetLayout
): MobileWidgetLayout {
  const size =
    layout.size === 's' || layout.size === 'm' || layout.size === 'l'
      ? layout.size
      : DEFAULT_MOBILE_LAYOUT.size;
  const order = 'order' in layout ? clampOrder(layout.order) : previous?.order;
  const hidden = 'hidden' in layout ? layout.hidden === true : previous?.hidden === true;
  return {
    size,
    ...(order !== undefined ? { order } : {}),
    ...(hidden ? { hidden } : {}),
  };
}

function parseLayoutJson(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseDesktopLayout(raw: string | null | undefined): DesktopWidgetLayout {
  const parsed = parseLayoutJson(raw);
  if (!parsed) return DEFAULT_DESKTOP_LAYOUT;
  return clampDesktopLayout({
    colSpan: Number(parsed.colSpan),
    rowSpan: Number(parsed.rowSpan),
    hidden: parsed.hidden === true,
  });
}

function parseMobileLayout(raw: string | null | undefined): MobileWidgetLayout {
  const parsed = parseLayoutJson(raw);
  if (!parsed) return DEFAULT_MOBILE_LAYOUT;
  return clampMobileLayout({
    size: parsed.size as MobileWidgetLayout['size'],
    order: parsed.order as number | undefined,
    hidden: parsed.hidden === true,
  });
}

const MAX_FILTERS_JSON = 16 * 1024;

/** Filters as stored JSON; null for empty / missing. Throws on non-objects or oversize. */
function serializeFilters(filters: CustomDashboardFilters | null): string | null {
  if (filters === null) return null;
  if (typeof filters !== 'object' || Array.isArray(filters)) {
    throw new Error('Dashboard filters must be an object');
  }
  if (Object.keys(filters).length === 0) return null;
  const json = JSON.stringify(filters);
  if (json.length > MAX_FILTERS_JSON) throw new Error('Dashboard filters are too large');
  return json;
}

function parseFilters(raw: string | null | undefined): CustomDashboardFilters | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as CustomDashboardFilters)
      : null;
  } catch {
    return null;
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
      WHERE BudgetID = ? AND (Origin IS NULL OR Origin != '${HOME_ALIAS_ORIGIN}')
      ORDER BY SortOrder ASC, CreatedAt ASC
    `,
      budgetId
    );
    return rows.map((row) => this.mapDashboardRow(row));
  }

  /** The budget's copy of the default home (the oldest if an older build made two). */
  private homeCopyRow(budgetId: number | bigint, exceptId?: string): DashboardRow | null {
    return (
      getRow<DashboardRow>(
        this.db,
        `SELECT * FROM custom_dashboards
         WHERE BudgetID = ? AND Origin = '${HOME_DEFAULT_ORIGIN}' AND ID != ?
         ORDER BY CreatedAt ASC, ID ASC LIMIT 1`,
        budgetId,
        exceptId ?? ''
      ) ?? null
    );
  }

  private dashboardRow(id: string): DashboardRow | null {
    return (
      getRow<DashboardRow>(this.db, `SELECT * FROM custom_dashboards WHERE ID = ?`, id) ?? null
    );
  }

  /** For a hidden second copy: the budget's copy its changes go to. */
  private aliasTarget(dashboardId: string): DashboardRow | null {
    const row = this.dashboardRow(dashboardId);
    if (!row || row.Origin !== HOME_ALIAS_ORIGIN) return null;
    return this.homeCopyRow(row.BudgetID);
  }

  /** The widget of the budget's copy paired with a seeded card of a hidden second copy. */
  private pairedWidgetId(widget: CustomDashboardWidget): string | null {
    const target = this.aliasTarget(widget.dashboardId);
    const key = target ? seededCardKey(widget.id, widget.dashboardId) : null;
    if (!target || !key) return null;
    const paired = seededWidgetId(target.ID, key);
    return this.getWidgetById(paired) ? paired : null;
  }

  getHomeDashboardId(budgetId: number): string | null {
    // One home per budget is kept by updateDashboard; the newest wins if two
    // ever get through (e.g. a database restored from before a sync).
    const row = getRow<{ ID: string }>(
      this.db,
      `SELECT ID FROM custom_dashboards WHERE BudgetID = ? AND IsHome = 1
       ORDER BY UpdatedAt DESC, ID ASC LIMIT 1`,
      budgetId
    );
    return row?.ID ?? null;
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

    const id = input.id ?? createId();
    const now = clock.date().toISOString();
    let origin = input.origin?.trim() || null;
    if (origin === HOME_DEFAULT_ORIGIN && this.homeCopyRow(input.budgetId, id)) {
      // Another device's copy of the default home: hidden, edits go to ours.
      origin = HOME_ALIAS_ORIGIN;
    }

    try {
      run(
        this.db,
        `
        INSERT INTO custom_dashboards (ID, BudgetID, Name, SortOrder, Origin, CreatedAt, UpdatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        id,
        input.budgetId,
        name,
        sortOrder,
        origin,
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
    const target = this.aliasTarget(input.id);
    if (target) {
      // Home, filters and position belong to the budget's copy; a hidden
      // copy keeps its own name.
      return this.updateDashboard({
        id: target.ID,
        sortOrder: input.sortOrder,
        filters: input.filters,
        isHome: input.isHome,
      });
    }
    const updateFields: string[] = [];
    const values: (string | number | null)[] = [];

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

    if (input.filters !== undefined) {
      updateFields.push('Filters = ?');
      values.push(serializeFilters(input.filters));
    }

    if (input.isHome !== undefined) {
      updateFields.push('IsHome = ?');
      values.push(input.isHome ? 1 : 0);
    }

    if (updateFields.length === 0) {
      const existing = this.getDashboard(input.id);
      if (!existing) throw new Error('Dashboard not found');
      return existing;
    }

    updateFields.push('UpdatedAt = ?');
    values.push(clock.date().toISOString());
    values.push(input.id);

    const write = () => {
      if (input.isHome === true) {
        // One home per budget: taking it clears the previous one.
        run(
          this.db,
          `UPDATE custom_dashboards SET IsHome = 0
             WHERE IsHome = 1 AND ID != ?
               AND BudgetID = (SELECT BudgetID FROM custom_dashboards WHERE ID = ?)`,
          input.id,
          input.id
        );
      }
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
    };
    try {
      if (this.db.inTransaction) write();
      else this.db.transaction(write);
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
    const row = this.dashboardRow(id);
    if (row && (row.Origin === HOME_DEFAULT_ORIGIN || row.Origin === HOME_ALIAS_ORIGIN)) {
      // Removing the customised home (its copy or a hidden second one)
      // removes all of them, so every device ends with the default home.
      run(
        this.db,
        `DELETE FROM custom_dashboards
         WHERE BudgetID = ? AND Origin IN ('${HOME_DEFAULT_ORIGIN}', '${HOME_ALIAS_ORIGIN}')`,
        row.BudgetID
      );
      return;
    }
    run(this.db, `DELETE FROM custom_dashboards WHERE ID = ?`, id);
  }

  addWidget(input: AddCustomDashboardWidgetInput): CustomDashboardWithWidgets {
    const target = this.aliasTarget(input.dashboardId);
    const cardKey = input.id ? seededCardKey(input.id, input.dashboardId) : null;
    if (target && !cardKey) {
      // Added to a hidden second copy: it goes on the budget's copy.
      return this.addWidget({ ...input, dashboardId: target.ID });
    }
    if (target && cardKey && !input.seed) {
      // A seeded card coming back (undo of its removal): our paired card too.
      const paired = seededWidgetId(target.ID, cardKey);
      if (!this.getWidgetById(paired)) {
        this.addWidget({ ...input, id: paired, dashboardId: target.ID });
      }
    }
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

    const now = clock.date().toISOString();
    const id = input.id ?? createId();

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
    const widget = this.getWidgetById(input.id);
    const paired = widget ? this.pairedWidgetId(widget) : null;
    if (paired) {
      // A card of a hidden second copy: the change applies to our copy's card too.
      this.writeWidget({ ...input, id: paired });
    }
    return this.writeWidget(input);
  }

  private writeWidget(input: UpdateCustomDashboardWidgetInput): CustomDashboardWidget {
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

    const existing =
      input.desktopLayout !== undefined || input.mobileLayout !== undefined
        ? this.getWidgetById(input.id)
        : null;

    if (input.desktopLayout !== undefined) {
      fields.push('DesktopLayout = ?');
      values.push(JSON.stringify(clampDesktopLayout(input.desktopLayout, existing?.desktopLayout)));
    }

    if (input.mobileLayout !== undefined) {
      fields.push('MobileLayout = ?');
      values.push(JSON.stringify(clampMobileLayout(input.mobileLayout, existing?.mobileLayout)));
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
    values.push(clock.date().toISOString());
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
    const widget = this.getWidgetById(id);
    const paired = widget ? this.pairedWidgetId(widget) : null;
    if (paired) run(this.db, `DELETE FROM custom_dashboard_widgets WHERE ID = ?`, paired);
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
      const now = clock.date().toISOString();
      input.orderedIds.forEach((id, index) => {
        stmt.run(index, now, id, input.budgetId);
      });
      stmt.finalize();
    });
  }

  reorderWidgets(input: ReorderCustomDashboardWidgetsInput): void {
    const target = this.aliasTarget(input.dashboardId);
    if (target) {
      // A hidden second copy's order applies to our copy: its seeded cards
      // map to ours, the rest keep their IDs; cards only we have follow.
      const current = this.getDashboard(target.ID)?.widgets.map((w) => w.id) ?? [];
      const present = new Set(current);
      const mapped = input.orderedIds
        .map((id) => {
          const key = seededCardKey(id, input.dashboardId);
          return key ? seededWidgetId(target.ID, key) : id;
        })
        .filter((id, index, all) => present.has(id) && all.indexOf(id) === index);
      const listed = new Set(mapped);
      const orderedIds = [...mapped, ...current.filter((id) => !listed.has(id))];
      if (orderedIds.length > 0) this.reorderWidgets({ dashboardId: target.ID, orderedIds });
      return;
    }
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
      const now = clock.date().toISOString();
      input.orderedIds.forEach((id, index) => {
        stmt.run(index, now, id, input.dashboardId);
      });
      stmt.finalize();
    });
  }

  getWidgetById(id: string): CustomDashboardWidget | null {
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
      filters: parseFilters(row.Filters),
      isHome: Number(row.IsHome ?? 0) === 1,
      origin: row.Origin ?? null,
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
