import React from 'react';
import { Input } from '@shared/ui/input';
import { cn } from '@shared/lib/utils';
import {
  EXCHANGE_RATE_PRECISION,
  formatExchangeRate,
} from '@entities/currency/lib/exchange-rate-format';

interface ExchangeRateCellProps {
  /** Dimensionless exchange rate (NOT money). */
  value: number;
  onCommit: (value: number) => void;
  placeholder?: string;
  className?: string;
  displayClassName?: string;
  inputClassName?: string;
}

/**
 * Inline editor for a transaction's exchange rate. Rates are dimensionless
 * decimals with up to {@link EXCHANGE_RATE_PRECISION} fraction digits, so they
 * must NOT go through CalculatorCell's integer-milliunit contract (which would
 * truncate rates like 0.008534 to 3 decimals). Plain text input, dot or comma
 * decimal separator accepted.
 */
export function ExchangeRateCell({
  value,
  onCommit,
  placeholder = '1.00',
  className,
  displayClassName,
  inputClassName,
}: ExchangeRateCellProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [text, setText] = React.useState('');

  const startEditing = () => {
    setText(value ? String(Number(value.toFixed(EXCHANGE_RATE_PRECISION))) : '');
    setIsEditing(true);
  };

  const commit = () => {
    setIsEditing(false);
    const parsed = parseFloat(text.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed >= 0 && parsed !== value) {
      onCommit(Number(parsed.toFixed(EXCHANGE_RATE_PRECISION)));
    }
  };

  const cancel = () => {
    setIsEditing(false);
    setText('');
  };

  if (isEditing) {
    return (
      <Input
        autoFocus
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            cancel();
          }
        }}
        placeholder={placeholder}
        className={cn('font-mono', inputClassName)}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      className={cn('w-full cursor-pointer font-mono', className)}
    >
      <span className={displayClassName}>{formatExchangeRate(value)}</span>
    </button>
  );
}
