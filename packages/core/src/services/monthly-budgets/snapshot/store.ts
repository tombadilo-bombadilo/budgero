/**
 * Budget snapshot store: per-budget, per-month grouped sums kept in memory
 * (never synced or persisted), loaded lazily on the first budget read and kept
 * current by SQLite TEMP triggers that call a JS function on every relevant
 * write (any code path, FK cascades included).
 *
 * Safety rules:
 * - No hooks (adapter without createFunction / addConnectionListener, install
 *   failure, triggers found missing) -> callers get `null` and use the full
 *   queries. Triggers found missing on a read also drop every snapshot.
 * - sql.js export() re-opens the connection and drops TEMP triggers and
 *   functions: the adapters call the 'export' listener synchronously right
 *   after it and the hooks are re-installed before any other statement runs.
 *   'replace' (restore, replaceDatabase) drops every snapshot first.
 * - Inside an explicit transaction the snapshot is never used, loaded or
 *   refreshed (a rollback reverts rows without firing triggers); writes still
 *   mark months dirty, so the next read outside re-reads them.
 * - Rows whose month the snapshot can't index (malformed Date / Month) make
 *   that budget fall back to the full queries.
 */
import type { DatabaseAdapter, SqlFunctionValue } from '../../../database/interface.js';
import { allRows, getRow } from '../../../database/sql.js';
import { NO_SPLITS_FILTER } from '../../transactions/queries.js';
import { createLogger } from '../../../logger.js';
import {
  addCreditLine,
  emptyTxMonth,
  foldMonthly,
  isEmptyTxMonth,
  toMonthIndex,
  type BudgetData,
  type CategoryKey,
  type MonthlyFold,
  type TxMonth,
} from './model.js';

const debugLog = createLogger('services:monthly-budgets:snapshot');

// ---------------------------------------------------------------- options

export interface BudgetSnapshotOptions {
  /** Read through the snapshot when hooks are healthy (default on; BUDGERO_SNAPSHOT=0 turns it off). */
  enabled: boolean;
  /** Recompute every read fully too and throw on any difference (BUDGERO_SNAPSHOT_VERIFY=1). */
  verify: boolean;
}

const overrides: Partial<BudgetSnapshotOptions> = {};

function env(name: string): string | undefined {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    return proc?.env?.[name];
  } catch {
    return undefined;
  }
}

export function getBudgetSnapshotOptions(): BudgetSnapshotOptions {
  return {
    enabled: overrides.enabled ?? env('BUDGERO_SNAPSHOT') !== '0',
    verify: overrides.verify ?? env('BUDGERO_SNAPSHOT_VERIFY') === '1',
  };
}

/** Overrides the env-derived options (pass `undefined` for a key to go back to the env). */
export function configureBudgetSnapshot(patch: Partial<BudgetSnapshotOptions>): void {
  for (const key of ['enabled', 'verify'] as const) {
    if (key in patch) {
      if (patch[key] === undefined) delete overrides[key];
      else overrides[key] = patch[key];
    }
  }
}

// ---------------------------------------------------------------- triggers

const FN = 'budgero_snapshot_dirty';
const KIND_TX = 1;
const KIND_ASSIGNMENT = 2;
const KIND_META = 3;
const KIND_ALL = 4;

const partnerLegs = (row: 'NEW' | 'OLD') =>
  `SELECT ${FN}(${KIND_TX}, p.BudgetID, p.Month, 1) FROM main.transactions p
     WHERE p.TransferID = ${row}.TransferID AND p.TransferID != '' AND p.ID != ${row}.ID;`;
const txRow = (row: 'NEW' | 'OLD') =>
  `SELECT ${FN}(${KIND_TX}, ${row}.BudgetID, ${row}.Month, DATE(${row}.Date) IS NOT NULL);`;
const parentOf = (row: 'NEW' | 'OLD') =>
  `SELECT ${FN}(${KIND_TX}, t.BudgetID, t.Month, 1) FROM main.transactions t WHERE t.ID = ${row}.TransactionID;`;
const changed = (cols: string[]) => cols.map((c) => `OLD.${c} IS NOT NEW.${c}`).join(' OR ');

const TX_COLUMNS = [
  'CategoryID',
  'AccountID',
  'Date',
  'InflowConverted',
  'OutflowConverted',
  'TransferID',
  'ExcludeFromReadyToAssign',
  'BudgetID',
];
const SPLIT_COLUMNS = [
  'TransactionID',
  'CategoryID',
  'InflowConverted',
  'OutflowConverted',
  'OrderIndex',
];
const ASSIGNMENT_COLUMNS = ['CategoryID', 'Amount', 'Month', 'BudgetID'];
const ACCOUNT_COLUMNS = ['ID', 'OnBudget', 'Type', 'Metadata', 'BudgetID', 'Currency'];
const CATEGORY_COLUMNS = ['ID', 'CategoryGroupID', 'BudgetID', 'Name'];
const GROUP_COLUMNS = ['ID', 'Name', 'BudgetID'];

const TRIGGERS: [name: string, sql: string][] = [
  ['tx_ins', `AFTER INSERT ON main.transactions BEGIN ${txRow('NEW')} ${partnerLegs('NEW')} END`],
  ['tx_del', `AFTER DELETE ON main.transactions BEGIN ${txRow('OLD')} ${partnerLegs('OLD')} END`],
  [
    'tx_upd',
    `AFTER UPDATE OF ${TX_COLUMNS.join(', ')} ON main.transactions BEGIN
       ${txRow('OLD')} ${txRow('NEW')} ${partnerLegs('OLD')} ${partnerLegs('NEW')} END`,
  ],
  ['split_ins', `AFTER INSERT ON main.transaction_splits BEGIN ${parentOf('NEW')} END`],
  ['split_del', `AFTER DELETE ON main.transaction_splits BEGIN ${parentOf('OLD')} END`],
  [
    'split_upd',
    `AFTER UPDATE OF ${SPLIT_COLUMNS.join(', ')} ON main.transaction_splits BEGIN
       ${parentOf('OLD')} ${parentOf('NEW')} END`,
  ],
  [
    'asg_ins',
    `AFTER INSERT ON main.assignments BEGIN SELECT ${FN}(${KIND_ASSIGNMENT}, NEW.BudgetID, NEW.Month, 1); END`,
  ],
  [
    'asg_del',
    `AFTER DELETE ON main.assignments BEGIN SELECT ${FN}(${KIND_ASSIGNMENT}, OLD.BudgetID, OLD.Month, 1); END`,
  ],
  [
    'asg_upd',
    `AFTER UPDATE OF ${ASSIGNMENT_COLUMNS.join(', ')} ON main.assignments BEGIN
       SELECT ${FN}(${KIND_ASSIGNMENT}, OLD.BudgetID, OLD.Month, 1);
       SELECT ${FN}(${KIND_ASSIGNMENT}, NEW.BudgetID, NEW.Month, 1); END`,
  ],
  // Account kind, budget status, CC links and currency: rebuild everything.
  ['acc_ins', `AFTER INSERT ON main.accounts BEGIN SELECT ${FN}(${KIND_ALL}, NULL, NULL, 1); END`],
  ['acc_del', `AFTER DELETE ON main.accounts BEGIN SELECT ${FN}(${KIND_ALL}, NULL, NULL, 1); END`],
  [
    'acc_upd',
    `AFTER UPDATE OF ${ACCOUNT_COLUMNS.join(', ')} ON main.accounts WHEN ${changed(ACCOUNT_COLUMNS)}
       BEGIN SELECT ${FN}(${KIND_ALL}, NULL, NULL, 1); END`,
  ],
  // Category / group membership and names: re-fold from the same sums (no SQL).
  [
    'cat_ins',
    `AFTER INSERT ON main.categories BEGIN SELECT ${FN}(${KIND_META}, NULL, NULL, 1); END`,
  ],
  [
    'cat_del',
    `AFTER DELETE ON main.categories BEGIN SELECT ${FN}(${KIND_META}, NULL, NULL, 1); END`,
  ],
  [
    'cat_upd',
    `AFTER UPDATE OF ${CATEGORY_COLUMNS.join(', ')} ON main.categories WHEN ${changed(CATEGORY_COLUMNS)}
       BEGIN SELECT ${FN}(${KIND_META}, NULL, NULL, 1); END`,
  ],
  [
    'grp_ins',
    `AFTER INSERT ON main.category_groups BEGIN SELECT ${FN}(${KIND_META}, NULL, NULL, 1); END`,
  ],
  [
    'grp_del',
    `AFTER DELETE ON main.category_groups BEGIN SELECT ${FN}(${KIND_META}, NULL, NULL, 1); END`,
  ],
  [
    'grp_upd',
    `AFTER UPDATE OF ${GROUP_COLUMNS.join(', ')} ON main.category_groups WHEN ${changed(GROUP_COLUMNS)}
       BEGIN SELECT ${FN}(${KIND_META}, NULL, NULL, 1); END`,
  ],
  [
    'bud_upd',
    `AFTER UPDATE OF DisplayCurrency ON main.budgets WHEN OLD.DisplayCurrency IS NOT NEW.DisplayCurrency
       BEGIN SELECT ${FN}(${KIND_ALL}, NULL, NULL, 1); END`,
  ],
  ['bud_del', `AFTER DELETE ON main.budgets BEGIN SELECT ${FN}(${KIND_ALL}, NULL, NULL, 1); END`],
];
const TRIGGER_PREFIX = 'budgero_snapshot_';

// ---------------------------------------------------------------- loading SQL

/** `AND <col> IN (?2, ?3, ...)` for a month list, '' for every month. */
const monthFilter = (col: string, months: string[] | null) =>
  months ? `AND ${col} IN (${months.map((_, i) => `?${i + 2}`).join(', ')})` : '';

const nonCreditSql = (mf: string) => `
  SELECT Month, CategoryID, SUM(Amount) AS Amount FROM (
    SELECT t.Month AS Month, t.CategoryID AS CategoryID, t.InflowConverted - t.OutflowConverted AS Amount
    FROM transactions t JOIN accounts a ON a.ID = t.AccountID
    WHERE t.BudgetID = ?1 ${mf} AND a.OnBudget = TRUE AND LOWER(a.Type) <> 'credit' ${NO_SPLITS_FILTER}
    UNION ALL
    SELECT t.Month, s.CategoryID, s.InflowConverted - s.OutflowConverted
    FROM transaction_splits s JOIN transactions t ON t.ID = s.TransactionID
    JOIN accounts a ON a.ID = t.AccountID
    WHERE t.BudgetID = ?1 ${mf} AND a.OnBudget = TRUE AND LOWER(a.Type) <> 'credit'
  ) GROUP BY Month, CategoryID`;

const creditLinesSql = (mf: string) => `
  SELECT Month, AccountID, CategoryID, Amount FROM (
    SELECT t.Month AS Month, t.AccountID AS AccountID, t.CategoryID AS CategoryID,
           t.InflowConverted - t.OutflowConverted AS Amount, t.Date AS LineDate,
           t.OutflowConverted AS ParentOutflow, t.ID AS TransactionID, 0 AS PartIndex
    FROM transactions t JOIN accounts a ON a.ID = t.AccountID
    WHERE t.BudgetID = ?1 ${mf} AND a.OnBudget = TRUE AND LOWER(a.Type) = 'credit' ${NO_SPLITS_FILTER}
    UNION ALL
    SELECT t.Month, t.AccountID, s.CategoryID, s.InflowConverted - s.OutflowConverted, t.Date,
           t.OutflowConverted, t.ID, s.OrderIndex
    FROM transaction_splits s JOIN transactions t ON t.ID = s.TransactionID
    JOIN accounts a ON a.ID = t.AccountID
    WHERE t.BudgetID = ?1 ${mf} AND a.OnBudget = TRUE AND LOWER(a.Type) = 'credit'
  ) ORDER BY LineDate, ParentOutflow DESC, TransactionID, PartIndex`;

const ccSpendSql = (mf: string) => `
  SELECT x.Month AS Month, x.CategoryID AS CategoryID, x.AccountID AS AccountID,
         SUM(x.OutflowConverted) AS Total, COUNT(*) AS N
  FROM (
    SELECT t.Month AS Month, s.CategoryID AS CategoryID, t.AccountID AS AccountID,
           s.OutflowConverted AS OutflowConverted
    FROM transactions t CROSS JOIN transaction_splits s ON s.TransactionID = t.ID
    WHERE t.AccountID IN (SELECT ID FROM accounts WHERE BudgetID = ?1 AND LOWER(Type) = 'credit')
      AND t.BudgetID = ?1 ${mf} AND s.OutflowConverted > 0
    UNION ALL
    SELECT t.Month, t.CategoryID, t.AccountID, t.OutflowConverted
    FROM transactions t
    WHERE t.AccountID IN (SELECT ID FROM accounts WHERE BudgetID = ?1 AND LOWER(Type) = 'credit')
      AND t.BudgetID = ?1 ${mf} AND t.OutflowConverted > 0 ${NO_SPLITS_FILTER}
  ) x GROUP BY x.Month, x.CategoryID, x.AccountID`;

const cardsSql = (mf: string) => `
  SELECT t.Month AS Month, t.AccountID AS AccountID,
         SUM(t.InflowConverted - t.OutflowConverted) AS Net,
         SUM(CASE WHEN t.TransferID IS NOT NULL AND t.TransferID != '' AND t.InflowConverted > 0
                  THEN t.InflowConverted ELSE 0 END) AS Payments
  FROM transactions t JOIN accounts a ON a.ID = t.AccountID
  WHERE t.BudgetID = ?1 ${mf} AND LOWER(a.Type) = 'credit'
  GROUP BY t.Month, t.AccountID`;

const incomeSql = (mf: string) => `
  SELECT t.Month AS Month, t.CategoryID AS CategoryID,
         SUM(t.InflowConverted - t.OutflowConverted) AS Amount
  FROM transactions t JOIN accounts acc ON t.AccountID = acc.ID
  WHERE t.BudgetID = ?1 ${mf} AND acc.OnBudget = TRUE AND (t.TransferID IS NULL OR t.TransferID = '')
  GROUP BY t.Month, t.CategoryID`;

// Same legs as readyToAssign's OFF_BUDGET_PARTNER_TRANSFERS sums (a partner leg
// on an off-budget, non-debt account; the leg itself on an on-budget account).
const transfersSql = (mf: string, all: boolean) => `
  SELECT t.Month AS Month, t.CategoryID AS CategoryID,
         SUM(CASE WHEN t.OutflowConverted > 0 THEN t.OutflowConverted ELSE 0 END) AS OffBudget,
         SUM(CASE WHEN t.InflowConverted > 0 THEN t.InflowConverted ELSE 0 END) AS InBudget
  FROM ${
    all
      ? `(SELECT DISTINCT mirror.TransferID AS TransferID FROM accounts oa
          CROSS JOIN transactions mirror ON mirror.AccountID = oa.ID
          WHERE oa.OnBudget = FALSE AND LOWER(oa.Type) NOT IN ('credit', 'loan', 'mortgage')
            AND +mirror.TransferID != '') partner
         CROSS JOIN transactions t ON partner.TransferID = t.TransferID`
      : 'transactions t'
  }
  JOIN accounts src ON t.AccountID = src.ID
  WHERE t.TransferID <> '' AND ${all ? '+t.BudgetID' : 't.BudgetID'} = ?1 ${mf}
    AND src.OnBudget = TRUE AND t.ExcludeFromReadyToAssign = FALSE
    ${
      all
        ? ''
        : `AND EXISTS (SELECT 1 FROM transactions mirror JOIN accounts oa ON oa.ID = mirror.AccountID
             WHERE mirror.TransferID = t.TransferID AND mirror.TransferID != ''
               AND oa.OnBudget = FALSE AND LOWER(oa.Type) NOT IN ('credit', 'loan', 'mortgage'))`
    }
  GROUP BY t.Month, t.CategoryID`;

const assignmentsSql = (mf: string) => `
  SELECT Month, CategoryID, SUM(Amount) AS Amount FROM assignments
  WHERE BudgetID = ?1 ${mf} GROUP BY Month, CategoryID`;

// ---------------------------------------------------------------- state

interface BudgetState {
  data: BudgetData;
  dirtyTx: Set<number>;
  dirtyAssigned: Set<number>;
  /** Bumped on every change to `data` (keys the derived caches). */
  version: number;
  fold: { key: string; fold: MonthlyFold } | null;
  memo: Map<string, unknown>;
}

class UnsupportedMonth extends Error {}

/**
 * One store per DatabaseAdapter (shared by every MonthlyBudgetService on it).
 */
export class BudgetSnapshotStore {
  private budgets = new Map<number, BudgetState | 'unsupported'>();

  private hooks: 'none' | 'ok' | 'broken' = 'none';

  private metaVersion = 0;

  private groupOf: { version: number; map: Map<number, string> } | null = null;

  /** Counters for tests and benchmarks. */
  readonly stats = { builds: 0, refreshedMonths: 0, folds: 0, invalidations: 0, fallbacks: 0 };

  constructor(private readonly db: DatabaseAdapter) {
    db.addConnectionListener?.((event) => {
      if (this.hooks !== 'ok') return;
      if (event === 'replace') this.invalidateAll();
      this.hooks = 'none';
      if (!this.installHooks()) this.invalidateAll();
    });
  }

  /** Drops every budget's snapshot (rebuilt lazily). */
  invalidateAll(): void {
    this.budgets.clear();
    this.metaVersion++;
    this.groupOf = null;
    this.stats.invalidations++;
  }

  // -------------------------------------------------------------- hooks

  private onChange(
    kind: SqlFunctionValue,
    budget: SqlFunctionValue,
    month: SqlFunctionValue,
    valid: SqlFunctionValue
  ) {
    try {
      if (kind === KIND_ALL) return this.invalidateAll();
      if (kind === KIND_META) {
        this.metaVersion++;
        this.groupOf = null;
        return;
      }
      const state = this.budgets.get(Number(budget));
      if (!state) return;
      if (state === 'unsupported') {
        // re-check on the next read
        this.budgets.delete(Number(budget));
        return;
      }
      const index = toMonthIndex(month);
      if (index < 0 || !valid) {
        this.budgets.delete(Number(budget));
        return;
      }
      if (kind === KIND_TX) state.dirtyTx.add(index);
      else state.dirtyAssigned.add(index);
      state.version++;
    } catch {
      // never fail the write that fired the trigger
      try {
        this.budgets.clear();
      } catch {
        /* ignore */
      }
    }
    return undefined;
  }

  private installHooks(): boolean {
    if (!this.db.createFunction || !this.db.addConnectionListener) {
      this.hooks = 'broken';
      return false;
    }
    try {
      this.db.createFunction(FN, (kind, budget, month, valid) => {
        this.onChange(kind, budget, month, valid);
        return null;
      });
      const ddl = TRIGGERS.map(
        ([name, body]) =>
          `DROP TRIGGER IF EXISTS temp.${TRIGGER_PREFIX}${name}; CREATE TEMP TRIGGER ${TRIGGER_PREFIX}${name} ${body};`
      ).join('\n');
      this.db.exec(ddl);
      this.hooks = 'ok';
      return true;
    } catch (error) {
      debugLog('Budget snapshot hooks could not be installed; using full queries', { error });
      this.hooks = 'broken';
      try {
        this.db.exec(
          TRIGGERS.map(([name]) => `DROP TRIGGER IF EXISTS temp.${TRIGGER_PREFIX}${name};`).join(
            '\n'
          )
        );
      } catch {
        /* ignore */
      }
      return false;
    }
  }

  /** True when the TEMP triggers are in place (installing them on first use). */
  private ensureHooks(): boolean {
    if (this.hooks === 'broken') return false;
    if (this.hooks === 'none') {
      this.invalidateAll();
      return this.installHooks();
    }
    const row = getRow<{ n: number }>(
      this.db,
      `SELECT COUNT(*) AS n FROM sqlite_temp_master WHERE type = 'trigger' AND name GLOB '${TRIGGER_PREFIX}*'`
    );
    if (row?.n === TRIGGERS.length) return true;
    // Connection re-opened behind our back: writes since then were not seen.
    this.invalidateAll();
    this.hooks = 'none';
    return this.installHooks();
  }

  /** Whether the hooks are installed and healthy (tests). */
  get healthy(): boolean {
    return this.hooks === 'ok';
  }

  // -------------------------------------------------------------- reads

  /**
   * The budget's current data, or null when the full queries must be used
   * (in a transaction, no hooks, unsupported rows, or a month it can't index).
   */
  acquire(budgetId: number, months: string[] = []): SnapshotHandle | null {
    if (this.db.inTransaction) return this.fallback();
    if (months.some((m) => toMonthIndex(m) < 0)) return this.fallback();
    if (!this.ensureHooks()) return this.fallback();
    let state = this.budgets.get(budgetId);
    if (state === 'unsupported') return this.fallback();
    try {
      if (!state) {
        state = this.build(budgetId);
        this.budgets.set(budgetId, state);
      } else this.refresh(budgetId, state);
    } catch (error) {
      if (error instanceof UnsupportedMonth) {
        this.budgets.set(budgetId, 'unsupported');
        return this.fallback();
      }
      this.budgets.delete(budgetId);
      if (getBudgetSnapshotOptions().verify) throw error;
      debugLog('Budget snapshot load failed; using full queries', { error });
      return this.fallback();
    }
    return new SnapshotHandle(this, budgetId, state);
  }

  private fallback(): null {
    this.stats.fallbacks++;
    return null;
  }

  /** Category ID -> group name, for every category (cached per metadata version). */
  groupMap(): Map<number, string> {
    if (this.groupOf?.version === this.metaVersion) return this.groupOf.map;
    const rows = allRows<{ ID: number; GroupName: string }>(
      this.db,
      `SELECT c.ID AS ID, cg.Name AS GroupName FROM categories c JOIN category_groups cg ON cg.ID = c.CategoryGroupID`
    );
    const map = new Map<number, string>();
    for (const r of rows) map.set(r.ID, r.GroupName);
    this.groupOf = { version: this.metaVersion, map };
    return map;
  }

  get currentMetaVersion(): number {
    return this.metaVersion;
  }

  fold(state: BudgetState, cardToPaymentCat: Map<number, number>): MonthlyFold {
    const key = `${state.version}|${this.metaVersion}|${[...cardToPaymentCat].join(',')}`;
    if (state.fold?.key === key) return state.fold.fold;
    const fold = foldMonthly(state.data, { groupOf: this.groupMap(), cardToPaymentCat });
    state.fold = { key, fold };
    this.stats.folds++;
    return fold;
  }

  // -------------------------------------------------------------- loading

  private build(budgetId: number): BudgetState {
    const bad = getRow<{ bad: number }>(
      this.db,
      `SELECT EXISTS (SELECT 1 FROM transactions WHERE BudgetID = ?1 AND DATE(Date) IS NULL) AS bad`,
      budgetId
    );
    if (bad?.bad) throw new UnsupportedMonth();
    const data: BudgetData = { tx: new Map(), assigned: new Map() };
    this.loadTx(budgetId, data, null);
    this.loadAssigned(budgetId, data, null);
    this.stats.builds++;
    debugLog(`Budget snapshot built for budget ${budgetId}: ${data.tx.size} months`);
    return {
      data,
      dirtyTx: new Set(),
      dirtyAssigned: new Set(),
      version: 0,
      fold: null,
      memo: new Map(),
    };
  }

  private refresh(budgetId: number, state: BudgetState): void {
    if (state.dirtyTx.size === 0 && state.dirtyAssigned.size === 0) return;
    if (state.dirtyTx.size > 0) {
      const months = [...state.dirtyTx];
      state.dirtyTx.clear();
      this.loadTx(budgetId, state.data, months);
      this.stats.refreshedMonths += months.length;
    }
    if (state.dirtyAssigned.size > 0) {
      const months = [...state.dirtyAssigned];
      state.dirtyAssigned.clear();
      this.loadAssigned(budgetId, state.data, months);
      this.stats.refreshedMonths += months.length;
    }
    state.version++;
    state.memo.clear();
  }

  private monthIndexOf(month: unknown): number {
    const index = toMonthIndex(month);
    if (index < 0) throw new UnsupportedMonth();
    return index;
  }

  /** Loads the transaction-derived sums of `months` (indexes), or of every month. */
  private loadTx(budgetId: number, data: BudgetData, monthIndexes: number[] | null): void {
    const fresh = new Map<number, TxMonth>();
    const months =
      monthIndexes?.map((i) => {
        fresh.set(i, emptyTxMonth());
        return monthLabel(i);
      }) ?? null;
    const params = [budgetId, ...(months ?? [])];
    const mf = monthFilter('t.Month', months);
    const get = (m: unknown) => {
      const index = this.monthIndexOf(m);
      let tx = fresh.get(index);
      if (!tx) fresh.set(index, (tx = emptyTxMonth()));
      return tx;
    };
    const addTo = <K>(map: Map<K, number>, key: K, v: number) =>
      map.set(key, (map.get(key) ?? 0) + v);

    for (const r of allRows<{ Month: string; CategoryID: CategoryKey; Amount: number }>(
      this.db,
      nonCreditSql(mf),
      ...params
    ))
      addTo(get(r.Month).nonCredit, r.CategoryID, r.Amount);

    for (const r of allRows<{
      Month: string;
      AccountID: number;
      CategoryID: CategoryKey;
      Amount: number;
    }>(this.db, creditLinesSql(mf), ...params))
      addCreditLine(get(r.Month), r.AccountID, r.CategoryID, r.Amount);

    for (const r of allRows<{
      Month: string;
      CategoryID: CategoryKey;
      AccountID: number;
      Total: number;
      N: number;
    }>(this.db, ccSpendSql(mf), ...params)) {
      const tx = get(r.Month);
      let byCard = tx.ccSpend.get(r.CategoryID);
      if (!byCard) tx.ccSpend.set(r.CategoryID, (byCard = new Map()));
      byCard.set(r.AccountID, { total: r.Total, count: r.N });
    }

    for (const r of allRows<{ Month: string; AccountID: number; Net: number; Payments: number }>(
      this.db,
      cardsSql(mf),
      ...params
    )) {
      const tx = get(r.Month);
      tx.cardNet.set(r.AccountID, r.Net);
      tx.cardPayments.set(r.AccountID, r.Payments);
    }

    for (const r of allRows<{ Month: string; CategoryID: CategoryKey; Amount: number }>(
      this.db,
      incomeSql(mf),
      ...params
    ))
      addTo(get(r.Month).income, r.CategoryID, r.Amount);

    for (const r of allRows<{
      Month: string;
      CategoryID: CategoryKey;
      OffBudget: number;
      InBudget: number;
    }>(this.db, transfersSql(mf, months === null), ...params)) {
      const tx = get(r.Month);
      addTo(tx.offBudgetTransfers, r.CategoryID, r.OffBudget);
      addTo(tx.inBudgetTransfers, r.CategoryID, r.InBudget);
    }

    if (monthIndexes === null) data.tx.clear();
    for (const [index, tx] of fresh) {
      if (isEmptyTxMonth(tx)) data.tx.delete(index);
      else data.tx.set(index, tx);
    }
  }

  private loadAssigned(budgetId: number, data: BudgetData, monthIndexes: number[] | null): void {
    const fresh = new Map<number, Map<number, number>>();
    const months =
      monthIndexes?.map((i) => {
        fresh.set(i, new Map());
        return monthLabel(i);
      }) ?? null;
    for (const r of allRows<{ Month: string; CategoryID: number; Amount: number }>(
      this.db,
      assignmentsSql(monthFilter('Month', months)),
      budgetId,
      ...(months ?? [])
    )) {
      const index = this.monthIndexOf(r.Month);
      let byCat = fresh.get(index);
      if (!byCat) fresh.set(index, (byCat = new Map()));
      byCat.set(r.CategoryID, (byCat.get(r.CategoryID) ?? 0) + r.Amount);
    }
    if (monthIndexes === null) data.assigned.clear();
    for (const [index, byCat] of fresh) {
      if (byCat.size === 0) data.assigned.delete(index);
      else data.assigned.set(index, byCat);
    }
  }
}

const monthLabel = (index: number) => {
  const y = Math.floor(index / 12);
  return `${String(y).padStart(4, '0')}-${String(index - y * 12 + 1).padStart(2, '0')}`;
};

/** A budget's snapshot data for one read (valid until the next write). */
export class SnapshotHandle {
  constructor(
    readonly store: BudgetSnapshotStore,
    readonly budgetId: number,
    private readonly state: BudgetState
  ) {}

  get data(): BudgetData {
    return this.state.data;
  }

  /** Derived value cached until the budget's data or the category metadata change. */
  memo<T>(key: string, compute: () => T): T {
    const k = `${this.store.currentMetaVersion}|${key}`;
    if (this.state.memo.has(k)) return this.state.memo.get(k) as T;
    const value = compute();
    if (this.state.memo.size > 256) this.state.memo.clear();
    this.state.memo.set(k, value);
    return value;
  }

  fold(cardToPaymentCat: Map<number, number>): MonthlyFold {
    return this.store.fold(this.state, cardToPaymentCat);
  }

  groupMap(): Map<number, string> {
    return this.store.groupMap();
  }
}

// ---------------------------------------------------------------- registry

const stores = new WeakMap<DatabaseAdapter, BudgetSnapshotStore>();

/** The adapter's snapshot store, or null when the snapshot is off or unsupported. */
export function getBudgetSnapshotStore(db: DatabaseAdapter): BudgetSnapshotStore | null {
  if (!getBudgetSnapshotOptions().enabled) return null;
  if (
    !db ||
    typeof db.createFunction !== 'function' ||
    typeof db.addConnectionListener !== 'function'
  )
    return null;
  let store = stores.get(db);
  if (!store) {
    store = new BudgetSnapshotStore(db);
    stores.set(db, store);
  }
  return store;
}
