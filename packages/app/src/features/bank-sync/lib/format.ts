import { currencyDisplayFor } from '@shared/lib/number-format';
import { toDecimal, type MilliUnits } from '@budgero/core/browser';
import { getLocaleTag } from '@shared/i18n';
import { formatRelativeToNow } from '@shared/lib/date-format';

export function formatBankAmount(milli: number, currency: string): string {
  try {
    return new Intl.NumberFormat(getLocaleTag(), {
      style: 'currency',
      currency,
      currencyDisplay: currencyDisplayFor(currency),
    }).format(toDecimal(milli as MilliUnits));
  } catch {
    return `${toDecimal(milli as MilliUnits).toFixed(2)} ${currency}`;
  }
}

export function formatSignedIdentity(
  identity: { inflow: number; outflow: number },
  currency: string
) {
  return formatBankAmount(identity.inflow - identity.outflow, currency);
}

export function formatSyncedAgo(at: string | null | undefined): string | null {
  return at ? formatRelativeToNow(new Date(at), { addSuffix: true }) : null;
}
