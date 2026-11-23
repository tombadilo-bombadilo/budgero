import * as React from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { asMilli } from '@shared/lib/currency/milli';
import { buildCurrencyLocalizer, useUiStore } from '@shared/store/useUiStore';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import { cn } from '@shared/lib/utils';
import type { SplitTransferAccount } from '@features/transactions/lib/split-transfer';

/**
 * The category of a split transfer line between on-budget accounts: always
 * Transfers, shown like a non-split on-budget transfer's locked category.
 */
export function SplitTransferCategoryLocked({ className }: { className?: string }) {
  const { t } = useLingui();
  return (
    <div
      className={cn(
        'h-8 w-full truncate rounded-md bg-muted/30 px-2 py-1.5 text-sm text-muted-foreground',
        className
      )}
      title={t`Category is set automatically for on-budget transfers`}
      data-testid="split-transfer-category-locked"
    >
      {t`Transfers`}
    </div>
  );
}

interface SplitReceivedAmountProps {
  target: SplitTransferAccount;
  /** The line's direction: an outflow line sends money, so the target receives it. */
  lineIsInflow: boolean;
  value: number | null | undefined;
  onCommit: (value: number) => void;
  className?: string;
}

/**
 * "Received in <account>" (or "Sent from <account>" for an inflow line): the
 * exact amount the other account got, in its own currency, like a non-split
 * cross-currency transfer's received amount. The mirror row gets this amount.
 */
export function SplitReceivedAmount({
  target,
  lineIsInflow,
  value,
  onCommit,
  className,
}: SplitReceivedAmountProps) {
  const numberFormat = useUiStore((state) => state.selectedBudget?.NumberFormat);
  const currency = target.Currency ?? '';
  const localizer = React.useMemo(
    () => buildCurrencyLocalizer(currency, numberFormat ?? '$1,096.56') ?? new Intl.NumberFormat(),
    [currency, numberFormat]
  );
  return (
    <div className={cn('flex items-center justify-end gap-2', className)}>
      <span className="text-xs text-muted-foreground">
        {lineIsInflow ? (
          <Trans>
            Sent from {target.Name} ({target.Currency})
          </Trans>
        ) : (
          <Trans>
            Received in {target.Name} ({target.Currency})
          </Trans>
        )}
      </span>
      <CalculatorCell
        value={asMilli(value ?? 0)}
        currencyCode={currency}
        onCommit={(next) => onCommit(Math.abs(next))}
        formatter={(val) => localizer.format(val)}
        displayFormatter={(val) => localizer.format(val)}
        localizer={localizer}
        useFormatterForDisplay
        inputAlign="right"
        placeholder="0.00"
        zeroAsEmpty
        className="w-32"
        inputClassName="h-8 text-right font-mono"
        displayClassName="rounded-md border border-input bg-background px-2 py-1 text-right font-mono"
        data-testid="split-received-amount"
      />
    </div>
  );
}
