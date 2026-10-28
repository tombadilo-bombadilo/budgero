import type { DatabaseAdapter } from '../../database/interface.js';
import { allRows, getRow, run } from '../../database/sql.js';
import { getLocalDateString } from '../../utils/date.js';
import { DUPLICATE_HINT_DEFAULTS, UserMetaQueries } from '../user-meta/queries.js';

/** Immutable source values: ledger edits must not erase import identity. */
export interface ImportIdentity {
  operationId: string;
  fileRowKey: string;
  sourceKey?: string;
  date: string;
  inflow: number;
  outflow: number;
  payee: string;
  memo: string;
  currency: string;
  /** Imported from a bank while still pending; settled once the bank books it. */
  pending?: boolean;
  /**
   * Push API rows waiting in review: the original transactions.add args, so
   * "Add as new" replays exactly what was sent (category, label, cleared...).
   */
  pushArgs?: Record<string, unknown>;
}
export interface DuplicateInput extends ImportIdentity {
  index: number;
  accountId: number;
  budgetId: number;
  valid: boolean;
}
export interface DuplicateCandidate {
  id: number;
  date: string;
  inflow: number;
  outflow: number;
  payee: string;
  memo: string;
}
export interface DuplicatePlan {
  index: number;
  status: 'new' | 'already-imported' | 'needs-review' | 'invalid';
  reason: string;
  candidates: DuplicateCandidate[];
  sameFileIndex?: number;
  /**
   * The candidate is the only hand-entered transaction this row could be, so
   * the review can default to Match (keep it, mark it cleared).
   */
  suggestMatch?: boolean;
}
/** Same meaning as the hand-entry duplicate hint settings (user_meta). */
export interface DuplicateTolerance {
  /** Basis points of the amount: 100 = 1%. Never tighter than 0.01. */
  toleranceBps: number;
  /** Dates within ± this many days. */
  dayWindow: number;
}
export interface DuplicatePlanOptions {
  /** Also look for hand-entered transactions within this tolerance (statement files). */
  tolerance?: DuplicateTolerance;
}
interface ProvenanceRow {
  TransactionID: number;
  IdentityJSON: string;
}
interface LedgerRow extends DuplicateCandidate {
  imported: number;
  reconciled: number;
}
// Same calendar-day arithmetic as bank sync (local dates, no UTC drift).
const shiftDate = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return getLocalDateString(new Date(y, m - 1, d + days));
};
const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
const signedAmount = (t: { inflow: number; outflow: number }) => t.inflow - t.outflow;
/** Never tighter than 0.01 (10 milliunits), so "exact" still absorbs rounding. */
const amountTolerance = (amount: number, toleranceBps: number) =>
  Math.max(10, Math.round((Math.abs(amount) * toleranceBps) / 10_000));

/** A statement/bank/push row to look up hand-entered matches for. */
export interface ManualMatchQuery {
  budgetId: number;
  accountId: number;
  date: string;
  inflow: number;
  outflow: number;
  payee?: string;
}
const toCandidate = ({ id, date, inflow, outflow, payee, memo }: DuplicateCandidate) => ({
  id,
  date,
  inflow,
  outflow,
  payee,
  memo,
});
const normalized = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const equalAmounts = (a: ImportIdentity, b: ImportIdentity) =>
  a.date === b.date &&
  a.inflow === b.inflow &&
  a.outflow === b.outflow &&
  a.currency === b.currency;

export class ImportDuplicateService {
  constructor(private readonly db: DatabaseAdapter) {}

  /** The hand-entry duplicate settings (Settings → Duplicate transactions), shared by every import path. */
  tolerance(): DuplicateTolerance {
    try {
      const { toleranceBps, dayWindow } = new UserMetaQueries(this.db).getDuplicateHintSettings();
      return { toleranceBps, dayWindow };
    } catch {
      return {
        toleranceBps: DUPLICATE_HINT_DEFAULTS.toleranceBps,
        dayWindow: DUPLICATE_HINT_DEFAULTS.dayWindow,
      };
    }
  }

  /**
   * Hand-entered, unreconciled transactions (no import provenance) that a
   * bank or pushed row could be the cleared copy of: same direction, amount
   * and date within the tolerance. Nearest date first, then closest amount,
   * then same payee. Transfers count: a typed transfer is still the entry.
   */
  manualMatches(query: ManualMatchQuery, tolerance = this.tolerance()): DuplicateCandidate[] {
    const amount = signedAmount(query);
    if (!amount) return [];
    const rows = allRows<LedgerRow>(
      this.db,
      `SELECT t.ID as id, t.Date as date, t.InflowNative as inflow, t.OutflowNative as outflow,
        COALESCE(t.Payee, '') as payee, COALESCE(t.Memo, '') as memo,
        COALESCE(t.Reconciled, 0) as reconciled, 0 as imported
      FROM transactions t
      WHERE t.BudgetID = ? AND t.AccountID = ? AND t.Date BETWEEN ? AND ?
        AND COALESCE(t.Reconciled, 0) = 0
        AND NOT EXISTS (SELECT 1 FROM import_provenance p WHERE p.TransactionID = t.ID)`,
      query.budgetId,
      query.accountId,
      shiftDate(query.date, -tolerance.dayWindow),
      shiftDate(query.date, tolerance.dayWindow)
    );
    const limit = amountTolerance(amount, tolerance.toleranceBps);
    const payee = normalized(query.payee ?? '');
    return rows
      .filter((t) => {
        const other = signedAmount(t);
        return other > 0 === amount > 0 && Math.abs(other - amount) <= limit;
      })
      .map((t) => ({
        t,
        days: Math.abs(dayNumber(t.date) - dayNumber(query.date)),
        diff: Math.abs(signedAmount(t) - amount),
        payee: Number(normalized(t.payee) !== payee),
      }))
      .sort((a, b) => a.days - b.days || a.diff - b.diff || a.payee - b.payee || a.t.id - b.t.id)
      .map(({ t }) => toCandidate(t));
  }

  identities(transactionId: number): ImportIdentity[] {
    return allRows<ProvenanceRow>(
      this.db,
      'SELECT TransactionID, IdentityJSON FROM import_provenance WHERE TransactionID = ?',
      transactionId
    ).map((row) => JSON.parse(row.IdentityJSON) as ImportIdentity);
  }

  findOperation(operationId: string): number | undefined {
    return getRow<{ TransactionID: number }>(
      this.db,
      'SELECT TransactionID FROM import_provenance WHERE OperationID = ?',
      operationId
    )?.TransactionID;
  }

  record(transactionId: number, identity: ImportIdentity): void {
    const tx = getRow<{ BudgetID: number; AccountID: number }>(
      this.db,
      'SELECT BudgetID, AccountID FROM transactions WHERE ID = ?',
      transactionId
    );
    if (!tx) throw new Error('The matched transaction no longer exists. Review the import again.');
    run(
      this.db,
      `INSERT INTO import_provenance
      (TransactionID, BudgetID, AccountID, Currency, OperationID, FileRowKey, SourceKey, IdentityJSON)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(OperationID) DO NOTHING`,
      transactionId,
      tx.BudgetID,
      tx.AccountID,
      identity.currency,
      identity.operationId,
      identity.fileRowKey,
      identity.sourceKey ?? null,
      JSON.stringify(identity)
    );
  }

  /** Undo of record(): drop the identity again, only if it still points at `transactionId`. */
  forget(transactionId: number, operationId: string): void {
    run(
      this.db,
      'DELETE FROM import_provenance WHERE OperationID = ? AND TransactionID = ?',
      operationId,
      transactionId
    );
  }

  plan(rows: DuplicateInput[], options: DuplicatePlanOptions = {}): DuplicatePlan[] {
    const window = options.tolerance?.dayWindow ?? 0;
    // Fetch once per destination/date range, never once per statement row.
    const groups = new Map<string, DuplicateInput[]>();
    for (const row of rows) {
      const key = `${row.budgetId}:${row.accountId}:${row.currency}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    const results = new Map<number, DuplicatePlan>();
    for (const group of groups.values()) {
      const first = group[0];
      const dates = group.map((row) => row.date).sort();
      const transactions = allRows<LedgerRow>(
        this.db,
        `SELECT t.ID as id, t.Date as date,
        t.InflowNative as inflow, t.OutflowNative as outflow, COALESCE(t.Payee, '') as payee,
        COALESCE(t.Memo, '') as memo, COALESCE(t.Reconciled, 0) as reconciled,
        EXISTS (SELECT 1 FROM import_provenance p WHERE p.TransactionID = t.ID) as imported
        FROM transactions t JOIN accounts a ON a.ID=t.AccountID
        WHERE t.BudgetID=? AND t.AccountID=? AND a.Currency=? AND t.Date BETWEEN ? AND ?`,
        first.budgetId,
        first.accountId,
        first.currency,
        window ? shiftDate(dates[0], -window) : dates[0],
        window ? shiftDate(dates[dates.length - 1], window) : dates[dates.length - 1]
      );
      // Hand-entered, not yet reconciled: what a statement row can be matched to.
      const manual = (t: LedgerRow) => !t.imported && !t.reconciled;
      const provenance = allRows<ProvenanceRow & DuplicateCandidate>(
        this.db,
        `SELECT p.TransactionID, p.IdentityJSON, t.ID as id, t.Date as date,
        t.InflowNative as inflow, t.OutflowNative as outflow, COALESCE(t.Payee, '') as payee,
        COALESCE(t.Memo, '') as memo
        FROM import_provenance p JOIN transactions t ON t.ID=p.TransactionID
        JOIN accounts a ON a.ID=t.AccountID
        WHERE t.BudgetID=? AND t.AccountID=? AND a.Currency=? AND p.Currency=?`,
        first.budgetId,
        first.accountId,
        first.currency,
        first.currency
      );
      const files = new Map<string, (ProvenanceRow & DuplicateCandidate)[]>();
      const sources = new Map<string, (ProvenanceRow & DuplicateCandidate)[]>();
      for (const p of provenance) {
        const identity = JSON.parse(p.IdentityJSON) as ImportIdentity;
        files.set(identity.fileRowKey, [...(files.get(identity.fileRowKey) ?? []), p]);
        if (identity.sourceKey)
          sources.set(identity.sourceKey, [...(sources.get(identity.sourceKey) ?? []), p]);
      }
      const byAmountAndDate = new Map<string, LedgerRow[]>();
      for (const transaction of transactions) {
        const key = `${transaction.date}:${transaction.inflow}:${transaction.outflow}`;
        const bucket = byAmountAndDate.get(key) ?? [];
        bucket.push(transaction);
        byAmountAndDate.set(key, bucket);
      }
      const used = new Set<number>();
      const pending = new Set<DuplicateInput>();
      for (const row of group) {
        if (!row.valid) {
          results.set(row.index, {
            index: row.index,
            status: 'invalid',
            reason: 'Invalid or manually skipped row',
            candidates: [],
          });
          continue;
        }
        const exact = files.get(row.fileRowKey) ?? [];
        const source = row.sourceKey ? (sources.get(row.sourceKey) ?? []) : [];
        const matched =
          exact[0] ??
          source.find(
            (p) =>
              !used.has(p.TransactionID) &&
              equalAmounts(row, JSON.parse(p.IdentityJSON) as ImportIdentity)
          );
        if (matched) {
          used.add(matched.TransactionID);
          const candidate = {
            id: matched.id,
            date: matched.date,
            inflow: matched.inflow,
            outflow: matched.outflow,
            payee: matched.payee,
            memo: matched.memo,
          };
          results.set(row.index, {
            index: row.index,
            status: 'already-imported',
            reason: exact.includes(matched)
              ? 'This file row was already imported'
              : 'Bank transaction ID was already imported',
            candidates: [candidate],
          });
        } else if (source.length) {
          const candidates = source
            .filter((p) => !used.has(p.TransactionID))
            .map((p) => {
              return {
                id: p.id,
                date: p.date,
                inflow: p.inflow,
                outflow: p.outflow,
                payee: p.payee,
                memo: p.memo,
              };
            });
          if (candidates[0]) used.add(candidates[0].id);
          results.set(row.index, {
            index: row.index,
            status: 'needs-review',
            reason: 'Repeated bank transaction ID; verify the details',
            candidates: candidates.slice(0, 1),
          });
        } else pending.add(row);
      }
      const seen = new Map<string, number>();
      const seenSources = new Map<string, number>();
      for (const row of group) {
        if (!row.valid) continue;
        const key = `${row.date}:${row.inflow}:${row.outflow}`;
        const previous =
          (row.sourceKey ? seenSources.get(row.sourceKey) : undefined) ?? seen.get(key);
        if (pending.has(row)) {
          const candidates = (byAmountAndDate.get(key) ?? []).filter((t) => !used.has(t.id));
          const score = (t: LedgerRow) =>
            Number(normalized(t.payee) === normalized(row.payee)) * 2 +
            Number(normalized(t.memo) === normalized(row.memo));
          candidates.sort((a, b) => score(b) - score(a) || a.id - b.id);
          // Reserve one candidate; one ledger transaction cannot consume multiple input rows.
          if (candidates[0]) used.add(candidates[0].id);
          results.set(row.index, {
            index: row.index,
            status: candidates.length || previous !== undefined ? 'needs-review' : 'new',
            reason: candidates.length
              ? 'Same date and amount in this account'
              : previous !== undefined
                ? 'Similar row in this file; both may be real transactions'
                : '',
            candidates: candidates.slice(0, 1).map(toCandidate),
            sameFileIndex: previous,
            ...(candidates.length === 1 && previous === undefined && manual(candidates[0])
              ? { suggestMatch: true }
              : {}),
          });
        }
        seen.set(key, row.index);
        if (row.sourceKey) seenSources.set(row.sourceKey, row.index);
      }
      if (options.tolerance)
        this.matchWithinTolerance(group, transactions, results, used, options.tolerance, manual);
    }
    return rows.map((row) => results.get(row.index)!);
  }

  /**
   * Rows with no exact match may still be a transaction typed by hand: the
   * bank often books a card purchase a few days later, or for a slightly
   * different amount (tips, FX). Pair each row with a hand-entered
   * transaction inside the tolerance, nearest date first, then closest
   * amount, then same payee; each transaction is used at most once.
   */
  private matchWithinTolerance(
    group: DuplicateInput[],
    transactions: LedgerRow[],
    results: Map<number, DuplicatePlan>,
    used: Set<number>,
    { toleranceBps, dayWindow }: DuplicateTolerance,
    manual: (t: LedgerRow) => boolean
  ): void {
    const open = group.filter((row) => {
      const plan = results.get(row.index);
      return (
        plan && (plan.status === 'new' || plan.status === 'needs-review') && !plan.candidates.length
      );
    });
    const pool = transactions.filter((t) => manual(t) && !used.has(t.id));
    const pairs: {
      row: DuplicateInput;
      t: LedgerRow;
      days: number;
      diff: number;
      payee: number;
    }[] = [];
    const options = new Map<number, number>();
    for (const row of open) {
      const amount = signedAmount(row);
      if (!amount) continue;
      const tolerance = amountTolerance(amount, toleranceBps);
      for (const t of pool) {
        const other = signedAmount(t);
        const days = Math.abs(dayNumber(t.date) - dayNumber(row.date));
        const diff = Math.abs(other - amount);
        if (other > 0 !== amount > 0 || diff > tolerance || days > dayWindow) continue;
        pairs.push({
          row,
          t,
          days,
          diff,
          payee: Number(normalized(t.payee) !== normalized(row.payee)),
        });
        options.set(row.index, (options.get(row.index) ?? 0) + 1);
      }
    }
    pairs.sort(
      (a, b) =>
        a.days - b.days ||
        a.diff - b.diff ||
        a.payee - b.payee ||
        a.row.index - b.row.index ||
        a.t.id - b.t.id
    );
    const matchedRows = new Set<number>();
    for (const { row, t } of pairs) {
      if (matchedRows.has(row.index) || used.has(t.id)) continue;
      matchedRows.add(row.index);
      used.add(t.id);
      const plan = results.get(row.index)!;
      results.set(row.index, {
        ...plan,
        status: 'needs-review',
        reason: 'Similar amount and date in this account',
        candidates: [toCandidate(t)],
        ...(options.get(row.index) === 1 && plan.sameFileIndex === undefined
          ? { suggestMatch: true }
          : {}),
      });
    }
  }
}

/** CSV/QIF text and CAMT EndToEndId are never promoted to trusted bank IDs. */
export function importSourceKey(source: string, row: Record<string, string>): string | undefined {
  const account = row.Account?.trim();
  const id = (
    source === 'ofx' ? row.FITID : source === 'camt' ? row.BankEntryReference : undefined
  )?.trim();
  if (
    !account ||
    !id ||
    /^(notprovided|nonref|n\/a|none|null|unknown|0+)$/i.test(id.replace(/\s+/g, ''))
  )
    return undefined;
  return JSON.stringify([`${source}-v1`, account, id]);
}
