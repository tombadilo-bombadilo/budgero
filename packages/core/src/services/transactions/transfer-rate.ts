import type { DatabaseAdapter } from '../../database/interface.js';
import { allRows, run } from '../../database/sql.js';
import { convertScaled, scaledToDecimal } from '../../currencies/index.js';
import { ValidationError } from '../../types/index.js';
import { TransactionQueries } from './queries.js';

interface TransferLegRow {
  ID: number;
  TransferID: string;
  Date: string;
  BudgetID: number;
  AccountID: number;
  AccountName: string;
  AccountCurrency: string;
  BudgetCurrency: string;
  InflowNative: number;
  OutflowNative: number;
  InflowConverted: number;
  OutflowConverted: number;
  ExchangeRate: number | null;
  ExchangeRateOverride: boolean | number;
  TransferRateOverride: boolean | number;
}

export interface TransferRateDetails {
  transferId: string;
  date: string;
  budgetId: number;
  budgetCurrency: string;
  source: {
    transactionId: number;
    date: string;
    accountId: number;
    accountName: string;
    currency: string;
    amount: number;
    budgetAmount: number;
    budgetRate: number | null;
    rateOverride: boolean;
  };
  destination: {
    transactionId: number;
    date: string;
    accountId: number;
    accountName: string;
    currency: string;
    amount: number;
    budgetAmount: number;
    budgetRate: number | null;
    rateOverride: boolean;
  };
  /** Direct source-to-destination rate implied by the two native legs. */
  rate: number;
  transferRateOverride: boolean;
  /** Any override that protects this linked transfer from automatic rate changes. */
  hasRateOverride: boolean;
}

export type TransferRateResolver = (
  fromCurrency: string,
  toCurrency: string,
  date: string,
  budgetId: number
) => Promise<number | null>;

function getTransferLegs(db: DatabaseAdapter, transferId: string): TransferLegRow[] {
  return allRows<TransferLegRow>(
    db,
    `
      SELECT
        t.ID,
        t.TransferID,
        t.Date,
        t.BudgetID,
        t.AccountID,
        a.Name AS AccountName,
        a.Currency AS AccountCurrency,
        b.DisplayCurrency AS BudgetCurrency,
        t.InflowNative,
        t.OutflowNative,
        t.InflowConverted,
        t.OutflowConverted,
        t.ExchangeRate,
        t.ExchangeRateOverride,
        t.TransferRateOverride
      FROM transactions t
      JOIN accounts a ON a.ID = t.AccountID
      JOIN budgets b ON b.ID = t.BudgetID
      WHERE t.TransferID = ? AND t.TransferID != ''
      ORDER BY t.ID
    `,
    transferId
  );
}

export function getTransferRateDetails(
  db: DatabaseAdapter,
  transferId: string
): TransferRateDetails | null {
  const legs = getTransferLegs(db, transferId);
  if (legs.length !== 2) return null;

  const source = legs.find((leg) => Number(leg.OutflowNative || leg.OutflowConverted) > 0);
  const destination = legs.find((leg) => leg.ID !== source?.ID);
  if (!source || !destination) return null;

  const sourceAmount = Number(source.OutflowNative || source.OutflowConverted || 0);
  const destinationAmount = Number(destination.InflowNative || destination.InflowConverted || 0);
  const sourceDecimal = scaledToDecimal(sourceAmount, source.AccountCurrency);
  const destinationDecimal = scaledToDecimal(destinationAmount, destination.AccountCurrency);
  if (sourceDecimal <= 0 || destinationDecimal <= 0) return null;

  return {
    transferId,
    date: source.Date,
    budgetId: source.BudgetID,
    budgetCurrency: source.BudgetCurrency,
    source: {
      transactionId: source.ID,
      date: source.Date,
      accountId: source.AccountID,
      accountName: source.AccountName,
      currency: source.AccountCurrency,
      amount: sourceAmount,
      budgetAmount: Number(source.OutflowConverted || 0),
      budgetRate: source.ExchangeRate,
      rateOverride: Boolean(source.ExchangeRateOverride),
    },
    destination: {
      transactionId: destination.ID,
      date: destination.Date,
      accountId: destination.AccountID,
      accountName: destination.AccountName,
      currency: destination.AccountCurrency,
      amount: destinationAmount,
      budgetAmount: Number(destination.InflowConverted || 0),
      budgetRate: destination.ExchangeRate,
      rateOverride: Boolean(destination.ExchangeRateOverride),
    },
    rate: destinationDecimal / sourceDecimal,
    transferRateOverride: Boolean(source.TransferRateOverride || destination.TransferRateOverride),
    hasRateOverride: Boolean(
      source.TransferRateOverride ||
      destination.TransferRateOverride ||
      source.ExchangeRateOverride ||
      destination.ExchangeRateOverride
    ),
  };
}

function rateFromAmounts(
  fromAmount: number,
  toAmount: number,
  fromCurrency: string,
  toCurrency: string
): number {
  const fromDecimal = scaledToDecimal(fromAmount, fromCurrency);
  const toDecimal = scaledToDecimal(toAmount, toCurrency);
  if (fromDecimal <= 0 || toDecimal <= 0) {
    throw new ValidationError('Transfer amounts must be greater than zero');
  }
  return toDecimal / fromDecimal;
}

/**
 * Apply a direct source→destination transfer rate as one accounting operation.
 * The sent amount is the anchor and the received native amount is re-derived
 * from the direct rate. Each leg is then valued independently in the budget
 * currency. An off-market direct rate therefore records an honest FX gain/loss
 * instead of corrupting either account's account→budget rate.
 */
export async function applyTransferRate(
  db: DatabaseAdapter,
  transferId: string,
  directRate: number,
  resolveRate: TransferRateResolver,
  options: {
    sourceOverride: boolean;
    destinationOverride: boolean;
    transferOverride: boolean;
    refreshBudgetRates: boolean;
  }
): Promise<TransferRateDetails> {
  if (!Number.isFinite(directRate) || directRate <= 0) {
    throw new ValidationError('Transfer rate must be greater than zero');
  }

  const current = getTransferRateDetails(db, transferId);
  if (!current) throw new ValidationError('A transfer rate requires exactly two linked legs');
  if (current.source.currency === current.destination.currency) {
    throw new ValidationError('A transfer rate only applies to different account currencies');
  }

  const resolveBudgetRate = async (
    currency: string,
    date: string,
    currentRate: number | null,
    nativeAmount: number,
    budgetAmount: number,
    preserveCurrentOverride: boolean
  ): Promise<number> => {
    if (currency === current.budgetCurrency) return 1;
    if ((preserveCurrentOverride || !options.refreshBudgetRates) && currentRate) return currentRate;

    const resolved = await resolveRate(currency, current.budgetCurrency, date, current.budgetId);
    if (resolved) return resolved;
    if (currentRate) return currentRate;
    return rateFromAmounts(nativeAmount, budgetAmount, currency, current.budgetCurrency);
  };

  const destinationNativeAmount = convertScaled(
    current.source.amount,
    directRate,
    current.source.currency,
    current.destination.currency
  );
  const sourceBudgetRate = await resolveBudgetRate(
    current.source.currency,
    current.source.date,
    current.source.budgetRate,
    current.source.amount,
    current.source.budgetAmount,
    current.source.rateOverride && options.sourceOverride
  );
  const destinationBudgetRate = await resolveBudgetRate(
    current.destination.currency,
    current.destination.date,
    current.destination.budgetRate,
    current.destination.amount,
    current.destination.budgetAmount,
    current.destination.rateOverride && options.destinationOverride
  );
  const sourceBudgetAmount = convertScaled(
    current.source.amount,
    sourceBudgetRate,
    current.source.currency,
    current.budgetCurrency
  );
  const destinationBudgetAmount = convertScaled(
    destinationNativeAmount,
    destinationBudgetRate,
    current.destination.currency,
    current.budgetCurrency
  );
  const sourceOverride = options.sourceOverride ? 1 : 0;
  const destinationOverride = options.destinationOverride ? 1 : 0;

  db.transaction(() => {
    run(
      db,
      `
        UPDATE transactions
        SET OutflowConverted = ?, ExchangeRate = ?, ExchangeRateOverride = ?,
            TransferRateOverride = ?, ConversionPending = 0
        WHERE ID = ?
      `,
      sourceBudgetAmount,
      current.source.currency === current.budgetCurrency ? null : sourceBudgetRate,
      sourceOverride,
      options.transferOverride ? 1 : 0,
      current.source.transactionId
    );
    run(
      db,
      `
        UPDATE transactions
        SET InflowNative = ?, InflowConverted = ?, ExchangeRate = ?, ExchangeRateOverride = ?,
            TransferRateOverride = ?, ConversionPending = 0
        WHERE ID = ?
      `,
      destinationNativeAmount,
      destinationBudgetAmount,
      current.destination.currency === current.budgetCurrency ? null : destinationBudgetRate,
      destinationOverride,
      options.transferOverride ? 1 : 0,
      current.destination.transactionId
    );

    const transactionQueries = new TransactionQueries(db);
    transactionQueries.recalculateBalances(current.source.accountId);
    transactionQueries.recalculateBalances(current.destination.accountId);
    transactionQueries.resyncSplitLinesForAccounts([
      current.source.accountId,
      current.destination.accountId,
    ]);
  });

  const updated = getTransferRateDetails(db, transferId);
  if (!updated) throw new ValidationError('Transfer could not be reloaded after updating its rate');
  return updated;
}

export function getTransferIdsForCurrencyPair(
  db: DatabaseAdapter,
  fromCurrency: string,
  toCurrency: string,
  startDate: string,
  endDate: string | null,
  budgetId: number
): string[] {
  const endClause = endDate ? 'AND t.Date <= ?' : '';
  const params: (string | number)[] = [budgetId, startDate];
  if (endDate) params.push(endDate);
  params.push(fromCurrency, toCurrency, toCurrency, fromCurrency);

  return allRows<{ TransferID: string }>(
    db,
    `
      SELECT t.TransferID
      FROM transactions t
      JOIN accounts a ON a.ID = t.AccountID
      WHERE t.BudgetID = ?
        AND t.Date >= ?
        ${endClause}
        AND t.TransferID IS NOT NULL
        AND t.TransferID != ''
      GROUP BY t.TransferID
      HAVING COUNT(*) = 2
        AND (
          (MIN(a.Currency) = MIN(?, ?) AND MAX(a.Currency) = MAX(?, ?))
        )
    `,
    ...params
  ).map((row) => row.TransferID);
}
