import { useLingui } from '@lingui/react/macro';
import { formatDate } from '@shared/lib/date-format';

/** "Mar 2026" for a YYYY-MM month, in the app language. */
export function goalMonthLabel(month: string): string {
  return formatDate(
    new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1),
    'MMM yyyy'
  );
}

/** "Since the start – May 2021", "Jun 2021 onwards", "Every month", ... */
export function useGoalRangeLabel() {
  const { t } = useLingui();
  return (from: string | null, to: string | null): string => {
    if (from === null && to === null) return t`Every month`;
    if (from === null) return t`Every month until ${goalMonthLabel(to as string)}`;
    if (to === null) return t`${goalMonthLabel(from)} onwards`;
    return t`${goalMonthLabel(from)} – ${goalMonthLabel(to)}`;
  };
}
