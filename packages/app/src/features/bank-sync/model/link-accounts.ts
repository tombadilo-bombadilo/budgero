import { t } from '@lingui/core/macro';
import {
  AccountTypeEnum,
  isCryptoCurrency,
  type Account,
  type BankConnection,
  type BankTransaction,
} from '@budgero/core/browser';
import { getAccountTypeDefinition } from '@entities/account/model/accountTypes';
import { formatDateISO } from '@shared/lib/date-utils';
import type { AppRuntime } from '@shared/runtime/app-runtime';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import {
  fetchRemoteTransactions,
  linkedExternalIds,
  type RemoteBankAccount,
} from '../lib/provider';
import { runBankSync, syncStart, type BankSyncResult } from './run-bank-sync';

export const DEFAULT_HISTORY_DAYS = 30;

export type LinkTarget =
  { kind: 'existing'; accountId: number } | { kind: 'new'; name: string; type: AccountTypeEnum };

export interface LinkRequest {
  remote: RemoteBankAccount;
  target: LinkTarget;
  importFrom: string;
}

export function isSupportedBankCurrency(code: string): boolean {
  // "XXX" is the ISO 4217 placeholder for "no currency" / "unknown currency"
  // (e.g. PayPal wallets via SimpleFIN report it for multi-currency accounts).
  // It matches the bare regex but isn't a real currency, so it must never
  // satisfy a currency-equality check downstream.
  return code !== 'XXX' && /^[A-Z]{3}$/.test(code) && !isCryptoCurrency(code);
}

export function guessAccountType(remote: RemoteBankAccount): AccountTypeEnum {
  const name = `${remote.name} ${remote.orgName}`.toLowerCase();
  if (/mortgage/.test(name)) return AccountTypeEnum.MORTGAGE;
  if (/loan|auto|student/.test(name)) return AccountTypeEnum.LOAN;
  if (/credit|card|visa|mastercard|amex|discover/.test(name)) return AccountTypeEnum.CREDIT;
  if (/401k|ira|roth|retire/.test(name)) return AccountTypeEnum.RETIREMENT;
  if (/invest|brokerage|stock/.test(name)) return AccountTypeEnum.INVESTMENT;
  if (/saving/.test(name)) return AccountTypeEnum.SAVINGS;
  if (remote.balance !== null && remote.balance < 0) return AccountTypeEnum.CREDIT;
  return AccountTypeEnum.CHECKING;
}

export function daysAgo(days: number, now = new Date()): string {
  return formatDateISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
}

/** Start right after the newest entry so history typed in by hand isn't imported twice. */
export function defaultImportFrom(latestTransactionDate: string | null | undefined): string {
  const fallback = daysAgo(DEFAULT_HISTORY_DAYS);
  if (!latestTransactionDate) return fallback;
  const [y, m, d] = latestTransactionDate.slice(0, 10).split('-').map(Number);
  const next = formatDateISO(new Date(y, m - 1, d + 1));
  return next > daysAgo(0) ? daysAgo(0) : next;
}

/** Balance on the eve of `importFrom`, so the imported history lands on today's bank balance. */
export function openingBalance(remote: RemoteBankAccount, importFrom: string): number {
  if (remote.balance === null) return 0;
  const balanceTime = remote.balanceDate ? new Date(remote.balanceDate).getTime() : null;
  // Counted in the balance: exact post time when the provider gives one
  // (SimpleFIN), otherwise the bank's own balance day (Enable Banking).
  const inBalance = (tx: BankTransaction) => {
    if (tx.postedAt && balanceTime !== null) return new Date(tx.postedAt).getTime() <= balanceTime;
    if (remote.balanceDay) return tx.date <= remote.balanceDay;
    return true;
  };
  const imported = (remote.transactions ?? [])
    .filter((tx) => !tx.pending && tx.date >= importFrom && inBalance(tx))
    .reduce((sum, tx) => sum + tx.amount, 0);
  return remote.balance - imported;
}

function dayBefore(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return formatDateISO(new Date(y, m - 1, d - 1));
}

export async function linkAccounts(
  runtime: AppRuntime,
  connection: BankConnection,
  requests: LinkRequest[]
): Promise<BankSyncResult> {
  const budgetId = connection.BudgetID;
  const existing = runtime.services().bankSync.listLinks(budgetId, connection.Provider);
  const starts = [
    ...requests.map((r) => syncStart({ ImportFrom: r.importFrom, LastSyncAt: null })),
    ...existing.map(syncStart),
  ];
  const requested = new Set(requests.map((r) => r.remote.id));
  const set = await fetchRemoteTransactions(
    connection,
    new Date(Math.min(...starts.map((start) => start.getTime()))),
    new Set([...linkedExternalIds(existing), ...requested]),
    requested
  );
  const fetched = new Map(set.accounts.map((account) => [account.id, account]));
  const missing = requests.filter((r) => !fetched.has(r.remote.id));
  if (connection.Provider === 'enablebanking' && missing.length) {
    throw new Error(set.errors.join('\n') || t`The bank didn't return ${missing[0].remote.name}.`);
  }
  // A new account's opening balance comes from the bank's balance; without one
  // it would silently start at zero and never match the bank. Link nothing.
  const noBalance = requests.find(
    (r) => r.target.kind === 'new' && (fetched.get(r.remote.id) ?? r.remote).balance === null
  );
  if (noBalance) {
    const { name } = noBalance.remote;
    throw new Error(
      t`The bank didn't send a balance for ${name}, so Budgero can't set its opening balance. Link it to an existing account, or try again later.`
    );
  }

  for (const request of requests) {
    const remote = fetched.get(request.remote.id) ?? request.remote;
    const link = {
      provider: connection.Provider,
      externalAccountId: remote.id,
      externalName: remote.name,
      orgName: remote.orgName,
      importFrom: request.importFrom,
    };
    if (request.target.kind === 'existing') {
      await executeSpaceMutation(runtime, {
        op: 'bankSync.saveLink',
        payload: {
          budgetId,
          input: { budgetId, accountId: request.target.accountId, ...link },
        },
        meta: { label: 'bank-sync', skipUndo: true },
      });
      continue;
    }
    // One op: the account, its opening balance (cleared: it comes from the
    // bank's own balance, otherwise the cleared total never matches the bank)
    // and the link are written together, so a failure leaves no unlinked account.
    const definition = getAccountTypeDefinition(request.target.type);
    await executeSpaceMutation<Account>(runtime, {
      op: 'accounts.createLinked',
      payload: {
        name: request.target.name,
        budgetId,
        type: request.target.type,
        currency: remote.currency,
        balance: openingBalance(remote, request.importFrom),
        metadata: {},
        onBudget: definition?.budgetType !== 'always-off',
        initialBalanceDate: dayBefore(request.importFrom),
        link,
      },
      meta: { label: 'bank-sync' },
    });
  }

  return runBankSync(runtime, budgetId, {
    providers: [connection.Provider],
    prefetched: { provider: connection.Provider, set },
    trigger: 'link',
  });
}
