import type { DatabaseAdapter } from '../../database/interface.js';
import {
  ImportDuplicateService,
  type DuplicateInput,
  type ImportIdentity,
} from '../import/duplicate-planner.js';
import { fromDecimalString, subMilli, ZERO_MILLI, type MilliUnits } from '../../money/index.js';
import { getLocalDateString } from '../../utils/date.js';
import { applyBankFeedSettings, DEFAULT_BANK_FEED_SETTINGS } from './feed-settings.js';
import { BankSyncQueries } from './queries.js';
import type {
  BankConnection,
  BankFeedSettings,
  BankImportPlan,
  BankImportPlanInput,
  BankLink,
  BankLinkInput,
  BankProvider,
  BankReview,
  BankReviewInput,
  BankReviewStatus,
  BankSyncRecordInput,
  BankTransaction,
  EnableBankingConfig,
  EnableBankingSession,
  SimpleFINTransaction,
} from './types.js';

export * from './types.js';
export * from './feed-settings.js';

const REISSUE_DAYS = 3;
/** A pending card payment usually books within a few days, sometimes a week. */
const SETTLE_DAYS = 7;

/** Namespaces source keys and operation IDs. Never change an existing one. */
const SOURCE_NAMESPACE: Record<BankProvider, string> = {
  simplefin: 'simplefin-v1',
  enablebanking: 'enablebanking-v1',
};

export const ENABLE_BANKING_API_URL = 'https://api.enablebanking.com';

export function bankOperationId(
  budgetId: number,
  accountId: number,
  externalAccountId: string,
  transactionId: string,
  provider: BankProvider = 'simplefin'
): string {
  return JSON.stringify([
    SOURCE_NAMESPACE[provider],
    budgetId,
    accountId,
    externalAccountId,
    transactionId,
  ]);
}

function bankSourceKey(provider: BankProvider, externalAccountId: string, id: string): string {
  return JSON.stringify([SOURCE_NAMESPACE[provider], externalAccountId, id]);
}

/**
 * Pending imports get their own operation ID, so the booked version of the
 * same bank row can record a second identity on the settled transaction.
 */
export function pendingOperationId(operationId: string): string {
  return `${operationId}#pending`;
}

export function simpleFINDate(transaction: SimpleFINTransaction): string {
  return getLocalDateString(new Date((transaction.transacted_at || transaction.posted) * 1000));
}

export function isPostedSimpleFINTransaction(transaction: SimpleFINTransaction): boolean {
  return !transaction.pending && transaction.posted > 0;
}

export function fromSimpleFINTransaction(transaction: SimpleFINTransaction): BankTransaction {
  const description = transaction.description?.trim() ?? '';
  const payee = transaction.payee?.trim() || description;
  const day = (seconds: number | undefined) =>
    seconds ? getLocalDateString(new Date(seconds * 1000)) : undefined;
  return {
    fields: {
      counterparty: transaction.payee?.trim() || undefined,
      description: description || undefined,
      bookingDate: day(transaction.posted),
      transactionDate: day(transaction.transacted_at),
    },
    id: transaction.id,
    date: simpleFINDate(transaction),
    amount: fromDecimalString(transaction.amount.replace(/^\+/, '')),
    payee,
    memo: transaction.memo?.trim() || (payee === description ? '' : description),
    pending: !isPostedSimpleFINTransaction(transaction),
    ...(transaction.posted > 0
      ? { postedAt: new Date(transaction.posted * 1000).toISOString() }
      : {}),
  };
}

export function parseEnableBankingConfig(
  connection: Pick<BankConnection, 'Provider' | 'ConfigJSON'> | null | undefined
): EnableBankingConfig | null {
  if (connection?.Provider !== 'enablebanking') return null;
  try {
    const config = JSON.parse(connection.ConfigJSON || '{}') as Partial<EnableBankingConfig>;
    if (!config.appId || !config.privateKeyPem) return null;
    return { ...config, sessions: config.sessions ?? [] } as EnableBankingConfig;
  } catch {
    return null;
  }
}

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return getLocalDateString(new Date(y, m - 1, d + days));
}

function dayDiff(a: string, b: string): number {
  const toUtc = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(a) - toUtc(b)) / 86_400_000);
}

export class BankSyncService {
  private queries: BankSyncQueries;

  constructor(private db: DatabaseAdapter) {
    this.queries = new BankSyncQueries(db);
  }

  getConnection(budgetId: number, provider: BankProvider): BankConnection | null {
    return this.queries.getConnection(budgetId, provider);
  }

  /** Every provider connected for the budget: SimpleFIN and Enable Banking can coexist. */
  listConnections(budgetId: number): BankConnection[] {
    return this.queries.listConnections(budgetId);
  }

  saveConnection(budgetId: number, accessUrl: string): BankConnection {
    this.queries.upsertConnection(budgetId, 'simplefin', accessUrl, '{}');
    return this.queries.getConnection(budgetId, 'simplefin')!;
  }

  /**
   * Saves the app credentials. Sessions belong to an application, so they're
   * kept only when the application ID stays the same (e.g. a re-uploaded key).
   */
  saveEnableBankingConnection(
    budgetId: number,
    config: Omit<EnableBankingConfig, 'sessions'>
  ): BankConnection {
    const existing = this.enableBankingConfig(budgetId);
    const sessions = existing?.appId === config.appId ? existing.sessions : [];
    this.writeEnableBankingConfig(budgetId, { ...config, sessions });
    return this.queries.getConnection(budgetId, 'enablebanking')!;
  }

  /**
   * Adds a session. An earlier session that shares an account is a previous
   * authorization of the same login, so it's replaced; other logins at the
   * same bank (say, two partners at one bank) stay side by side.
   */
  saveEnableBankingSession(budgetId: number, session: EnableBankingSession): void {
    const config = this.enableBankingConfig(budgetId);
    if (!config) throw new Error('Enable Banking is not connected for this budget');
    const hashes = new Set(session.accounts.map((account) => account.hash));
    const sessions = config.sessions.filter(
      (s) =>
        s.sessionId !== session.sessionId && !s.accounts.some((account) => hashes.has(account.hash))
    );
    this.writeEnableBankingConfig(budgetId, { ...config, sessions: [...sessions, session] });
  }

  removeEnableBankingSession(budgetId: number, sessionId: string): void {
    const config = this.enableBankingConfig(budgetId);
    if (!config) return;
    const sessions = config.sessions.filter((s) => s.sessionId !== sessionId);
    this.writeEnableBankingConfig(budgetId, { ...config, sessions });
  }

  private enableBankingConfig(budgetId: number): EnableBankingConfig | null {
    return parseEnableBankingConfig(this.getConnection(budgetId, 'enablebanking'));
  }

  private writeEnableBankingConfig(budgetId: number, config: EnableBankingConfig): void {
    this.queries.upsertConnection(
      budgetId,
      'enablebanking',
      ENABLE_BANKING_API_URL,
      JSON.stringify(config)
    );
  }

  /** Removes one provider's connection with its links and pending reviews. */
  deleteConnection(budgetId: number, provider: BankProvider): void {
    this.queries.deleteConnection(budgetId, provider);
  }

  listLinks(budgetId: number, provider?: BankProvider): BankLink[] {
    return this.queries.listLinks(budgetId, provider);
  }

  saveLink(input: BankLinkInput): void {
    this.queries.upsertLink(input);
  }

  deleteLink(accountId: number): void {
    this.queries.deleteLink(accountId);
  }

  updateLinkSettings(accountId: number, settings: BankFeedSettings): void {
    this.queries.updateLinkSettings(accountId, JSON.stringify(settings));
  }

  latestTransactionDate(accountId: number): string | null {
    return this.queries.latestTransactionDate(accountId, getLocalDateString());
  }

  recordSync(input: BankSyncRecordInput): void {
    this.queries.recordSync(input);
  }

  listPendingReviews(budgetId: number, accountId?: number): BankReview[] {
    return this.queries.listPendingReviews(budgetId, accountId);
  }

  /**
   * A Push API transaction that may be the cleared copy of one typed by hand
   * (same matching as statement imports and bank sync) becomes a match
   * review instead of a second transaction. Null: add it as usual.
   */
  reviewForPushed(input: {
    budgetId: number;
    accountId: number;
    identity: ImportIdentity;
  }): BankReviewInput | null {
    const { budgetId, accountId, identity } = input;
    const duplicates = new ImportDuplicateService(this.db);
    if (duplicates.findOperation(identity.operationId) !== undefined) return null;
    const claimed = this.queries.pendingCandidateIds(budgetId, accountId);
    const match = duplicates
      .manualMatches({ budgetId, accountId, ...identity })
      .find((candidate) => !claimed.has(candidate.id));
    return match ? { budgetId, accountId, identity, candidateTransactionId: match.id } : null;
  }

  addReviews(reviews: BankReviewInput[]): void {
    this.queries.addReviews(reviews);
  }

  setReviewStatus(id: number, status: BankReviewStatus): void {
    this.queries.setReviewStatus(id, status);
  }

  /** A review's current status (undo of setReviewStatus), or null when it is gone. */
  getReviewStatus(id: number): BankReviewStatus | null {
    return this.queries.getReviewStatus(id);
  }

  planImport(input: BankImportPlanInput): BankImportPlan {
    const { budgetId, accountId, currency, link } = input;
    const provider = input.provider ?? 'simplefin';
    const settings = input.settings ?? DEFAULT_BANK_FEED_SETTINGS;
    const transactions = input.transactions.map((tx) => applyBankFeedSettings(tx, settings));
    const reviewed = this.queries.reviewedOperationIds(budgetId, accountId);
    const keyOf = (id: string) => bankSourceKey(provider, link.ExternalAccountID, id);
    const sourcePrefix = `${JSON.stringify([SOURCE_NAMESPACE[provider], link.ExternalAccountID]).slice(0, -1)},`;

    // Imported rows for this feed. A transaction that has any booked identity
    // is settled; one with only a pending identity is still waiting.
    const imported = this.queries.bankImportedRows(budgetId, accountId, sourcePrefix);
    const settled = new Set(
      imported.filter((r) => !r.identity.pending).map((r) => r.transactionId)
    );
    const waiting = imported.filter((r) => r.identity.pending && !settled.has(r.transactionId));
    const waitingByKey = new Map(waiting.map((r) => [r.identity.sourceKey ?? '', r]));
    const claimedPending = new Set<number>();

    let skipped = 0;
    const settles: BankImportPlan['settles'] = [];
    const rows: DuplicateInput[] = [];
    for (const transaction of transactions) {
      const { date, amount } = transaction;
      if (date < link.ImportFrom || amount === 0) continue;
      if (transaction.pending && !settings.importPending) continue;
      const sourceKey = keyOf(transaction.id);
      const operationId = bankOperationId(
        budgetId,
        accountId,
        link.ExternalAccountID,
        transaction.id,
        provider
      );
      const row: DuplicateInput = {
        index: rows.length,
        valid: true,
        budgetId,
        accountId,
        currency,
        operationId: transaction.pending ? pendingOperationId(operationId) : operationId,
        fileRowKey: sourceKey,
        sourceKey,
        date,
        inflow: amount > 0 ? (amount as MilliUnits) : ZERO_MILLI,
        outflow: amount < 0 ? subMilli(ZERO_MILLI, amount as MilliUnits) : ZERO_MILLI,
        payee: transaction.payee,
        memo: transaction.memo,
        ...(transaction.pending ? { pending: true } : {}),
      };
      const waitingRow = waitingByKey.get(sourceKey);
      if (waitingRow) {
        // Imported while pending. Still pending: nothing to do. Booked under
        // the same ID: settle the existing transaction.
        claimedPending.add(waitingRow.transactionId);
        if (transaction.pending) skipped++;
        else {
          const { index: _i, valid: _v, budgetId: _b, accountId: _a, ...identity } = row;
          settles.push({
            identity,
            previous: waitingRow.identity,
            transactionId: waitingRow.transactionId,
          });
        }
        continue;
      }
      const deletedWhilePending =
        !transaction.pending &&
        input.wasImported({ ...row, operationId: pendingOperationId(operationId) });
      if (reviewed.has(row.operationId) || input.wasImported(row) || deletedWhilePending) skipped++;
      else rows.push({ ...row, index: rows.length });
    }

    const fetchedKeys = new Set(transactions.map((tx) => keyOf(tx.id)));
    const fetchedFrom = transactions.map((tx) => tx.date).sort()[0] ?? '';
    const orphans = imported.filter(
      (row) =>
        !row.identity.pending &&
        !fetchedKeys.has(row.identity.sourceKey ?? '') &&
        row.identity.date >= fetchedFrom
    );
    // Pending rows whose ID vanished: banks often book them under a new ID.
    const vanished = waiting.filter(
      (row) =>
        !claimedPending.has(row.transactionId) && !fetchedKeys.has(row.identity.sourceKey ?? '')
    );
    const rekeys: BankImportPlan['rekeys'] = [];
    const normalized = (s: string) => s.trim().toLowerCase();

    const duplicates = new ImportDuplicateService(this.db);
    const tolerance = duplicates.tolerance();
    const plans = duplicates.plan(rows);
    const claimed = this.queries.pendingCandidateIds(budgetId, accountId);
    const imports: BankImportPlan['imports'] = [];
    const reviews: BankReviewInput[] = [];
    for (const [i, plan] of plans.entries()) {
      const { index: _index, valid: _valid, budgetId: _b, accountId: _a, ...identity } = rows[i];
      const review = (candidateTransactionId: number) => {
        claimed.add(candidateTransactionId);
        reviews.push({ budgetId, accountId, identity, candidateTransactionId });
      };
      if (plan.status === 'already-imported') {
        skipped++;
        continue;
      }
      if (!identity.pending) {
        // A booked row matching a vanished pending row of the same amount is
        // its booked version: prefer the same payee, then the nearest date.
        const settle = vanished
          .filter(
            (row) =>
              !claimedPending.has(row.transactionId) &&
              row.identity.inflow === identity.inflow &&
              row.identity.outflow === identity.outflow &&
              row.identity.date >= shiftDate(identity.date, -SETTLE_DAYS) &&
              row.identity.date <= shiftDate(identity.date, SETTLE_DAYS)
          )
          .sort(
            (a, b) =>
              Number(normalized(b.identity.payee) === normalized(identity.payee)) -
                Number(normalized(a.identity.payee) === normalized(identity.payee)) ||
              Math.abs(dayDiff(a.identity.date, identity.date)) -
                Math.abs(dayDiff(b.identity.date, identity.date))
          )[0];
        if (settle) {
          claimedPending.add(settle.transactionId);
          settles.push({
            identity,
            previous: settle.identity,
            transactionId: settle.transactionId,
          });
          continue;
        }
      }
      // Same-date/amount hints are for files; bank rows carry real IDs, so only a reused ID needs review.
      const reusedId = plan.status === 'needs-review' && plan.reason.startsWith('Repeated bank');
      if (reusedId && plan.candidates[0] && !identity.pending) {
        review(plan.candidates[0].id);
        continue;
      }
      const reissued = identity.pending
        ? -1
        : orphans.findIndex(
            (row) =>
              row.identity.date >= shiftDate(identity.date, -REISSUE_DAYS) &&
              row.identity.date <= shiftDate(identity.date, REISSUE_DAYS) &&
              row.identity.inflow === identity.inflow &&
              row.identity.outflow === identity.outflow &&
              normalized(row.identity.payee) === normalized(identity.payee)
          );
      if (reissued >= 0) {
        rekeys.push({ identity, transactionId: orphans[reissued].transactionId });
        orphans.splice(reissued, 1);
        continue;
      }
      // Same matching as statement imports: the duplicate settings' amount % and ± days.
      const manual = duplicates
        .manualMatches({ budgetId, accountId, ...identity }, tolerance)
        .find((match) => !claimed.has(match.id));
      // A pending row that looks like an entry typed by hand isn't imported:
      // the booked version asks for review instead, so nothing doubles up.
      if (manual && identity.pending) skipped++;
      else if (manual) review(manual.id);
      else imports.push(identity);
    }

    // Pending rows the bank dropped without booking (a released hold, say).
    // Only judged when the bank returned data covering their date.
    const removals = transactions.length
      ? vanished
          .filter(
            (row) => !claimedPending.has(row.transactionId) && row.identity.date >= fetchedFrom
          )
          .map((row) => row.transactionId)
      : [];
    return { imports, reviews, rekeys, settles, removals, skipped };
  }
}
