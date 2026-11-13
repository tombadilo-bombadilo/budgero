/**
 * Reporting tables computed by the app's own services rather than SQL, so
 * reports show exactly what the app's screens show:
 *
 * - `budget_months`: every category's assigned / activity / available per
 *   month as the budget screen computes them (MonthlyBudgetService, both
 *   Ready to Assign modes, rollover and overspending rules), plus the goal
 *   progress the budget screen shows for that month.
 * - `scheduled_transactions` / `scheduled_occurrences`: recurring templates
 *   and their occurrences, amounts in the budget currency at each
 *   occurrence's rate (RecurringTransactionService).
 *
 * Pure builders (services in, rows out) so tests run them against a real
 * core database; the DuckDB engine loads them when a query names the table.
 */
import { GoalCalculations, GoalType, type Goal, type Services } from '@budgero/core/browser';

export type DerivedColumnType = 'VARCHAR' | 'BIGINT' | 'DOUBLE' | 'BOOLEAN' | 'DECIMAL(18, 3)';

export interface DerivedColumn {
  name: string;
  type: DerivedColumnType;
}

/** Minimal read access to the local SQLite database. */
export interface DerivedSqlDatabase {
  prepare(sql: string): { all(): Record<string, unknown>[]; finalize(): void };
}

export interface DerivedTableContext {
  services: Services;
  db: DerivedSqlDatabase;
  /** Local "today" (YYYY-MM-DD). */
  today: string;
}

export interface DerivedTable {
  name: string;
  columns: readonly DerivedColumn[];
  build: (context: DerivedTableContext) => Record<string, unknown>[];
}

const money = (name: string): DerivedColumn => ({ name, type: 'DECIMAL(18, 3)' });
const text = (name: string): DerivedColumn => ({ name, type: 'VARCHAR' });
const int = (name: string): DerivedColumn => ({ name, type: 'BIGINT' });
const bool = (name: string): DerivedColumn => ({ name, type: 'BOOLEAN' });
const double = (name: string): DerivedColumn => ({ name, type: 'DOUBLE' });

/** Milliunits → currency units (3 decimals, exact for integer milliunits). */
function units(milli: number | null | undefined): number | null {
  if (milli === null || milli === undefined || !Number.isFinite(Number(milli))) return null;
  return Math.round(Number(milli)) / 1000;
}

function queryRows(db: DerivedSqlDatabase, sql: string): Record<string, unknown>[] {
  const statement = db.prepare(sql);
  try {
    return statement.all();
  } finally {
    statement.finalize();
  }
}

function budgetIds(db: DerivedSqlDatabase): number[] {
  return queryRows(db, 'SELECT ID FROM budgets ORDER BY ID')
    .map((row) => Number(row.ID))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** YYYY-MM keys from `first` to `last`, inclusive. */
export function monthRange(first: string, last: string): string[] {
  const [fromYear, fromMonth] = first.split('-').map(Number);
  const [toYear, toMonth] = last.split('-').map(Number);
  const months: string[] = [];
  for (
    let cursor = new Date(Date.UTC(fromYear, fromMonth - 1, 1));
    cursor <= new Date(Date.UTC(toYear, toMonth - 1, 1));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  ) {
    months.push(monthKey(cursor));
  }
  return months;
}

const MONTH_KEY = /^\d{4}-\d{2}$/;

/**
 * Months a budget's budget screen has data for: the first assignment or
 * transaction month through the latest of this month, the last assignment
 * and the last (future-dated) transaction.
 */
export function budgetMonths(db: DerivedSqlDatabase, budgetId: number, today: string): string[] {
  const [bounds] = queryRows(
    db,
    `SELECT
       (SELECT MIN(SUBSTR(Month, 1, 7)) FROM assignments WHERE BudgetID = ${budgetId}) AS FirstAssigned,
       (SELECT MAX(SUBSTR(Month, 1, 7)) FROM assignments WHERE BudgetID = ${budgetId}) AS LastAssigned,
       (SELECT MIN(SUBSTR(Date, 1, 7)) FROM transactions WHERE BudgetID = ${budgetId}) AS FirstTransaction,
       (SELECT MAX(SUBSTR(Date, 1, 7)) FROM transactions WHERE BudgetID = ${budgetId}) AS LastTransaction`
  );
  const current = today.slice(0, 7);
  const candidates = (values: unknown[]) =>
    values.filter((value): value is string => typeof value === 'string' && MONTH_KEY.test(value));
  const first = [
    current,
    ...candidates([bounds?.FirstAssigned, bounds?.FirstTransaction]),
  ].sort()[0];
  const last = [current, ...candidates([bounds?.LastAssigned, bounds?.LastTransaction])]
    .sort()
    .at(-1)!;
  return monthRange(first, last);
}

const EXCLUDED_GROUPS = new Set(['Income', 'Transfers']);

function needsCycleHistory(goal: Goal): boolean {
  return goal.Type === GoalType.YEARLY || goal.Type === GoalType.TARGET_DATE;
}

export const BUDGET_MONTHS_COLUMNS: readonly DerivedColumn[] = [
  int('budget_id'),
  text('month'),
  int('category_id'),
  text('category_name'),
  int('category_group_id'),
  text('category_group_name'),
  money('assigned'),
  money('activity'),
  money('available'),
  text('goal_type'),
  money('goal_target'),
  money('goal_monthly_target'),
  money('goal_needed'),
  double('goal_progress'),
  bool('goal_funded'),
];

/**
 * Goal history for one category, read once: the same rows
 * GoalService.getCategoryFinancials queries per month (assignments before the
 * month, at most 240, chronological; assignments after it up to 12 months
 * ahead), sliced per month. Activity history isn't read by goal progress.
 */
function cycleHistory(db: DerivedSqlDatabase, categoryId: number) {
  const all = queryRows(
    db,
    `SELECT Month AS month, Amount AS amount FROM assignments WHERE CategoryID = ${categoryId} ORDER BY Month ASC`
  ).map((row) => ({ month: String(row.month), amount: Number(row.amount) }));
  return (month: string) => {
    const [year, monthNumber] = month.split('-').map(Number);
    const future = new Date(year, monthNumber + 11, 1);
    const futureMonth = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}`;
    return {
      historicalAssignments: all.filter((row) => row.month < month).slice(-240),
      plannedAssignments: all.filter((row) => row.month > month && row.month <= futureMonth),
    };
  };
}

/** One budget's `budget_months` rows (budget screen numbers, milliunits → units). */
export function buildBudgetMonthRows(
  context: DerivedTableContext,
  budgetId: number
): Record<string, unknown>[] {
  const { services, db, today } = context;
  const goals = new Map<number, Goal>(
    services.goals.getAllGoals().map((goal) => [goal.CategoryID, goal])
  );
  const histories = new Map<number, ReturnType<typeof cycleHistory>>();
  const history = (categoryId: number) => {
    let entry = histories.get(categoryId);
    if (!entry) {
      entry = cycleHistory(db, categoryId);
      histories.set(categoryId, entry);
    }
    return entry;
  };
  const rows: Record<string, unknown>[] = [];
  for (const month of budgetMonths(db, budgetId, today)) {
    for (const row of services.monthlyBudgets.getMonthlyBudget(month, budgetId)) {
      if (EXCLUDED_GROUPS.has(row.CategoryGroup)) continue;
      const goal = goals.get(row.CategoryID);
      // The budget screen's goal progress for this month (useBudgetTableState).
      const progress = goal
        ? GoalCalculations.calculateProgress(
            goal,
            {
              available: Number(row.Available) || 0,
              assigned: Number(row.Assigned) || 0,
              activity: Number(row.Activity) || 0,
              ...(needsCycleHistory(goal) ? history(row.CategoryID)(month) : {}),
            },
            month
          )
        : null;
      rows.push({
        budget_id: budgetId,
        month: `${month}-01`,
        category_id: row.CategoryID,
        category_name: row.Category,
        category_group_id: row.CategoryGroupID,
        category_group_name: row.CategoryGroup,
        assigned: units(row.Assigned),
        activity: units(row.Activity),
        available: units(row.Available),
        goal_type: goal ? goal.Type : null,
        goal_target: goal ? units(goal.Target) : null,
        goal_monthly_target: progress ? units(progress.monthlyTarget) : null,
        goal_needed: progress ? units(progress.amountNeeded) : null,
        goal_progress: progress ? Math.round(progress.percentage * 100) / 100 : null,
        goal_funded: progress ? progress.isFunded || progress.isOnTrack : null,
      });
    }
  }
  return rows;
}

/** Test seam: the per-month goal history as getCategoryFinancials would return it. */
export const goalCycleHistory = cycleHistory;

// ---------------------------------------------------------------------------
// Scheduled transactions
// ---------------------------------------------------------------------------

const OCCURRENCES_PER_YEAR = { day: 365, week: 52, month: 12, year: 1 } as const;

/** "month", or "<n>-<unit>" ("2-week") for every n units. */
export function frequencyCode(unit: string, count: number): string {
  return count > 1 ? `${count}-${unit}` : unit;
}

/** Monthly equivalent: occurrences per year (daily 365, weekly 52, monthly 12, yearly 1) / interval / 12. */
export function monthlyEquivalent(amount: number, unit: string, count: number): number {
  const perYear = OCCURRENCES_PER_YEAR[unit as keyof typeof OCCURRENCES_PER_YEAR] ?? 12;
  return (amount * perYear) / Math.max(1, count) / 12;
}

/** How far ahead occurrences are materialized for reports (days). */
const OCCURRENCE_HORIZON_DAYS = 400;

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + days));
  return `${monthKey(next)}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

const TEMPLATE_COLUMNS: readonly DerivedColumn[] = [
  int('budget_id'),
  int('recurring_id'),
  text('payee'),
  text('memo'),
  int('account_id'),
  text('account_name'),
  int('to_account_id'),
  text('to_account_name'),
  int('category_id'),
  text('category_name'),
  int('category_group_id'),
  text('category_group_name'),
  text('direction'),
  text('currency'),
  money('amount_native'),
  money('amount'),
  money('inflow'),
  money('outflow'),
  text('interval_unit'),
  int('interval_count'),
  text('frequency'),
  bool('is_transfer'),
  bool('is_split'),
  bool('paused'),
];

export const SCHEDULED_TRANSACTIONS_COLUMNS: readonly DerivedColumn[] = [
  ...TEMPLATE_COLUMNS,
  money('monthly_amount'),
  text('status'),
  text('next_date'),
  text('start_date'),
  text('end_date'),
];

export const SCHEDULED_OCCURRENCES_COLUMNS: readonly DerivedColumn[] = [
  ...TEMPLATE_COLUMNS,
  int('occurrence_id'),
  text('due_date'),
  text('status'),
  int('transaction_id'),
];

interface NameMaps {
  accounts: Map<number, { name: string; currency: string }>;
  categories: Map<number, { name: string; groupId: number | null; group: string | null }>;
  displayCurrency: string;
}

function nameMaps(db: DerivedSqlDatabase, budgetId: number): NameMaps {
  const accounts = new Map(
    queryRows(db, `SELECT ID, Name, Currency FROM accounts WHERE BudgetID = ${budgetId}`).map(
      (row) => [
        Number(row.ID),
        { name: String(row.Name ?? ''), currency: String(row.Currency ?? '') },
      ]
    )
  );
  const categories = new Map(
    queryRows(
      db,
      `SELECT c.ID, c.Name, c.CategoryGroupID, g.Name AS GroupName
       FROM categories c LEFT JOIN category_groups g ON g.ID = c.CategoryGroupID
       WHERE c.BudgetID = ${budgetId}`
    ).map((row) => [
      Number(row.ID),
      {
        name: String(row.Name ?? ''),
        groupId: row.CategoryGroupID === null ? null : Number(row.CategoryGroupID),
        group: row.GroupName === null || row.GroupName === undefined ? null : String(row.GroupName),
      },
    ])
  );
  const [budget] = queryRows(db, `SELECT DisplayCurrency FROM budgets WHERE ID = ${budgetId}`);
  return { accounts, categories, displayCurrency: String(budget?.DisplayCurrency ?? '') };
}

type Template = ReturnType<Services['recurring']['listRecurringTransactions']>[number];

/** Split templates (a newer app's `splits` lines): several categories, no single one. */
function isSplitTemplate(template: Template): boolean {
  const { splits } = template as unknown as { splits?: unknown };
  return Array.isArray(splits) && splits.length > 0;
}

function templateFields(template: Template, names: NameMaps, budgetAmount: number) {
  const account = names.accounts.get(template.accountId);
  const toAccount = template.toAccountId ? names.accounts.get(template.toAccountId) : undefined;
  const split = isSplitTemplate(template);
  const category =
    !split && template.categoryId ? names.categories.get(template.categoryId) : undefined;
  const sign = template.direction === 'inflow' ? 1 : -1;
  const unit = template.schedule.intervalUnit;
  const count = Math.max(1, Math.trunc(Number(template.schedule.intervalCount) || 1));
  return {
    budget_id: template.budgetId,
    recurring_id: template.id,
    payee: template.name,
    memo: template.memo,
    account_id: template.accountId,
    account_name: account?.name ?? null,
    to_account_id: template.toAccountId ?? null,
    to_account_name: toAccount?.name ?? null,
    category_id: category ? template.categoryId : null,
    category_name: category?.name ?? null,
    category_group_id: category?.groupId ?? null,
    category_group_name: category?.group ?? null,
    direction: template.direction,
    currency: account?.currency ?? null,
    amount_native: units(sign * template.amount),
    amount: units(sign * budgetAmount),
    inflow: units(sign > 0 ? budgetAmount : 0),
    outflow: units(sign < 0 ? budgetAmount : 0),
    interval_unit: unit,
    interval_count: count,
    frequency: frequencyCode(unit, count),
    is_transfer: template.toAccountId !== null && template.toAccountId !== undefined,
    is_split: split,
    paused: !template.active,
  };
}

/**
 * Materializes occurrences ahead (the same read-path write the Scheduled page
 * and analytics do), then reads templates and occurrences.
 */
function scheduledData(context: DerivedTableContext, budgetId: number) {
  const { services, db, today } = context;
  const names = nameMaps(db, budgetId);
  const templates = services.recurring.listRecurringTransactions(budgetId, true);
  const occurrences =
    templates.length > 0
      ? services.recurring.listOccurrences(budgetId, {
          toDate: addDays(today, OCCURRENCE_HORIZON_DAYS),
        })
      : [];
  return { names, templates, occurrences };
}

/** Budget-currency amount of a template: its next occurrence's, else its latest, else the native amount. */
function templateBudgetAmount(
  template: Template,
  own: ReturnType<Services['recurring']['listOccurrences']>
): number {
  const next = own.find((occurrence) => occurrence.status === 'scheduled');
  const amount = next?.template.budgetAmount ?? own.at(-1)?.template.budgetAmount;
  if (typeof amount === 'number' && Number.isFinite(amount)) return amount;
  // No occurrence to read a rate from: same currency is exact; otherwise 1:1, like core's fallback.
  return template.amount;
}

export function buildScheduledRows(
  context: DerivedTableContext,
  budgetId: number
): { templates: Record<string, unknown>[]; occurrences: Record<string, unknown>[] } {
  const { names, templates, occurrences } = scheduledData(context, budgetId);
  const byTemplate = new Map<number, typeof occurrences>();
  for (const occurrence of occurrences) {
    const list = byTemplate.get(occurrence.recurringTransactionId) ?? [];
    list.push(occurrence);
    byTemplate.set(occurrence.recurringTransactionId, list);
  }
  const templateRows = templates.map((template) => {
    const own = byTemplate.get(template.id) ?? [];
    const budgetAmount = templateBudgetAmount(template, own);
    const fields = templateFields(template, names, budgetAmount);
    const next = own.find((occurrence) => occurrence.status === 'scheduled');
    const { endDate, occurrenceCount } = template.schedule;
    const finished =
      !next &&
      ((endDate !== null && endDate !== undefined && endDate < context.today) ||
        (typeof occurrenceCount === 'number' && own.length >= occurrenceCount));
    const unit = template.schedule.intervalUnit;
    const count = fields.interval_count;
    const signed = template.direction === 'inflow' ? budgetAmount : -budgetAmount;
    return {
      ...fields,
      monthly_amount: units(Math.round(monthlyEquivalent(signed, unit, count))),
      status: !template.active ? 'paused' : finished ? 'ended' : 'active',
      next_date: template.active ? (next?.dueDate ?? null) : null,
      start_date: template.schedule.startDate,
      end_date: endDate ?? null,
    };
  });
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const occurrenceRows = occurrences.flatMap((occurrence) => {
    const template = templateById.get(occurrence.recurringTransactionId);
    if (!template) return [];
    const budgetAmount = occurrence.template.budgetAmount ?? template.amount;
    return [
      {
        ...templateFields(template, names, budgetAmount),
        occurrence_id: occurrence.id,
        due_date: occurrence.dueDate,
        status: occurrence.status,
        transaction_id: occurrence.transactionId,
      },
    ];
  });
  return { templates: templateRows, occurrences: occurrenceRows };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

function perBudget(
  build: (context: DerivedTableContext, budgetId: number) => Record<string, unknown>[]
) {
  return (context: DerivedTableContext) =>
    budgetIds(context.db).flatMap((budgetId) => build(context, budgetId));
}

export const BUDGET_MONTHS_TABLE: DerivedTable = {
  name: 'budget_months',
  columns: BUDGET_MONTHS_COLUMNS,
  build: perBudget(buildBudgetMonthRows),
};

export const SCHEDULED_TRANSACTIONS_TABLE: DerivedTable = {
  name: 'scheduled_transactions',
  columns: SCHEDULED_TRANSACTIONS_COLUMNS,
  build: perBudget((context, budgetId) => buildScheduledRows(context, budgetId).templates),
};

export const SCHEDULED_OCCURRENCES_TABLE: DerivedTable = {
  name: 'scheduled_occurrences',
  columns: SCHEDULED_OCCURRENCES_COLUMNS,
  build: perBudget((context, budgetId) => buildScheduledRows(context, budgetId).occurrences),
};

export const DERIVED_TABLES: readonly DerivedTable[] = [
  BUDGET_MONTHS_TABLE,
  SCHEDULED_TRANSACTIONS_TABLE,
  SCHEDULED_OCCURRENCES_TABLE,
];

/** Derived tables a query names (only those are computed). */
export function derivedTablesIn(query: string): DerivedTable[] {
  return DERIVED_TABLES.filter((table) => new RegExp(`\\b${table.name}\\b`, 'i').test(query));
}
