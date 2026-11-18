import { Trans, useLingui } from '@lingui/react/macro';
import React from 'react';
import { Input } from '@shared/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@shared/ui/popover';
import { cn } from '@shared/lib/utils';
import { evaluateExpression } from '@shared/ui/calculator-cell/calculator-utils';
import {
  formatExchangeRate,
  isUnusualExchangeRateChange,
} from '@entities/currency/lib/exchange-rate-format';

interface ExchangeRateCellProps {
  /** Dimensionless exchange rate (NOT money). */
  value: number;
  onCommit: (value: number) => void;
  placeholder?: string;
  className?: string;
  displayClassName?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  onEditingChange?: (editing: boolean) => void;
  validateRate?: (rate: number) => string | null;
}

function parseRate(text: string): number {
  const normalized = text.trim().replace(/,/g, '.');
  const plain = Number(normalized);
  if (normalized && Number.isFinite(plain)) return plain;
  return evaluateExpression(normalized) ?? NaN;
}

/**
 * Inline editor for a transaction's exchange rate. Rates are dimensionless
 * decimals, so they must NOT go through CalculatorCell's integer-milliunit
 * contract. Plain numbers or calculator expressions (e.g. `9428.45 / 79.34`) with
 * either a dot or comma decimal separator are accepted, and parsed precision is
 * preserved instead of rounded on commit.
 */
export function ExchangeRateCell({
  value,
  onCommit,
  placeholder = '1.00',
  className,
  displayClassName,
  inputClassName,
  autoFocus = false,
  onEditingChange,
  validateRate,
}: ExchangeRateCellProps) {
  const { t } = useLingui();

  const [isEditing, setIsEditing] = React.useState(autoFocus);
  const [text, setText] = React.useState(() => (autoFocus && value ? String(value) : ''));
  const [error, setError] = React.useState<string | null>(null);
  const [pendingUnusualRate, setPendingUnusualRate] = React.useState<number | null>(null);
  const errorId = React.useId();

  const startEditing = () => {
    // Keep the stored precision while editing. Formatting to the input's
    // commit precision here makes a focus/blur cycle look like a real edit.
    setText(value ? String(value) : '');
    setError(null);
    setPendingUnusualRate(null);
    setIsEditing(true);
    onEditingChange?.(true);
  };

  const finishCommit = (parsed: number) => {
    setIsEditing(false);
    onEditingChange?.(false);
    setError(null);
    setPendingUnusualRate(null);
    if (parsed !== value) onCommit(parsed);
  };

  const commit = (confirmUnusual = false) => {
    const parsed = parseRate(text);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError(t`Enter an exchange rate greater than zero.`);
      setPendingUnusualRate(null);
      return;
    }

    const validationError = validateRate?.(parsed) ?? null;
    if (validationError) {
      setError(validationError);
      setPendingUnusualRate(null);
      return;
    }

    if (!confirmUnusual && parsed !== value && isUnusualExchangeRateChange(value, parsed)) {
      setPendingUnusualRate(parsed);
      setError(t`This rate is over 1,000× different. Check the decimal point or confirm it.`);
      return;
    }

    finishCommit(parsed);
  };

  const cancel = () => {
    setIsEditing(false);
    onEditingChange?.(false);
    setText('');
    setError(null);
    setPendingUnusualRate(null);
  };

  if (isEditing) {
    return (
      // The error renders in a portal so a narrow table column can't clip it.
      <Popover open={Boolean(error)}>
        <PopoverAnchor asChild>
          <div className="w-full min-w-0">
            <Input
              autoFocus
              type="text"
              inputMode="decimal"
              value={text}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
                setPendingUnusualRate(null);
              }}
              onBlur={() => commit(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit(pendingUnusualRate !== null);
                } else if (e.key === 'Escape') {
                  cancel();
                }
              }}
              placeholder={placeholder}
              className={cn('font-mono', inputClassName)}
            />
          </div>
        </PopoverAnchor>
        {error && (
          <PopoverContent
            id={errorId}
            side="bottom"
            align="end"
            onOpenAutoFocus={(event) => event.preventDefault()}
            className="w-56 p-2 text-left text-[0.6875rem] leading-tight text-destructive"
          >
            <p>{error}</p>
            {pendingUnusualRate !== null && (
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  className="font-medium underline underline-offset-2"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => finishCommit(pendingUnusualRate)}
                >
                  <Trans>Use anyway</Trans>
                </button>
                <button
                  type="button"
                  className="text-muted-foreground underline underline-offset-2"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={cancel}
                >
                  <Trans>Cancel</Trans>
                </button>
              </div>
            )}
          </PopoverContent>
        )}
      </Popover>
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
