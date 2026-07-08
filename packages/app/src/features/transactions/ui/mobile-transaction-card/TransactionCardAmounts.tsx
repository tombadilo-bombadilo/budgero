import React from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import type { GetTransactionsByAccountRow, TransactionSplit } from '@budgero/core/browser';
import { useUiStore } from '@shared/store/useUiStore';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';
import { getRunningBalance } from '@features/transactions/lib/running-balance';
import { SecondaryAmount } from '@features/transactions/ui/SecondaryAmount';

interface TransactionCardAmountsProps {
  transaction: GetTransactionsByAccountRow;
  currentFormatter: Intl.NumberFormat;
  accountLocalizer: Intl.NumberFormat;
  globalLocalizer: Intl.NumberFormat;
  transactionCurrencyDisplay: 'budget' | 'account';
  getPrimaryInflow: (transaction: GetTransactionsByAccountRow) => number;
  getPrimaryOutflow: (transaction: GetTransactionsByAccountRow) => number;
  getSecondaryInflow: (transaction: GetTransactionsByAccountRow) => number;
  getSecondaryOutflow: (transaction: GetTransactionsByAccountRow) => number;
  hideRunningBalance?: boolean;
  hideSecondaryAmounts?: boolean;
  // For split transactions, use the total from splits instead of filtered transaction amount
  splits?: TransactionSplit[];
  splitTotal?: number;
}

export const TransactionCardAmounts = React.memo(function TransactionCardAmounts({
  transaction,
  currentFormatter,
  accountLocalizer,
  globalLocalizer,
  transactionCurrencyDisplay,
  getPrimaryInflow,
  getPrimaryOutflow,
  getSecondaryInflow,
  getSecondaryOutflow,
  hideRunningBalance = false,
  hideSecondaryAmounts = false,
  splits = [],
  splitTotal,
}: TransactionCardAmountsProps) {
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);
  // Transaction amounts and running balances are stored milliunits.
  const formatAmount = (formatter: Intl.NumberFormat, value: number) =>
    formatMaskedMilli(formatter, value, privacyMaskNumbers);

  const balanceValue = getRunningBalance(transaction, transactionCurrencyDisplay);

  // When splits exist, use the split total for accurate display
  // This handles cases where viewing from spending overview returns only filtered split amount
  const hasSplits = splits.length > 0;
  const isInflowTransaction =
    getPrimaryInflow(transaction) > 0 || (hasSplits && splits.some((s) => s.Inflow > 0));

  const primaryInflow =
    hasSplits && splitTotal !== undefined && isInflowTransaction
      ? splitTotal
      : getPrimaryInflow(transaction);
  const primaryOutflow =
    hasSplits && splitTotal !== undefined && !isInflowTransaction
      ? splitTotal
      : getPrimaryOutflow(transaction);

  return (
    <div className="text-right">
      {/* Primary amount display */}
      <div className="text-xs font-mono font-semibold inline-flex items-center justify-end gap-1 min-[1900px]:text-sm">
        {primaryInflow > 0 ? (
          <>
            <ArrowDownRight className="h-3 w-3 text-success" />
            <span className="text-success">+{formatAmount(currentFormatter, primaryInflow)}</span>
          </>
        ) : primaryOutflow > 0 ? (
          <>
            <ArrowUpRight className="h-3 w-3 text-destructive" />
            <span className="text-destructive">
              -{formatAmount(currentFormatter, primaryOutflow)}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">{formatAmount(currentFormatter, 0)}</span>
        )}
      </div>

      {/* Secondary amount display - show when different currencies exist */}
      {!hideSecondaryAmounts && (
        <>
          <SecondaryAmount
            amount={transaction.Inflow}
            originalAmount={transaction.InflowOriginal}
            value={getSecondaryInflow(transaction)}
            transactionCurrencyDisplay={transactionCurrencyDisplay}
            accountLocalizer={accountLocalizer}
            globalLocalizer={globalLocalizer}
            approxPrefix="≈ +"
            className="text-xs text-muted-foreground font-mono"
          />
          <SecondaryAmount
            amount={transaction.Outflow}
            originalAmount={transaction.OutflowOriginal}
            value={getSecondaryOutflow(transaction)}
            transactionCurrencyDisplay={transactionCurrencyDisplay}
            accountLocalizer={accountLocalizer}
            globalLocalizer={globalLocalizer}
            approxPrefix="≈ -"
            className="text-xs text-muted-foreground font-mono"
          />
        </>
      )}

      {!hideRunningBalance && balanceValue !== null && (
        <div className="text-xs text-muted-foreground font-mono">
          Balance: {formatAmount(currentFormatter, balanceValue)}
        </div>
      )}
    </div>
  );
});
