/**
 * Amount Input Component
 *
 * Calculator-enabled amount input with visual indicator for transaction type.
 */

import { ArrowDownUp } from 'lucide-react';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import { Label } from '@shared/ui/label';
import { usePlainNumberFormatter } from '@shared/hooks/useNumberFormatter';
import { ZERO_MILLI, type MilliUnits } from '@shared/lib/currency/milli';

import type { TransactionType } from './TransactionTypeSelector';

interface AmountInputProps {
  /** Amount in integer milliunits (CalculatorCell contract). */
  value: MilliUnits | null;
  touched: boolean;
  currencyCode: string;
  transactionType: TransactionType;
  nonce: number;
  focusSignal: number;
  globalLocalizer: Intl.NumberFormat;
  onCommit: (value: MilliUnits) => void;
  onTouched: () => void;
  onEditingChange: (editing: boolean) => void;
}

export function AmountInput({
  value,
  touched,
  currencyCode,
  transactionType,
  nonce,
  focusSignal,
  globalLocalizer,
  onCommit,
  onTouched,
  onEditingChange,
}: AmountInputProps) {
  const plainNumberFormatter = usePlainNumberFormatter(globalLocalizer);

  const handleCommit = (val: MilliUnits) => {
    onCommit(val);
    onTouched();
  };

  return (
    <div className="space-y-1.5 sm:space-y-2">
      <Label htmlFor="amount" className="text-xs sm:text-sm font-medium">
        Amount ({currencyCode})
      </Label>
      <div className="flex items-center gap-2">
        <div className="h-8 sm:h-10 w-8 flex items-center justify-center text-base sm:text-lg font-semibold">
          {transactionType === 'transfer' ? (
            <ArrowDownUp className="h-4 w-4 text-primary" />
          ) : transactionType === 'inflow' ? (
            <span className="text-success">+</span>
          ) : (
            <span className="text-destructive">−</span>
          )}
        </div>
        <div className="flex-1" data-testid="transaction-amount-input">
          <CalculatorCell
            key={nonce}
            autoFocus
            value={value ?? ZERO_MILLI}
            zeroAsEmpty
            focusSignal={focusSignal}
            onCommit={handleCommit}
            formatter={(val) => (val === 0 && !touched ? '' : plainNumberFormatter.format(val))}
            localizer={plainNumberFormatter}
            inputAlign="center"
            placeholder="100 + 25 or 150 / 2"
            className={`h-8 sm:h-10 text-sm sm:text-base font-medium ${
              transactionType === 'inflow'
                ? 'text-success'
                : transactionType === 'outflow'
                  ? 'text-destructive'
                  : ''
            }`}
            inputClassName="h-8 sm:h-10"
            displayClassName="bg-background border-input hover:bg-muted/40 py-1 rounded-md px-3"
            onEditingChange={onEditingChange}
          />
        </div>
      </div>
    </div>
  );
}
