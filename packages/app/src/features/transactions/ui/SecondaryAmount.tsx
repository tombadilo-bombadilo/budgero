import { useUiStore } from '@shared/store/useUiStore';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';

interface SecondaryAmountProps {
  /** Budget-currency amount backing the primary cell, in milliunits. */
  amount: number;
  /** Original account-currency amount in milliunits; renders nothing when undefined. */
  originalAmount: number | undefined;
  /** Secondary (converted) value to display, in milliunits, from the caller's accessor. */
  value: number;
  transactionCurrencyDisplay: 'budget' | 'account';
  accountLocalizer: Intl.NumberFormat;
  globalLocalizer: Intl.NumberFormat;
  /** Account-display prefix: unsigned '~ ' (desktop table) or signed '≈ +' / '≈ -' (mobile). */
  approxPrefix: string;
  /**
   * How "differs from the original amount" is decided: 'tolerance' requires a
   * more-than-half-a-cent difference and a positive amount; 'strict' shows any
   * inequality.
   */
  compare?: 'tolerance' | 'strict';
  className?: string;
}

/**
 * Secondary (original-currency) amount line under a transaction amount.
 * Shows the budget-converted approximation in account display mode and the
 * "(X original)" note in budget display mode; hidden when the original
 * doesn't differ from the converted amount.
 */
export function SecondaryAmount({
  amount,
  originalAmount,
  value,
  transactionCurrencyDisplay,
  accountLocalizer,
  globalLocalizer,
  approxPrefix,
  compare = 'tolerance',
  className = 'text-[11px] text-muted-foreground',
}: SecondaryAmountProps) {
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);
  if (originalAmount === undefined) return null;
  const differs =
    compare === 'strict'
      ? originalAmount !== amount
      : Math.abs(originalAmount - amount) > 5 /* half a cent in milliunits */ && amount > 0;
  if (!differs) return null;

  return transactionCurrencyDisplay === 'account' ? (
    <div className={className}>
      {approxPrefix}
      {formatMaskedMilli(globalLocalizer, value, privacyMaskNumbers)}
    </div>
  ) : (
    <div className={className}>
      ({formatMaskedMilli(accountLocalizer, value, privacyMaskNumbers)} original)
    </div>
  );
}
