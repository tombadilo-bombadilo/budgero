import { parseISO } from 'date-fns';
import { toDecimal } from '@shared/lib/currency/milli';
import { roundMilli } from '@shared/lib/currency/round-amount';
import { formatDate } from '@shared/lib/date-format';

/**
 * A goal message with its {{tokens}} filled in, as plain text, for places that
 * take a string (title, aria-label). Same rules as GoalMessageFormatter:
 * numbers are milliunits, ISO dates use the locale date format.
 */
export function formatGoalText(
  message: string,
  values: Record<string, number | string> | undefined,
  formatter: Intl.NumberFormat
): string {
  return message.replace(/\{\{(\w+)\}\}/g, (token, key: string) => {
    const value = values?.[key];
    if (value === undefined) return token;
    if (typeof value === 'number') return formatter.format(toDecimal(roundMilli(value)));
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(parseISO(value), 'MMM d, yyyy');
    return value;
  });
}
