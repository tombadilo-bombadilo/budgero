import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

const HOME_DEFAULT = 'home_default';
const HOME_ALIAS = 'home_alias';

type Row = Record<string, unknown>;

function rows(db: MigrationDatabase, sql: string): Row[] {
  const [result] = db.exec(sql);
  if (!result) return [];
  return result.values.map((values) =>
    Object.fromEntries(result.columns.map((column, index) => [column, values[index]]))
  );
}

const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** The tag a copy of the default home carries in its stored name (`Home ·a1b2`). */
function nameTag(id: string): string {
  return id
    .replace(/[^0-9a-z]/gi, '')
    .slice(0, 4)
    .toLowerCase();
}

interface Dashboard {
  id: string;
  budgetId: number;
  name: string;
  origin: string | null;
  createdAt: string;
  isHome: boolean;
}

function parse(payload: unknown): Row | null {
  if (typeof payload !== 'string') return null;
  try {
    const value: unknown = JSON.parse(payload);
    return value && typeof value === 'object' ? (value as Row) : null;
  } catch {
    return null;
  }
}

/**
 * Copies of the default home that a build before 1.21 stored without their
 * origin: it ignores `origin` and `isHome`, so a device that was on such a
 * build while another device customised the home holds that copy as an
 * ordinary dashboard and, once updated, would never show it as its home.
 *
 * Finds those copies (seeded card IDs `<dashboard>:<card>`, the `·tag`
 * name, or the create recorded in the mutation history) and gives them the
 * state a device that had this build all along holds: the copy that arrived
 * first (CreatedAt, then ID: the order the hidden-copy rule uses) is the
 * budget's copy, the rest are hidden copies whose edits are merged into it
 * as this build merges them (added cards move over, a seeded card one copy
 * removed is removed). The home choice comes back from the history when it
 * is still there; otherwise the copy is the home, as right after it was made.
 *
 * Idempotent: budgets without such a copy are left alone.
 */
export function repairHomeCopies(db: MigrationDatabase): void {
  const dashboards: Dashboard[] = rows(
    db,
    `SELECT ID, BudgetID, Name, Origin, CreatedAt, IsHome FROM custom_dashboards`
  ).map((row) => ({
    id: String(row.ID),
    budgetId: Number(row.BudgetID),
    name: String(row.Name ?? ''),
    origin: (row.Origin as string | null) ?? null,
    createdAt: String(row.CreatedAt ?? ''),
    isHome: Number(row.IsHome ?? 0) === 1,
  }));
  if (dashboards.length === 0) return;

  const widgets = rows(db, `SELECT ID, DashboardID, ReportID FROM custom_dashboard_widgets`).map(
    (row) => ({
      id: String(row.ID),
      dashboardId: String(row.DashboardID),
      reportId: String(row.ReportID),
    })
  );
  const seededKey = (widget: { id: string; dashboardId: string; reportId: string }) =>
    widget.id.startsWith(`${widget.dashboardId}:`) && widget.reportId.startsWith('builtin:')
      ? widget.id.slice(widget.dashboardId.length + 1)
      : null;

  let history: { op: string; args: Row }[] = [];
  try {
    history = rows(
      db,
      `SELECT Op, Payload FROM mutation_history
       WHERE Op IN ('customDashboards.create', 'customDashboards.update', 'customDashboards.delete')
       ORDER BY ID ASC`
    ).flatMap((row) => {
      const args = parse(row.Payload);
      return args ? [{ op: String(row.Op), args }] : [];
    });
  } catch {
    history = [];
  }
  const createdAsCopy = new Set(
    history
      .filter(
        (entry) => entry.op === 'customDashboards.create' && entry.args.origin === HOME_DEFAULT
      )
      .map((entry) => String(entry.args.id))
  );

  const isUnmarkedCopy = (dashboard: Dashboard) =>
    dashboard.origin === null &&
    (createdAsCopy.has(dashboard.id) ||
      widgets.some((widget) => widget.dashboardId === dashboard.id && seededKey(widget)) ||
      (nameTag(dashboard.id).length === 4 &&
        dashboard.name.endsWith(` ·${nameTag(dashboard.id)}`)));

  const budgets = [...new Set(dashboards.map((dashboard) => dashboard.budgetId))];
  for (const budgetId of budgets) {
    const inBudget = dashboards.filter((dashboard) => dashboard.budgetId === budgetId);
    if (!inBudget.some(isUnmarkedCopy)) continue;

    const copies = inBudget
      .filter(
        (dashboard) =>
          dashboard.origin === HOME_DEFAULT ||
          dashboard.origin === HOME_ALIAS ||
          isUnmarkedCopy(dashboard)
      )
      .sort((a, b) =>
        a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1
      );
    const primary = copies[0];
    const secondaries = copies.slice(1);
    debugLog('[Migration 78] repairing home copies', {
      budgetId,
      primary: primary.id,
      secondaries: secondaries.length,
    });

    db.exec(`UPDATE custom_dashboards SET Origin = '${HOME_DEFAULT}' WHERE ID = ${q(primary.id)}`);
    for (const secondary of secondaries) {
      // A hidden copy that this build already merged needs nothing more.
      if (secondary.origin !== HOME_ALIAS) {
        const own = widgets.filter((widget) => widget.dashboardId === secondary.id);
        const keys = new Set(own.map(seededKey).filter((key): key is string => key !== null));
        // Cards added to it belong on the budget's copy.
        for (const widget of own) {
          if (seededKey(widget)) continue;
          db.exec(
            `UPDATE custom_dashboard_widgets SET DashboardID = ${q(primary.id)} WHERE ID = ${q(widget.id)}`
          );
        }
        // A seeded card it removed is removed from the budget's copy too.
        if (keys.size > 0) {
          for (const widget of widgets.filter((item) => item.dashboardId === primary.id)) {
            const key = seededKey(widget);
            if (key && !keys.has(key)) {
              db.exec(`DELETE FROM custom_dashboard_widgets WHERE ID = ${q(widget.id)}`);
            }
          }
        }
      }
      db.exec(
        `UPDATE custom_dashboards SET Origin = '${HOME_ALIAS}', IsHome = 0 WHERE ID = ${q(secondary.id)}`
      );
    }

    // The home choice, replayed from the history (older builds dropped it).
    const copyIds = new Set(copies.map((copy) => copy.id));
    const resolve = (id: string) => (copyIds.has(id) ? primary.id : id);
    let home: string | null = null;
    let decided = false;
    for (const entry of history) {
      const id = String(entry.args.id ?? '');
      if (entry.op === 'customDashboards.update' && typeof entry.args.isHome === 'boolean') {
        decided = true;
        if (entry.args.isHome) home = resolve(id);
        else if (home === resolve(id)) home = null;
      } else if (entry.op === 'customDashboards.delete' && home !== null && resolve(id) === home) {
        home = null;
      }
    }
    const exists = (id: string | null) => id !== null && inBudget.some((d) => d.id === id);
    const flagged = inBudget.find((dashboard) => dashboard.isHome && !copyIds.has(dashboard.id));
    const target = decided ? (exists(home) ? home : null) : (flagged?.id ?? primary.id);
    db.exec(`UPDATE custom_dashboards SET IsHome = 0 WHERE BudgetID = ${budgetId}`);
    if (target) db.exec(`UPDATE custom_dashboards SET IsHome = 1 WHERE ID = ${q(target)}`);
  }
}

export const migration078: Migration = {
  version: 78,
  description: 'Mark copies of the default home stored by builds that ignored their origin',
  up: (db: MigrationDatabase) => {
    try {
      repairHomeCopies(db);
    } catch (error) {
      debugLog('[Migration 78] repair failed', { error });
    }
  },
  verify: () => true,
};
