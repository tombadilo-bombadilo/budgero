import { DatabaseAdapter } from '../../database/interface.js';
import { getRow, allRows, run } from '../../database/sql.js';
import { asMilli, convertAtRate, ZERO_MILLI } from '../../money/index.js';
import { ValidationError, NotFoundError } from '../../types/index.js';
import { safeParseJSON } from '../../utils/json.js';
import { getLocalDateString, getUTCDateString } from '../../utils/date.js';
import { TransactionService } from '../transactions/index.js';
import { ensureTransferCategory } from '../transactions/category-helpers.js';
import { CategoryService } from '../categories/index.js';
import { CurrencyService } from '../currency/index.js';
import type {
  CreateRecurringTransactionInput,
  ListOccurrencesOptions,
  ListProjectedTransactionsOptions,
  MarkOccurrenceReadyOptions,
  MarkOccurrenceReadyResult,
  ProjectedTransactionRow,
  RecurringOccurrence,
  RecurringOccurrenceStatus,
  RecurringOccurrenceWithTemplate,
  RecurringSchedule,
  RecurringTransaction,
  RecurringIntervalUnit,
  UpdateRecurringTransactionInput,
} from './types.js';

interface RecurringTransactionRow {
  ID: number | bigint;
  BudgetID: number | bigint;
  AccountID: number | bigint;
  ToAccountID?: number | bigint | null;
  /** Computed by occurrence queries only, not a real column. */
  DestinationAmount?: number | bigint | null;
  CategoryID: number | bigint | null;
  Name: string;
  Memo: string | null;
  Amount: number;
  Direction: string;
  ScheduleJSON: string;
  NotifyDaysBefore: number | null;
  LastOccurrenceDate: string | null;
  Active: number | boolean;
  CreatedAt: string;
  UpdatedAt: string;
}

interface OccurrenceWithTemplateRow {
  OccurrenceID?: number | bigint;
  ID?: number | bigint;
  OccurrenceRecurringTransactionID?: number | bigint;
  RecurringTransactionID?: number | bigint;
  OccurrenceBudgetID?: number | bigint;
  BudgetID?: number | bigint;
  OccurrenceDueDate?: string;
  DueDate?: string;
  OccurrenceStatus?: string;
  Status?: string;
  OccurrenceTransactionID?: number | bigint | null;
  TransactionID?: number | bigint | null;
  OccurrenceNotifiedAt?: string | null;
  NotifiedAt?: string | null;
  OccurrenceReadyAt?: string | null;
  ReadyAt?: string | null;
  OccurrenceCreatedAt?: string;
  OccurrenceUpdatedAt?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
  TemplateID?: number | bigint;
  TemplateBudgetID?: number | bigint;
  TemplateAccountID?: number | bigint;
  TemplateToAccountID?: number | bigint | null;
  TemplateDestinationAmount?: number | bigint | null;
  TemplateCategoryID?: number | bigint | null;
  TemplateName?: string;
  TemplateMemo?: string | null;
  TemplateAmount?: number;
  TemplateDirection?: string;
  TemplateScheduleJSON?: string;
  TemplateNotifyDaysBefore?: number | null;
  TemplateLastOccurrenceDate?: string | null;
  TemplateActive?: number | boolean;
  TemplateCreatedAt?: string;
  TemplateUpdatedAt?: string;
}

const SUPPORTED_INTERVAL_UNITS: RecurringIntervalUnit[] = ['day', 'week', 'month', 'year'];
/**
 * Added to the negated occurrence ID for the projected destination leg of a
 * recurring transfer, so both legs of one occurrence get distinct synthetic
 * (negative) IDs.
 */
const TRANSFER_LEG_ID_OFFSET = 1_000_000_000;
const DEFAULT_NOTIFY_DAYS = 0;
const DEFAULT_INTERVAL_COUNT = 1;
const DEFAULT_HORIZON_MONTHS = 6;
const BACKFILL_MONTHS = 1;
const MAX_GENERATED_OCCURRENCES = 240;

/**
 * Account-currency → budget-currency rate for a projected occurrence.
 * Falls back to the latest known rate (future months never have rates),
 * then to 1 when no rate exists or the currencies match.
 * Expects aliases: r = recurring_transactions, o = occurrences, a = accounts, b = budgets.
 * Shared with the projected-transactions relation in analytics — drift here
 * silently skews projections.
 */
export const PROJECTION_RATE_SQL = `
  CASE WHEN a.Currency = b.DisplayCurrency THEN 1 ELSE COALESCE((
    SELECT cr.Rate FROM currency_rates cr
    WHERE cr.BudgetID = o.BudgetID
      AND cr.FromCurrency = a.Currency
      AND cr.ToCurrency = b.DisplayCurrency
    ORDER BY cr.Month DESC LIMIT 1
  ), 1) END
`;

/**
 * Account-currency rate from a transfer's source account (alias a) to its
 * destination account (alias a2), for the destination leg's original amount.
 * Same fallback strategy as PROJECTION_RATE_SQL: latest known rate, else 1.
 */
const TRANSFER_LEG_RATE_SQL = `
  CASE WHEN a.Currency = a2.Currency THEN 1 ELSE COALESCE((
    SELECT cr.Rate FROM currency_rates cr
    WHERE cr.BudgetID = o.BudgetID
      AND cr.FromCurrency = a.Currency
      AND cr.ToCurrency = a2.Currency
    ORDER BY cr.Month DESC LIMIT 1
  ), 1) END
`;

const occurrenceColumns = `
  o.ID AS OccurrenceID,
  o.RecurringTransactionID AS OccurrenceRecurringTransactionID,
  o.BudgetID AS OccurrenceBudgetID,
  o.DueDate AS OccurrenceDueDate,
  o.Status AS OccurrenceStatus,
  o.TransactionID AS OccurrenceTransactionID,
  o.NotifiedAt AS OccurrenceNotifiedAt,
  o.ReadyAt AS OccurrenceReadyAt,
  o.CreatedAt AS OccurrenceCreatedAt,
  o.UpdatedAt AS OccurrenceUpdatedAt
`;

const templateColumns = `
  r.ID AS TemplateID,
  r.BudgetID AS TemplateBudgetID,
  r.AccountID AS TemplateAccountID,
  r.ToAccountID AS TemplateToAccountID,
  r.CategoryID AS TemplateCategoryID,
  r.Name AS TemplateName,
  r.Memo AS TemplateMemo,
  r.Amount AS TemplateAmount,
  r.Direction AS TemplateDirection,
  r.ScheduleJSON AS TemplateScheduleJSON,
  r.NotifyDaysBefore AS TemplateNotifyDaysBefore,
  r.LastOccurrenceDate AS TemplateLastOccurrenceDate,
  r.Active AS TemplateActive,
  r.CreatedAt AS TemplateCreatedAt,
  r.UpdatedAt AS TemplateUpdatedAt
`;

function parseDate(value: string, field: string): Date {
  if (!value || typeof value !== 'string') {
    throw new ValidationError(`Missing ${field}`, field);
  }
  // Deliberate UTC anchor: this module does all interval math in UTC and
  // serializes back with getUTCDateString, so the round trip is symmetric.
  // eslint-disable-next-line no-restricted-syntax
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`Invalid ${field}: ${value}`, field);
  }
  return date;
}

function clampIntervalCount(value: number | undefined): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_INTERVAL_COUNT;
  const intValue = Math.trunc(numeric);
  return intValue > 0 ? intValue : DEFAULT_INTERVAL_COUNT;
}

function normalizeSchedule(schedule: RecurringSchedule): RecurringSchedule {
  if (!schedule || typeof schedule !== 'object') {
    throw new ValidationError('Schedule is required', 'schedule');
  }

  const start = parseDate(schedule.startDate, 'schedule.startDate');
  const unit = (schedule.intervalUnit ?? 'month') as RecurringIntervalUnit;
  if (!SUPPORTED_INTERVAL_UNITS.includes(unit)) {
    throw new ValidationError('Unsupported interval unit', 'schedule.intervalUnit');
  }

  const intervalCount = clampIntervalCount(schedule.intervalCount);
  const metadata = { ...(schedule.metadata ?? {}) } as RecurringSchedule['metadata'];
  if (metadata) {
    if (typeof metadata.anchorDay !== 'number') metadata.anchorDay = start.getUTCDate();
    if (typeof metadata.anchorMonth !== 'number') metadata.anchorMonth = start.getUTCMonth();
    if (typeof metadata.weekday !== 'number') metadata.weekday = start.getUTCDay();
    if (unit !== 'week') {
      delete metadata.weekdays;
    } else if (Array.isArray(metadata.weekdays) && metadata.weekdays.length > 1) {
      metadata.weekdays = metadata.weekdays.slice(0, 1);
    }
  }

  const normalized: RecurringSchedule = {
    startDate: getUTCDateString(start),
    intervalUnit: unit,
    intervalCount,
    metadata,
  };

  if (schedule.endDate) {
    normalized.endDate = getUTCDateString(parseDate(schedule.endDate, 'schedule.endDate'));
  } else {
    normalized.endDate = null;
  }

  return normalized;
}

function addInterval(date: Date, schedule: RecurringSchedule): Date {
  const count = clampIntervalCount(schedule.intervalCount);
  switch (schedule.intervalUnit) {
    case 'day': {
      const result = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + count)
      );
      return result;
    }
    case 'week': {
      const result = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + count * 7)
      );
      return result;
    }
    case 'month': {
      const anchorDay = schedule.metadata?.anchorDay ?? date.getUTCDate();
      const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
      result.setUTCMonth(result.getUTCMonth() + count);
      const daysInMonth = new Date(
        Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)
      ).getUTCDate();
      result.setUTCDate(Math.min(anchorDay, daysInMonth));
      return result;
    }
    case 'year': {
      const anchorDay = schedule.metadata?.anchorDay ?? date.getUTCDate();
      const anchorMonth = schedule.metadata?.anchorMonth ?? date.getUTCMonth();
      const result = new Date(Date.UTC(date.getUTCFullYear(), anchorMonth, 1));
      result.setUTCFullYear(result.getUTCFullYear() + count);
      const daysInMonth = new Date(
        Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)
      ).getUTCDate();
      result.setUTCDate(Math.min(anchorDay, daysInMonth));
      return result;
    }
    default:
      throw new ValidationError('Unsupported interval unit', 'schedule.intervalUnit');
  }
}

function generateTransferId(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `rt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function computeHorizonDate(monthsAhead: number = DEFAULT_HORIZON_MONTHS): Date {
  const today = new Date();
  const result = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  result.setUTCMonth(result.getUTCMonth() + monthsAhead);
  // Move to end of month for generous coverage
  const daysInMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)
  ).getUTCDate();
  result.setUTCDate(daysInMonth);
  return result;
}

function backfillThreshold(monthsBack: number = BACKFILL_MONTHS): Date {
  const today = new Date();
  return new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - monthsBack * 30)
  );
}

export class RecurringTransactionService {
  private transactions: TransactionService;

  private categories: CategoryService;

  private currency: CurrencyService;

  constructor(private db: DatabaseAdapter) {
    this.transactions = new TransactionService(db);
    this.categories = new CategoryService(db);
    this.currency = new CurrencyService(db);
  }

  /**
   * Transfer templates always store direction 'outflow' (money leaves
   * accountId) and the auto-managed "Transfers" category, so projections and
   * analytics treat them exactly like posted transfer legs.
   */
  private normalizeTransferFields(
    budgetId: number,
    accountId: number,
    toAccountId: number | null
  ): { direction: 'outflow'; categoryId: number } | null {
    if (toAccountId == null) return null;
    if (toAccountId === accountId) {
      throw new ValidationError(
        'Transfer destination must differ from the source account',
        'toAccountId'
      );
    }
    return {
      direction: 'outflow',
      categoryId: ensureTransferCategory(this.categories, budgetId),
    };
  }

  listRecurringTransactions(budgetId: number, includeInactive = false): RecurringTransaction[] {
    const rows = allRows<RecurringTransactionRow>(
      this.db,
      `SELECT * FROM recurring_transactions WHERE BudgetID = ? ${includeInactive ? '' : 'AND Active = 1'} ORDER BY Name ASC`,
      budgetId
    );
    return rows.map((row) => this.mapTemplateRow(row));
  }

  getRecurringTransaction(id: number, opts?: { includeInactive?: boolean }): RecurringTransaction {
    const row = getRow<RecurringTransactionRow>(
      this.db,
      `SELECT * FROM recurring_transactions WHERE ID = ?`,
      id
    );
    if (!row) throw new NotFoundError('RecurringTransaction', id);
    if (opts?.includeInactive !== true && !row.Active) {
      throw new NotFoundError('RecurringTransaction', id);
    }
    return this.mapTemplateRow(row);
  }

  async createRecurringTransaction(
    input: CreateRecurringTransactionInput
  ): Promise<RecurringTransaction> {
    const schedule = normalizeSchedule(input.schedule);
    const notifyDaysBefore = Math.max(0, Math.trunc(input.notifyDaysBefore ?? DEFAULT_NOTIFY_DAYS));
    const memo = input.memo?.trim() ?? '';
    const active = input.active ?? true;
    const toAccountId = input.toAccountId ?? null;
    const transferFields = this.normalizeTransferFields(
      input.budgetId,
      input.accountId,
      toAccountId
    );

    const result = run(
      this.db,
      `
      INSERT INTO recurring_transactions (
        BudgetID,
        AccountID,
        ToAccountID,
        CategoryID,
        Name,
        Memo,
        Amount,
        Direction,
        ScheduleJSON,
        NotifyDaysBefore,
        Active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      input.budgetId,
      input.accountId,
      toAccountId,
      transferFields ? transferFields.categoryId : (input.categoryId ?? null),
      input.name,
      memo,
      input.amount,
      transferFields ? transferFields.direction : input.direction,
      JSON.stringify(schedule),
      notifyDaysBefore,
      active ? 1 : 0
    );

    const id = Number(result.lastInsertRowid);
    const template = this.getRecurringTransaction(id, { includeInactive: true });
    if (template.active) {
      this.ensureOccurrencesForTemplate(template, computeHorizonDate());
    }
    return this.getRecurringTransaction(id, { includeInactive: true });
  }

  async updateRecurringTransaction(
    id: number,
    patch: UpdateRecurringTransactionInput
  ): Promise<RecurringTransaction> {
    const existing = this.getRecurringTransaction(id, { includeInactive: true });
    const effectiveAccountId = patch.accountId !== undefined ? patch.accountId : existing.accountId;
    const effectiveToAccountId =
      patch.toAccountId !== undefined ? (patch.toAccountId ?? null) : existing.toAccountId;
    const transferFields = this.normalizeTransferFields(
      existing.budgetId,
      effectiveAccountId,
      effectiveToAccountId
    );

    const fields: string[] = [];
    const params: (string | number | null)[] = [];

    if (patch.accountId !== undefined) {
      fields.push('AccountID = ?');
      params.push(patch.accountId);
    }
    if (patch.toAccountId !== undefined) {
      fields.push('ToAccountID = ?');
      params.push(patch.toAccountId ?? null);
    }
    if (transferFields) {
      // Transfers pin direction and category; ignore whatever the patch says.
      fields.push('Direction = ?');
      params.push(transferFields.direction);
      fields.push('CategoryID = ?');
      params.push(transferFields.categoryId);
    } else {
      if (patch.categoryId !== undefined) {
        fields.push('CategoryID = ?');
        params.push(patch.categoryId);
      }
      if (patch.direction !== undefined) {
        fields.push('Direction = ?');
        params.push(patch.direction);
      }
    }
    if (patch.name !== undefined) {
      fields.push('Name = ?');
      params.push(patch.name);
    }
    if (patch.memo !== undefined) {
      fields.push('Memo = ?');
      params.push(patch.memo?.trim() ?? '');
    }
    if (patch.amount !== undefined) {
      fields.push('Amount = ?');
      params.push(patch.amount);
    }
    if (patch.schedule) {
      const normalized = normalizeSchedule(patch.schedule as RecurringSchedule);
      fields.push('ScheduleJSON = ?');
      params.push(JSON.stringify(normalized));
    }
    if (patch.notifyDaysBefore !== undefined) {
      fields.push('NotifyDaysBefore = ?');
      params.push(Math.max(0, Math.trunc(patch.notifyDaysBefore)));
    }
    if (patch.active !== undefined) {
      fields.push('Active = ?');
      params.push(patch.active ? 1 : 0);
    }

    if (!fields.length) {
      return this.getRecurringTransaction(id, { includeInactive: true });
    }

    fields.push("UpdatedAt = datetime('now')");

    const result = run(
      this.db,
      `UPDATE recurring_transactions SET ${fields.join(', ')} WHERE ID = ?`,
      ...params,
      id
    );
    if (!result.changes) {
      throw new NotFoundError('RecurringTransaction', id);
    }

    const updated = this.getRecurringTransaction(id, { includeInactive: true });
    if (updated.active) {
      this.ensureOccurrencesForTemplate(updated, computeHorizonDate());
    }
    return updated;
  }

  async deleteRecurringTransaction(id: number): Promise<void> {
    const result = run(this.db, 'DELETE FROM recurring_transactions WHERE ID = ?', id);
    if (!result.changes) {
      throw new NotFoundError('RecurringTransaction', id);
    }
  }

  /**
   * Materializes occurrences for every active template up to at least the
   * given date. Used by surfaces that look further into the future than the
   * default horizon (e.g. reporting with a future date range).
   */
  ensureOccurrencesThrough(budgetId: number, toDate: string): void {
    const requested = parseDate(toDate, 'toDate');
    const fallback = computeHorizonDate();
    this.ensureUpcomingOccurrencesForBudget(budgetId, requested > fallback ? requested : fallback);
  }

  listOccurrences(
    budgetId: number,
    options: ListOccurrencesOptions = {}
  ): RecurringOccurrenceWithTemplate[] {
    const horizon = computeHorizonDate();
    const requested = options.toDate ? parseDate(options.toDate, 'toDate') : null;
    this.ensureUpcomingOccurrencesForBudget(
      budgetId,
      requested && requested > horizon ? requested : horizon
    );

    const clauses: string[] = [];
    const params: (string | number)[] = [budgetId];

    if (options.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status];
      clauses.push(`o.Status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }

    if (options.fromDate) {
      clauses.push('o.DueDate >= ?');
      params.push(getUTCDateString(parseDate(options.fromDate, 'fromDate')));
    }

    if (options.toDate) {
      clauses.push('o.DueDate <= ?');
      params.push(getUTCDateString(parseDate(options.toDate, 'toDate')));
    }

    if (options.accountId) {
      // Transfers concern both of their accounts, mirroring how a manual
      // future-dated transfer has one leg in each account.
      clauses.push('(r.AccountID = ? OR r.ToAccountID = ?)');
      params.push(options.accountId, options.accountId);
    }

    const whereClause = clauses.length ? `AND ${clauses.join(' AND ')}` : '';

    const rows = allRows<OccurrenceWithTemplateRow>(
      this.db,
      `SELECT ${occurrenceColumns}, ${templateColumns},
         CASE WHEN r.ToAccountID IS NULL THEN NULL
           ELSE CAST(ROUND(r.Amount * ${TRANSFER_LEG_RATE_SQL}) AS INTEGER)
         END AS TemplateDestinationAmount
       FROM recurring_transaction_occurrences o
       JOIN recurring_transactions r ON r.ID = o.RecurringTransactionID
       JOIN accounts a ON a.ID = r.AccountID
       LEFT JOIN accounts a2 ON a2.ID = r.ToAccountID
       WHERE o.BudgetID = ? ${whereClause}
       ORDER BY o.DueDate ASC, o.ID ASC`,
      ...params
    );
    return rows.map((row) => this.mapOccurrenceWithTemplate(row));
  }

  /**
   * Returns scheduled (not ready, not skipped) occurrences of active templates
   * projected into a transaction-like shape. Budget-currency amounts use the
   * latest known exchange rate; future months never have rates of their own.
   */
  listProjectedTransactions(
    budgetId: number,
    options: ListProjectedTransactionsOptions = {}
  ): ProjectedTransactionRow[] {
    const horizon = computeHorizonDate();
    const requested = options.toDate ? parseDate(options.toDate, 'toDate') : null;
    this.ensureUpcomingOccurrencesForBudget(
      budgetId,
      requested && requested > horizon ? requested : horizon
    );

    const dateClauses: string[] = [];
    const dateParams: (string | number)[] = [];

    if (options.fromDate) {
      dateClauses.push('o.DueDate >= ?');
      dateParams.push(getUTCDateString(parseDate(options.fromDate, 'fromDate')));
    }
    if (options.toDate) {
      dateClauses.push('o.DueDate <= ?');
      dateParams.push(getUTCDateString(parseDate(options.toDate, 'toDate')));
    }

    const dateWhere = dateClauses.length ? `AND ${dateClauses.join(' AND ')}` : '';
    const sourceAccountWhere = options.accountId ? 'AND r.AccountID = ?' : '';
    const destAccountWhere = options.accountId ? 'AND r.ToAccountID = ?' : '';
    const armParams = (): (string | number)[] => [
      budgetId,
      ...dateParams,
      ...(options.accountId ? [options.accountId] : []),
    ];

    // Transfer templates project twice: the outflow on the source account
    // (first arm — Direction is always 'outflow' for transfers) and the
    // mirrored inflow on the destination account (second arm). The inflow
    // leg's synthetic ID is offset so the two legs of one occurrence never
    // collide.
    const rows = allRows<Omit<ProjectedTransactionRow, 'IsProjected'>>(
      this.db,
      `SELECT
         -o.ID AS ID,
         o.ID AS OccurrenceID,
         r.ID AS RecurringTransactionID,
         r.AccountID AS AccountID,
         a.Name AS Account,
         o.BudgetID AS BudgetID,
         r.CategoryID AS CategoryID,
         c.Name AS Category,
         o.DueDate AS Date,
         COALESCE(NULLIF(r.Memo, ''), r.Name) AS Memo,
         r.Name AS Payee,
         CASE WHEN r.Direction = 'inflow'
           THEN CAST(ROUND(r.Amount * ${PROJECTION_RATE_SQL}) AS INTEGER) ELSE 0 END AS Inflow,
         CASE WHEN r.Direction = 'outflow'
           THEN CAST(ROUND(r.Amount * ${PROJECTION_RATE_SQL}) AS INTEGER) ELSE 0 END AS Outflow,
         CASE WHEN r.Direction = 'inflow' THEN r.Amount ELSE 0 END AS InflowOriginal,
         CASE WHEN r.Direction = 'outflow' THEN r.Amount ELSE 0 END AS OutflowOriginal
       FROM recurring_transaction_occurrences o
       JOIN recurring_transactions r ON r.ID = o.RecurringTransactionID
       JOIN accounts a ON a.ID = r.AccountID
       JOIN budgets b ON b.ID = o.BudgetID
       LEFT JOIN categories c ON c.ID = r.CategoryID
       WHERE o.BudgetID = ? AND o.Status = 'scheduled' AND r.Active = 1 ${dateWhere} ${sourceAccountWhere}
       UNION ALL
       SELECT
         -(o.ID + ${TRANSFER_LEG_ID_OFFSET}) AS ID,
         o.ID AS OccurrenceID,
         r.ID AS RecurringTransactionID,
         r.ToAccountID AS AccountID,
         a2.Name AS Account,
         o.BudgetID AS BudgetID,
         r.CategoryID AS CategoryID,
         c.Name AS Category,
         o.DueDate AS Date,
         COALESCE(NULLIF(r.Memo, ''), r.Name) AS Memo,
         r.Name AS Payee,
         CAST(ROUND(r.Amount * ${PROJECTION_RATE_SQL}) AS INTEGER) AS Inflow,
         0 AS Outflow,
         CAST(ROUND(r.Amount * ${TRANSFER_LEG_RATE_SQL}) AS INTEGER) AS InflowOriginal,
         0 AS OutflowOriginal
       FROM recurring_transaction_occurrences o
       JOIN recurring_transactions r ON r.ID = o.RecurringTransactionID
       JOIN accounts a ON a.ID = r.AccountID
       JOIN accounts a2 ON a2.ID = r.ToAccountID
       JOIN budgets b ON b.ID = o.BudgetID
       LEFT JOIN categories c ON c.ID = r.CategoryID
       WHERE o.BudgetID = ? AND o.Status = 'scheduled' AND r.Active = 1
         AND r.ToAccountID IS NOT NULL ${dateWhere} ${destAccountWhere}
       ORDER BY Date ASC, OccurrenceID ASC, ID DESC`,
      ...armParams(),
      ...armParams()
    );
    return rows.map((row) => ({
      ...row,
      ID: Number(row.ID),
      OccurrenceID: Number(row.OccurrenceID),
      RecurringTransactionID: Number(row.RecurringTransactionID),
      AccountID: Number(row.AccountID),
      BudgetID: Number(row.BudgetID),
      CategoryID:
        row.CategoryID !== null && row.CategoryID !== undefined ? Number(row.CategoryID) : null,
      IsProjected: true as const,
    }));
  }

  getOccurrenceWithTemplate(occurrenceId: number): RecurringOccurrenceWithTemplate {
    const row = getRow<OccurrenceWithTemplateRow>(
      this.db,
      `SELECT ${occurrenceColumns}, ${templateColumns}
       FROM recurring_transaction_occurrences o
       JOIN recurring_transactions r ON r.ID = o.RecurringTransactionID
       WHERE o.ID = ?`,
      occurrenceId
    );
    if (!row) {
      throw new NotFoundError('RecurringTransactionOccurrence', occurrenceId);
    }
    return this.mapOccurrenceWithTemplate(row);
  }

  async markOccurrenceReady(
    options: MarkOccurrenceReadyOptions
  ): Promise<MarkOccurrenceReadyResult> {
    const occurrence = this.getOccurrenceWithTemplate(options.occurrenceId);
    if (occurrence.status !== 'scheduled') {
      throw new ValidationError('Occurrence is not in scheduled state', 'status');
    }
    if (!occurrence.template.active) {
      throw new ValidationError('Recurring transaction is inactive', 'active');
    }
    const { template } = occurrence;
    if (template.toAccountId == null && template.categoryId == null) {
      throw new ValidationError(
        'Recurring transactions must specify a category before marking ready',
        'categoryId'
      );
    }

    const transactionDate = options.transactionDate
      ? getUTCDateString(parseDate(options.transactionDate, 'transactionDate'))
      : occurrence.dueDate;
    const memo = options.memoOverride?.trim() || template.memo || template.name;

    let transactionId: number;
    if (template.toAccountId != null) {
      transactionId = await this.postTransferLegs(template, transactionDate, memo);
    } else {
      const inflow = template.direction === 'inflow' ? template.amount : ZERO_MILLI;
      const outflow = template.direction === 'outflow' ? template.amount : ZERO_MILLI;

      transactionId = await this.transactions.addTransaction(
        inflow,
        outflow,
        template.accountId,
        template.categoryId ?? 0,
        template.budgetId,
        transactionDate,
        memo,
        ''
      );
    }

    run(
      this.db,
      `UPDATE recurring_transaction_occurrences
         SET Status = 'ready',
             TransactionID = ?,
             ReadyAt = datetime('now'),
             UpdatedAt = datetime('now')
       WHERE ID = ?`,
      transactionId,
      options.occurrenceId
    );

    run(
      this.db,
      `UPDATE recurring_transactions
         SET LastOccurrenceDate = ?, UpdatedAt = datetime('now')
       WHERE ID = ?`,
      occurrence.dueDate,
      template.id
    );

    this.ensureOccurrencesForTemplate(
      this.getRecurringTransaction(template.id, { includeInactive: true }),
      computeHorizonDate()
    );

    return {
      occurrence: this.getOccurrenceWithTemplate(options.occurrenceId),
      transactionId,
    };
  }

  /**
   * Posts the two legs of a recurring transfer sharing one TransferID —
   * the same shape the manual add-transaction transfer flow produces.
   * Returns the source-leg transaction id (deleting it removes both legs,
   * which keeps the markReady undo path working unchanged).
   */
  private async postTransferLegs(
    template: RecurringTransaction,
    transactionDate: string,
    memo: string
  ): Promise<number> {
    const accountRow = (id: number) =>
      getRow<{ ID: number; Name: string; Currency: string }>(
        this.db,
        'SELECT ID, Name, Currency FROM accounts WHERE ID = ?',
        id
      );
    const source = accountRow(template.accountId);
    const destination = accountRow(template.toAccountId as number);
    if (!destination) {
      throw new ValidationError('Transfer destination account no longer exists', 'toAccountId');
    }

    let destinationAmount = template.amount;
    if (source && source.Currency !== destination.Currency) {
      const rate = await this.currency.resolveRate(
        source.Currency,
        destination.Currency,
        transactionDate,
        transactionDate.substring(0, 7),
        template.budgetId
      );
      destinationAmount = convertAtRate(template.amount, rate || 1);
    }

    const transferId = generateTransferId();
    const sourceTransactionId = await this.transactions.addTransaction(
      ZERO_MILLI,
      template.amount,
      template.accountId,
      template.categoryId ?? 0,
      template.budgetId,
      transactionDate,
      memo,
      transferId,
      destination.Name
    );
    try {
      await this.transactions.addTransaction(
        destinationAmount,
        ZERO_MILLI,
        destination.ID,
        0,
        template.budgetId,
        transactionDate,
        memo,
        transferId,
        source?.Name
      );
    } catch (error) {
      // The legs can't share one DB transaction (each addTransaction opens
      // its own), so compensate: never leave a one-sided transfer behind.
      // The occurrence is still 'scheduled' at this point, so retry is safe.
      this.transactions.deleteTransaction(sourceTransactionId);
      throw error;
    }
    return sourceTransactionId;
  }

  async skipOccurrence(occurrenceId: number): Promise<RecurringOccurrenceWithTemplate> {
    this.getOccurrenceWithTemplate(occurrenceId);
    const result = run(
      this.db,
      `UPDATE recurring_transaction_occurrences
         SET Status = 'skipped',
             UpdatedAt = datetime('now')
       WHERE ID = ? AND Status = 'scheduled'`,
      occurrenceId
    );
    if (!result.changes) {
      throw new ValidationError('Occurrence cannot be skipped from current state', 'status');
    }
    return this.getOccurrenceWithTemplate(occurrenceId);
  }

  async markOccurrenceNotified(occurrenceId: number): Promise<RecurringOccurrenceWithTemplate> {
    const result = run(
      this.db,
      `UPDATE recurring_transaction_occurrences
         SET NotifiedAt = datetime('now'),
             UpdatedAt = datetime('now')
       WHERE ID = ?`,
      occurrenceId
    );
    if (!result.changes) {
      throw new NotFoundError('RecurringTransactionOccurrence', occurrenceId);
    }
    return this.getOccurrenceWithTemplate(occurrenceId);
  }

  resetOccurrence(occurrenceId: number): RecurringOccurrenceWithTemplate {
    const occurrence = this.getOccurrenceWithTemplate(occurrenceId);

    run(
      this.db,
      `UPDATE recurring_transaction_occurrences
         SET Status = 'scheduled',
             TransactionID = NULL,
             ReadyAt = NULL,
             NotifiedAt = NULL,
             UpdatedAt = datetime('now')
       WHERE ID = ?`,
      occurrenceId
    );

    run(
      this.db,
      `UPDATE recurring_transactions
         SET LastOccurrenceDate = (
           SELECT MAX(DueDate)
           FROM recurring_transaction_occurrences
           WHERE RecurringTransactionID = ? AND Status = 'ready'
         ),
             UpdatedAt = datetime('now')
       WHERE ID = ?`,
      occurrence.recurringTransactionId,
      occurrence.recurringTransactionId
    );

    return this.getOccurrenceWithTemplate(occurrenceId);
  }

  listNotificationCandidates(
    referenceDate: string,
    budgetId?: number
  ): RecurringOccurrenceWithTemplate[] {
    const targetDate = getUTCDateString(parseDate(referenceDate, 'referenceDate'));
    const params: (string | number)[] = [targetDate, targetDate];
    let budgetClause = '';
    if (budgetId) {
      budgetClause = 'AND o.BudgetID = ?';
      params.push(budgetId);
      this.ensureUpcomingOccurrencesForBudget(budgetId, computeHorizonDate());
    }

    const rows = allRows<OccurrenceWithTemplateRow>(
      this.db,
      `SELECT ${occurrenceColumns}, ${templateColumns}
       FROM recurring_transaction_occurrences o
       JOIN recurring_transactions r ON r.ID = o.RecurringTransactionID
       WHERE o.Status = 'scheduled'
         AND r.Active = 1
         AND (o.NotifiedAt IS NULL OR o.NotifiedAt = '')
         AND date(o.DueDate, '-' || COALESCE(r.NotifyDaysBefore, 0) || ' day') <= ?
         AND o.DueDate >= date(?, '-${BACKFILL_MONTHS} month')
         ${budgetClause}
       ORDER BY o.DueDate ASC`,
      ...params
    );
    return rows.map((row) => this.mapOccurrenceWithTemplate(row));
  }

  private ensureUpcomingOccurrencesForBudget(budgetId: number, horizon: Date): void {
    const rows = allRows<RecurringTransactionRow>(
      this.db,
      'SELECT * FROM recurring_transactions WHERE BudgetID = ? AND Active = 1',
      budgetId
    );
    for (const row of rows) {
      const template = this.mapTemplateRow(row);
      this.ensureOccurrencesForTemplate(template, horizon);
    }
  }

  private ensureOccurrencesForTemplate(template: RecurringTransaction, horizon: Date): void {
    if (!template.active) return;

    const { schedule } = template;
    let nextDate: Date;
    const endDate = schedule.endDate ? parseDate(schedule.endDate, 'schedule.endDate') : null;

    const lastRow = getRow<{ DueDate?: string }>(
      this.db,
      `SELECT DueDate FROM recurring_transaction_occurrences WHERE RecurringTransactionID = ? ORDER BY DueDate DESC LIMIT 1`,
      template.id
    );

    if (lastRow?.DueDate) {
      const lastDate = parseDate(lastRow.DueDate, 'occurrence.DueDate');
      nextDate = addInterval(lastDate, schedule);
    } else {
      nextDate = parseDate(schedule.startDate, 'schedule.startDate');
    }

    const threshold = backfillThreshold();
    let iterations = 0;

    // Fast-forward to avoid generating deep history
    while (nextDate < threshold) {
      const candidate = addInterval(nextDate, schedule);
      if (candidate.getTime() === nextDate.getTime()) break;
      nextDate = candidate;
      iterations += 1;
      if (endDate && nextDate > endDate) {
        return;
      }
      if (iterations > MAX_GENERATED_OCCURRENCES) {
        return;
      }
    }

    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO recurring_transaction_occurrences (
        RecurringTransactionID,
        BudgetID,
        DueDate,
        Status
      ) VALUES (?, ?, ?, 'scheduled')`
    );

    while (iterations < MAX_GENERATED_OCCURRENCES) {
      if (endDate && nextDate > endDate) {
        break;
      }
      if (nextDate > horizon) {
        break;
      }
      insert.run(template.id, template.budgetId, getUTCDateString(nextDate));
      const candidate = addInterval(nextDate, schedule);
      if (candidate.getTime() === nextDate.getTime()) {
        break;
      }
      nextDate = candidate;
      iterations += 1;
    }

    insert.finalize();

    const newest = getRow<{ DueDate?: string }>(
      this.db,
      `SELECT DueDate FROM recurring_transaction_occurrences WHERE RecurringTransactionID = ? ORDER BY DueDate DESC LIMIT 1`,
      template.id
    );

    run(
      this.db,
      `UPDATE recurring_transactions
         SET LastOccurrenceDate = ?, UpdatedAt = CASE WHEN UpdatedAt IS NULL THEN datetime('now') ELSE UpdatedAt END
       WHERE ID = ?`,
      newest?.DueDate ?? null,
      template.id
    );
  }

  private mapTemplateRow(row: RecurringTransactionRow): RecurringTransaction {
    const schedule = safeParseJSON<RecurringSchedule>(row.ScheduleJSON, {
      startDate: getLocalDateString(new Date()),
      intervalUnit: 'month',
      intervalCount: DEFAULT_INTERVAL_COUNT,
    });
    return {
      id: Number(row.ID),
      budgetId: Number(row.BudgetID),
      accountId: Number(row.AccountID),
      toAccountId:
        row.ToAccountID !== null && row.ToAccountID !== undefined ? Number(row.ToAccountID) : null,
      destinationAmount:
        row.DestinationAmount !== null && row.DestinationAmount !== undefined
          ? asMilli(Number(row.DestinationAmount))
          : null,
      categoryId:
        row.CategoryID !== null && row.CategoryID !== undefined ? Number(row.CategoryID) : null,
      name: row.Name,
      memo: row.Memo ?? '',
      amount: asMilli(Number(row.Amount)),
      direction: row.Direction as RecurringTransaction['direction'],
      schedule: normalizeSchedule(schedule),
      notifyDaysBefore: Number(row.NotifyDaysBefore ?? DEFAULT_NOTIFY_DAYS),
      lastOccurrenceDate: row.LastOccurrenceDate ?? null,
      active: Boolean(row.Active),
      createdAt: row.CreatedAt,
      updatedAt: row.UpdatedAt,
    };
  }

  private mapOccurrenceRow(row: OccurrenceWithTemplateRow): RecurringOccurrence {
    return {
      id: Number(row.OccurrenceID ?? row.ID),
      recurringTransactionId: Number(
        row.OccurrenceRecurringTransactionID ?? row.RecurringTransactionID
      ),
      budgetId: Number(row.OccurrenceBudgetID ?? row.BudgetID),
      dueDate: (row.OccurrenceDueDate ?? row.DueDate) as string,
      status: (row.OccurrenceStatus ?? row.Status) as RecurringOccurrenceStatus,
      transactionId:
        row.OccurrenceTransactionID !== undefined && row.OccurrenceTransactionID !== null
          ? Number(row.OccurrenceTransactionID)
          : row.TransactionID !== undefined && row.TransactionID !== null
            ? Number(row.TransactionID)
            : null,
      notifiedAt: row.OccurrenceNotifiedAt ?? row.NotifiedAt ?? null,
      readyAt: row.OccurrenceReadyAt ?? row.ReadyAt ?? null,
      createdAt: (row.OccurrenceCreatedAt ?? row.CreatedAt) as string,
      updatedAt: (row.OccurrenceUpdatedAt ?? row.UpdatedAt) as string,
    };
  }

  private mapOccurrenceWithTemplate(
    row: OccurrenceWithTemplateRow
  ): RecurringOccurrenceWithTemplate {
    const occurrence = this.mapOccurrenceRow(row);
    const templateRow: RecurringTransactionRow = {
      ID: row.TemplateID as number | bigint,
      BudgetID: row.TemplateBudgetID as number | bigint,
      AccountID: row.TemplateAccountID as number | bigint,
      ToAccountID: row.TemplateToAccountID ?? null,
      DestinationAmount: row.TemplateDestinationAmount ?? null,
      CategoryID: row.TemplateCategoryID ?? null,
      Name: row.TemplateName as string,
      Memo: row.TemplateMemo ?? null,
      Amount: row.TemplateAmount as number,
      Direction: row.TemplateDirection as string,
      ScheduleJSON: row.TemplateScheduleJSON as string,
      NotifyDaysBefore: row.TemplateNotifyDaysBefore ?? null,
      LastOccurrenceDate: row.TemplateLastOccurrenceDate ?? null,
      Active: row.TemplateActive as number | boolean,
      CreatedAt: row.TemplateCreatedAt as string,
      UpdatedAt: row.TemplateUpdatedAt as string,
    };
    return {
      ...occurrence,
      template: this.mapTemplateRow(templateRow),
    };
  }
}
