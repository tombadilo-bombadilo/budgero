/**
 * Transfers inside an imported file. A Quicken QIF marks a transfer with
 * `L[Account]` (our TransferAccount column), a YNAB register with the payee
 * "Transfer : Account". When the other account is part of this import (routed
 * to an existing or new account) the row becomes a real transfer:
 *
 * - both sides in the file (within TRANSFER_DAY_WINDOW): they are paired and
 *   created together, once;
 * - only this side in the file: the transfer is created from it, and the
 *   other account gets the matching leg;
 * - an other side that is in the file but too far apart to pair: both stay
 *   plain, so the transfer is never created twice;
 * - the other account is skipped, unknown, in another currency, or is the
 *   row's own account: a plain transaction, as before.
 *
 * Transfers are written with the existing `transactions.addTransfer` op, so
 * older clients replay them unchanged.
 */
import { looksLikeYnabRegister } from '@budgero/core/browser';
import type { FileTransfer } from '../model/types';
import { accountNameKey, type AccountRoutePlan, type RoutableAccount } from './account-routes';

/**
 * Days the two sides of a transfer may be apart. Quicken and YNAB write both
 * sides on the same day; a few days covers a combined export from banks that
 * book an incoming transfer later (weekends).
 */
export const TRANSFER_DAY_WINDOW = 3;

const YNAB_TRANSFER = /^Transfer\s*:\s*(.+)$/i;

/** The account a row says it transfers to/from, if any. */
export function transferTargetsOf(
  rows: Record<string, string>[],
  headers: string[],
  payeeColumn: string | undefined
): (string | undefined)[] {
  const qif = headers.includes('TransferAccount');
  const ynab = !qif && payeeColumn !== undefined && looksLikeYnabRegister(headers);
  return rows.map((row) => {
    const name = qif
      ? row.TransferAccount
      : ynab
        ? row[payeeColumn!]?.trim().match(YNAB_TRANSFER)?.[1]
        : undefined;
    return name?.trim() || undefined;
  });
}

export interface TransferRow {
  index: number;
  /** Planned and not invalid (the user may still skip it in the review). */
  ready: boolean;
  accountId: number | null;
  currency: string;
  date: string;
  inflow: number;
  outflow: number;
}

interface PlanTransfersOptions {
  rows: TransferRow[];
  targets: (string | undefined)[];
  routePlan: AccountRoutePlan;
  accounts: RoutableAccount[];
  remembered?: Record<string, number>;
}

const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

export function planFileTransfers({
  rows,
  targets,
  routePlan,
  accounts,
  remembered = {},
}: PlanTransfersOptions): Map<number, FileTransfer> {
  const open = accounts.filter((a) => !a.Archived);
  const sourceByKey = new Map(routePlan.sources.map((s) => [accountNameKey(s.source), s.source]));
  const resolved = new Map<string, { id: number; currency?: string } | null>();
  // The account a name in the file stands for: its route when it is one of the
  // file's accounts, else the one open account with that name, else the one
  // chosen for it last time.
  const resolve = (name: string) => {
    const key = accountNameKey(name);
    if (resolved.has(key)) return resolved.get(key) ?? undefined;
    let result: { id: number; currency?: string } | null = null;
    const source = sourceByKey.get(key);
    if (source !== undefined) {
      const target = routePlan.targets.get(source);
      if (target?.kind === 'existing') {
        const account = accounts.find((a) => a.ID === target.accountId);
        result = { id: target.accountId, currency: account?.Currency };
      } else if (target?.kind === 'new' && !routePlan.problems.has(source)) {
        result = { id: target.placeholderId, currency: target.currency };
      }
    } else {
      const named = open.filter((a) => accountNameKey(a.Name) === key);
      const rememberedId = Object.getOwnPropertyDescriptor(remembered, name)?.value as
        number | undefined;
      const account = named.length === 1 ? named[0] : open.find((a) => a.ID === rememberedId);
      if (account) result = { id: account.ID, currency: account.Currency };
    }
    resolved.set(key, result);
    return result ?? undefined;
  };

  type Candidate = TransferRow & { counterpart: number; name: string };
  const candidates: Candidate[] = [];
  for (const row of rows) {
    const name = targets[row.index];
    if (!name || !row.ready || row.accountId === null) continue;
    const counterpart = resolve(name);
    if (!counterpart || counterpart.id === row.accountId) continue;
    // Both sides are stored in the same amount: only same-currency transfers.
    if (counterpart.currency !== row.currency) continue;
    if (row.inflow === row.outflow) continue;
    candidates.push({ ...row, counterpart: counterpart.id, name });
  }

  const groups = new Map<string, Candidate[]>();
  for (const row of candidates) {
    const [a, b] = [row.accountId!, row.counterpart].sort((x, y) => x - y);
    const key = `${a}:${b}:${Math.abs(row.inflow - row.outflow)}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const plans = new Map<number, FileTransfer>();
  for (const group of groups.values()) {
    const paired = new Set<number>();
    for (const row of group) {
      if (paired.has(row.index)) continue;
      const net = row.inflow - row.outflow;
      let best: Candidate | undefined;
      let bestDays = Infinity;
      for (const other of group) {
        if (other === row || paired.has(other.index)) continue;
        if (other.accountId !== row.counterpart || other.counterpart !== row.accountId) continue;
        if (other.inflow - other.outflow !== -net) continue;
        const days = Math.abs(dayNumber(other.date) - dayNumber(row.date));
        if (days > TRANSFER_DAY_WINDOW || days >= bestDays) continue;
        best = other;
        bestDays = days;
      }
      if (!best) continue;
      paired.add(row.index).add(best.index);
      plans.set(row.index, {
        counterpartAccountId: row.counterpart,
        counterpartName: row.name,
        partnerIndex: best.index,
      });
      plans.set(best.index, {
        counterpartAccountId: row.accountId!,
        counterpartName: best.name,
        partnerIndex: row.index,
      });
    }
    // Unpaired: a transfer from this side alone, unless the file holds an
    // unpaired other side too far apart to pair. Creating both would import
    // the transfer twice, so those stay plain transactions.
    for (const row of group) {
      if (paired.has(row.index)) continue;
      const net = row.inflow - row.outflow;
      const otherSide = group.some(
        (other) =>
          !paired.has(other.index) &&
          other.accountId === row.counterpart &&
          other.counterpart === row.accountId &&
          other.inflow - other.outflow === -net
      );
      if (otherSide) continue;
      plans.set(row.index, { counterpartAccountId: row.counterpart, counterpartName: row.name });
    }
  }
  return plans;
}
