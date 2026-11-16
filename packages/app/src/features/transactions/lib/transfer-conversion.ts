import {
  asMilli,
  convertScaled,
  isAccountOnBudget,
  resolveTransferPayees,
  type Account,
} from '@budgero/core/browser';
import {
  formatTransferMemo,
  resolveTransferCategories,
} from '@features/transactions/ui/add-transaction/add-transaction.utils';

/**
 * Turning a transaction into a transfer (and back) is composed from existing ops:
 * read the row into memory, delete it, then `transactions.addTransfer` from the copy
 * (or `transactions.deleteTransfer` then `transactions.add` to go back). These helpers
 * build those payloads the way the add form does; the ops run in `useTransferConversion`.
 */

/** The parts of a stored transaction that survive a conversion. */
export interface ConvertibleTransaction {
  ID: number;
  BudgetID: number;
  AccountID: number;
  Date: string;
  Memo: string;
  CategoryID: number;
  LabelID?: number | null;
  Cleared?: boolean | number | null;
  Reconciled?: boolean | number | null;
  InflowNative?: number | null;
  OutflowNative?: number | null;
  InflowConverted?: number | null;
  OutflowConverted?: number | null;
  ExchangeRate?: number | null;
  ExchangeRateOverride?: boolean | number | null;
  TransferID?: string | null;
}

export interface NamedCategory {
  ID: number;
  Name: string;
}

export interface TransactionLinkFlags {
  warranty: boolean;
  recurringOccurrence: boolean;
  bankReview: boolean;
}

export type ConversionBlocker =
  | 'already-transfer'
  | 'not-a-transfer'
  | 'reconciled'
  | 'split'
  | 'no-amount'
  | 'same-account'
  | 'archived-account'
  | 'warranty'
  | 'recurring-occurrence'
  | 'bank-review';

/** Payload for one leg of `transactions.addTransfer`, or for `transactions.add`. */
export interface TransferLegArgs {
  id?: number;
  inflow: number;
  outflow: number;
  accountId: number;
  categoryId: number;
  labelId: number | null;
  date: string;
  memo: string;
  payee: string;
  exchangeRateOverride: number | null;
  cleared?: boolean;
  importIdentities?: unknown[];
}

export interface AddTransferArgs {
  budgetId: number;
  transferId: string;
  source: TransferLegArgs;
  destination: TransferLegArgs;
}

const flowOf = (native?: number | null, converted?: number | null) =>
  Number(native || converted || 0);

/** Direction and exact stored amount of a transaction, in its own account currency. */
export function getTransactionFlow(transaction: ConvertibleTransaction): {
  isOutflow: boolean;
  amount: number;
} | null {
  const outflow = flowOf(transaction.OutflowNative, transaction.OutflowConverted);
  const inflow = flowOf(transaction.InflowNative, transaction.InflowConverted);
  if (outflow > 0 === inflow > 0) return null;
  return outflow > 0 ? { isOutflow: true, amount: outflow } : { isOutflow: false, amount: inflow };
}

const linkBlocker = (links: TransactionLinkFlags | null | undefined): ConversionBlocker | null => {
  if (links?.warranty) return 'warranty';
  if (links?.recurringOccurrence) return 'recurring-occurrence';
  if (links?.bankReview) return 'bank-review';
  return null;
};

/**
 * Why a plain transaction cannot be converted, or null if it can.
 *
 * Deleting and re-creating a row keeps its ID, history and import provenance (the undo
 * snapshots carry them), but warranty, recurring-occurrence and bank-review links are
 * cleared by the delete and cannot be restored, so rows that have them are not offered.
 */
export function getConversionBlocker(params: {
  transaction: ConvertibleTransaction;
  category?: string | null;
  counterpart: Pick<Account, 'ID' | 'Archived'>;
  links?: TransactionLinkFlags | null;
}): ConversionBlocker | null {
  const { transaction, category, counterpart, links } = params;
  if (transaction.TransferID?.trim()) return 'already-transfer';
  if (transaction.Reconciled) return 'reconciled';
  if (category === 'Split') return 'split';
  if (!getTransactionFlow(transaction)) return 'no-amount';
  if (counterpart.ID === transaction.AccountID) return 'same-account';
  if (counterpart.Archived) return 'archived-account';
  return linkBlocker(links);
}

/** Why a transfer cannot be turned back into a plain transaction, or null if it can. */
export function getRevertBlocker(params: {
  legs: ConvertibleTransaction[];
  transactionId: number;
  links?: TransactionLinkFlags | null;
}): ConversionBlocker | null {
  const { legs, transactionId, links } = params;
  const transferId = legs.find((leg) => leg.ID === transactionId)?.TransferID?.trim();
  if (!transferId || transferId.startsWith('split_transfer_') || legs.length !== 2) {
    return 'not-a-transfer';
  }
  if (legs.some((leg) => leg.Reconciled)) return 'reconciled';
  return linkBlocker(links);
}

/**
 * The mirrored amount in the other account's currency, computed as the add form does
 * (source amount × rate between the two account currencies). Null when a needed rate
 * is unavailable, so the caller can refuse instead of saving a wrong amount.
 */
export async function computeCounterpartAmount(params: {
  amount: number;
  ownAccount: Pick<Account, 'Currency'>;
  counterpart: Pick<Account, 'Currency'>;
  date: string;
  budgetId: number;
  getRate: (from: string, to: string, date: string, budgetId: number) => Promise<number | null>;
}): Promise<number | null> {
  const { amount, ownAccount, counterpart, date, budgetId, getRate } = params;
  if (ownAccount.Currency === counterpart.Currency) return amount;
  const rate = await getRate(ownAccount.Currency, counterpart.Currency, date, budgetId);
  if (!rate) return null;
  // money × rate crosses storage scales (crypto is sat-scale)
  return asMilli(convertScaled(amount, rate, ownAccount.Currency, counterpart.Currency));
}

/**
 * Banks convert at their own rate (plus fees), so a cross-currency leg that already
 * arrived can differ from the rate-based estimate by more than the duplicate tolerance.
 */
export const CROSS_CURRENCY_PAIR_MIN_TOLERANCE_BPS = 300;

/**
 * Where to look for the transfer's other leg when it is already in `counterpart` (both
 * sides synced or imported): the opposite direction, about `counterpartAmount`, within
 * the duplicate-transaction window and tolerance (Settings → Duplicate transactions).
 * Between accounts of one currency the two sides of a transfer are the same amount, so
 * the tolerance does not apply there (see canPairWith).
 */
export function buildPairCandidateQuery(params: {
  transaction: ConvertibleTransaction;
  ownAccount: Pick<Account, 'Currency'>;
  counterpart: Pick<Account, 'ID' | 'Currency'>;
  counterpartAmount: number;
  settings: { toleranceBps: number; dayWindow: number };
}) {
  const { transaction, ownAccount, counterpart, counterpartAmount, settings } = params;
  const flow = getTransactionFlow(transaction);
  if (!flow || !counterpartAmount) return null;
  const crossCurrency = ownAccount.Currency !== counterpart.Currency;
  return {
    accountId: counterpart.ID,
    date: transaction.Date.slice(0, 10),
    // An outflow here arrives there as an inflow, and the other way round.
    amountNative: flow.isOutflow ? counterpartAmount : -counterpartAmount,
    toleranceBps: crossCurrency
      ? Math.max(settings.toleranceBps, CROSS_CURRENCY_PAIR_MIN_TOLERANCE_BPS)
      : 0,
    dayWindow: settings.dayWindow,
    limit: 3,
    plainOnly: true,
  };
}

/**
 * Whether `candidate` can become the other leg of `transaction`'s transfer: a plain,
 * unreconciled row in the other account flowing the opposite way, with no link that
 * deleting and re-adding it would lose. With `sameCurrency` the amounts must be equal:
 * a same-currency transfer with two different sides would hide the difference.
 */
export function canPairWith(params: {
  transaction: ConvertibleTransaction;
  candidate: ConvertibleTransaction;
  links?: TransactionLinkFlags | null;
  sameCurrency?: boolean;
}): boolean {
  const { transaction, candidate, links, sameCurrency } = params;
  const own = getTransactionFlow(transaction);
  const other = getTransactionFlow(candidate);
  return Boolean(
    own &&
    other &&
    own.isOutflow !== other.isOutflow &&
    (!sameCurrency || own.amount === other.amount) &&
    candidate.ID !== transaction.ID &&
    candidate.AccountID !== transaction.AccountID &&
    !candidate.TransferID?.trim() &&
    !candidate.Reconciled &&
    !linkBlocker(links)
  );
}

/**
 * `transactions.addTransfer` payload for converting `transaction` into a transfer with
 * `counterpart`. The converted row's leg keeps its ID, cleared state, exchange-rate
 * override and import provenance; the other leg is new. Categories, payees and memo come
 * from the same helpers the add form uses.
 *
 * With `pairWith` (a row already in `counterpart`, see canPairWith) that row becomes the
 * other leg instead of a new one: it keeps its ID, date, amount, label, cleared state,
 * rate override and import provenance, so the account still matches the bank.
 */
export function buildConvertToTransferArgs(params: {
  transaction: ConvertibleTransaction;
  /** The row's category name, as shown in the register. */
  category?: string | null;
  ownAccount: Account;
  counterpart: Account;
  categories: NamedCategory[];
  transferId: string;
  /** Mirrored amount in the counterpart's currency (see computeCounterpartAmount). */
  counterpartAmount: number;
  importIdentities?: unknown[];
  pairWith?: { transaction: ConvertibleTransaction; importIdentities?: unknown[] };
}): AddTransferArgs {
  const { transaction, ownAccount, counterpart, categories, transferId, pairWith } = params;
  const flow = getTransactionFlow(transaction);
  if (!flow) throw new Error('Only transactions with a single non-zero amount can be converted.');
  const pair = pairWith?.transaction;
  const pairFlow = pair ? getTransactionFlow(pair) : null;
  if (
    pair &&
    (!pairFlow || pairFlow.isOutflow === flow.isOutflow || pair.AccountID !== counterpart.ID)
  ) {
    throw new Error(
      'The other transaction must be in the other account and flow the opposite way.'
    );
  }
  const counterpartAmount = pairFlow ? pairFlow.amount : params.counterpartAmount;

  const source = flow.isOutflow ? ownAccount : counterpart;
  const destination = flow.isOutflow ? counterpart : ownAccount;
  const sourceAmount = flow.isOutflow ? flow.amount : counterpartAmount;
  const destinationAmount = flow.isOutflow ? counterpartAmount : flow.amount;

  const { sourcePayee, destinationPayee } = resolveTransferPayees(source, destination);
  const { sourceCategory, destinationCategory } = resolveTransferCategories({
    sourceOnBudget: isAccountOnBudget(source),
    destinationOnBudget: isAccountOnBudget(destination),
    selectedCategory: params.category,
  });
  const categoryId = (name: string) => categories.find((c) => c.Name === name)?.ID ?? 0;

  const memo = formatTransferMemo({
    fromAccountName: source.Name,
    toAccountName: destination.Name,
    memo: transaction.Memo || pair?.Memo || '',
    amount: sourceAmount,
    convertedAmount: destinationAmount,
    fromCurrency: source.Currency,
    toCurrency: destination.Currency,
    needsConversion: source.Currency !== destination.Currency,
  });

  const leg = (
    side: 'source' | 'destination',
    own: boolean,
    amount: number,
    payee: string | null,
    category: string
  ): TransferLegArgs => {
    // The leg's own stored row: the converted transaction, or the paired one (if any).
    const row = own ? transaction : pair;
    return {
      ...(row ? { id: row.ID } : {}),
      inflow: side === 'destination' ? amount : 0,
      outflow: side === 'source' ? amount : 0,
      accountId: (side === 'source' ? source : destination).ID,
      categoryId: categoryId(category),
      labelId: (row ?? transaction).LabelID ?? null,
      date: (row ?? transaction).Date,
      memo,
      payee: payee ?? '',
      exchangeRateOverride: row?.ExchangeRateOverride ? (row.ExchangeRate ?? null) : null,
      cleared: row ? Boolean(row.Cleared) : false,
      ...(row
        ? {
            importIdentities: (own ? params.importIdentities : pairWith?.importIdentities) ?? [],
          }
        : {}),
    };
  };

  return {
    budgetId: transaction.BudgetID,
    transferId,
    source: leg('source', flow.isOutflow, sourceAmount, sourcePayee, sourceCategory),
    destination: leg(
      'destination',
      !flow.isOutflow,
      destinationAmount,
      destinationPayee,
      destinationCategory
    ),
  };
}

/**
 * Removes the "Source → Destination: " prefix (and the cross-currency suffix) that
 * `formatTransferMemo` adds, so a reverted row gets its own memo back. A memo that does
 * not match that shape (the user edited it) is returned untouched.
 */
export function stripTransferMemo(
  memo: string,
  fromAccountName: string,
  toAccountName: string,
  crossCurrency: boolean
): string {
  const prefix = `${fromAccountName} → ${toAccountName}`;
  let rest: string;
  if (memo === prefix) rest = '';
  else if (memo.startsWith(`${prefix}: `)) rest = memo.slice(prefix.length + 2);
  else if (crossCurrency && memo.startsWith(`${prefix} (`)) rest = memo.slice(prefix.length);
  else return memo;
  if (crossCurrency) rest = rest.replace(/\s?\([^()]* → [^()]*\)$/, '');
  return rest;
}

/**
 * `transactions.add` payload that turns the transfer leg `survivor` back into a plain
 * transaction (same ID, cleared state, rate override and provenance). The category is
 * kept only on the on-budget leg of a transfer to an off-budget account, where it is a
 * real spending/income choice; otherwise the row falls back to Uncategorized.
 */
export function buildRevertToTransactionArgs(params: {
  survivor: ConvertibleTransaction;
  ownAccount: Account;
  partnerAccount: Account;
  transfersCategoryId: number;
  importIdentities?: unknown[];
}): TransferLegArgs & { budgetId: number } {
  const { survivor, ownAccount, partnerAccount, transfersCategoryId } = params;
  const flow = getTransactionFlow(survivor);
  if (!flow) throw new Error('Only transactions with a single non-zero amount can be reverted.');

  const keepsCategory =
    isAccountOnBudget(ownAccount) &&
    !isAccountOnBudget(partnerAccount) &&
    Boolean(survivor.CategoryID) &&
    survivor.CategoryID !== transfersCategoryId;

  const source = flow.isOutflow ? ownAccount : partnerAccount;
  const destination = flow.isOutflow ? partnerAccount : ownAccount;

  return {
    id: survivor.ID,
    budgetId: survivor.BudgetID,
    inflow: flow.isOutflow ? 0 : flow.amount,
    outflow: flow.isOutflow ? flow.amount : 0,
    accountId: survivor.AccountID,
    // 0 lets core assign the budget's Uncategorized category.
    categoryId: keepsCategory ? survivor.CategoryID : 0,
    labelId: survivor.LabelID ?? null,
    date: survivor.Date,
    memo: stripTransferMemo(
      survivor.Memo,
      source.Name,
      destination.Name,
      source.Currency !== destination.Currency
    ),
    payee: '',
    exchangeRateOverride: survivor.ExchangeRateOverride ? (survivor.ExchangeRate ?? null) : null,
    cleared: Boolean(survivor.Cleared),
    importIdentities: params.importIdentities ?? [],
  };
}
