import type { DatabaseAdapter } from '../../database/interface.js';
import { allRows, getRow, run } from '../../database/sql.js';

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
}
interface ProvenanceRow {
  TransactionID: number;
  IdentityJSON: string;
}
const normalized = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const equalAmounts = (a: ImportIdentity, b: ImportIdentity) =>
  a.date === b.date &&
  a.inflow === b.inflow &&
  a.outflow === b.outflow &&
  a.currency === b.currency;

export class ImportDuplicateService {
  constructor(private readonly db: DatabaseAdapter) {}

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

  plan(rows: DuplicateInput[]): DuplicatePlan[] {
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
      const transactions = allRows<DuplicateCandidate>(
        this.db,
        `SELECT t.ID as id, t.Date as date,
        t.InflowNative as inflow, t.OutflowNative as outflow, COALESCE(t.Payee, '') as payee,
        COALESCE(t.Memo, '') as memo FROM transactions t JOIN accounts a ON a.ID=t.AccountID
        WHERE t.BudgetID=? AND t.AccountID=? AND a.Currency=? AND t.Date BETWEEN ? AND ?`,
        first.budgetId,
        first.accountId,
        first.currency,
        dates[0],
        dates[dates.length - 1]
      );
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
      const byAmountAndDate = new Map<string, DuplicateCandidate[]>();
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
          const score = (t: DuplicateCandidate) =>
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
            candidates: candidates.slice(0, 1),
            sameFileIndex: previous,
          });
        }
        seen.set(key, row.index);
        if (row.sourceKey) seenSources.set(row.sourceKey, row.index);
      }
    }
    return rows.map((row) => results.get(row.index)!);
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
