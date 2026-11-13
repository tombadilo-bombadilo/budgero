import { t } from '@lingui/core/macro';
import type { ReportKey } from './analytics-state';

export interface ReportMeta {
  /** Short name, shown under the question on the Reports home. */
  label: string;
  /** The household question the report answers; the report's heading. */
  question: string;
  /** One line on what the report shows, for its card on the Reports home. */
  hint: string;
}

/** Order of the prebuilt reports on the Reports home. */
export const REPORT_ORDER: ReportKey[] = [
  'wealth',
  'spending',
  'in-out',
  'plan',
  'money-map',
  'scenario',
  'ledger',
];

/** Resolved at call time so the active locale applies. */
export function reportMeta(key: ReportKey): ReportMeta {
  switch (key) {
    case 'wealth':
      return {
        label: t`Wealth`,
        question: t`Is my net worth growing?`,
        hint: t`Net worth and account balances over time`,
      };
    case 'spending':
      return {
        label: t`Spending`,
        question: t`Where does my money go?`,
        hint: t`Spending by category, payee or label`,
      };
    case 'in-out':
      return {
        label: t`In vs Out`,
        question: t`Am I living within my means?`,
        hint: t`Income against spending, month by month`,
      };
    case 'plan':
      return {
        label: t`Plan vs Reality`,
        question: t`Did my budget hold?`,
        hint: t`What you assigned against what you spent`,
      };
    case 'money-map':
      return {
        label: t`Money Map`,
        question: t`How does my money move?`,
        hint: t`Income flowing into groups and categories`,
      };
    case 'scenario':
      return {
        label: t`Scenario`,
        question: t`What if things change?`,
        hint: t`Project your balance under what-ifs`,
      };
    case 'ledger':
      return {
        label: t`Ledger`,
        question: t`What did each category do, month by month?`,
        hint: t`Every category and month in one grid`,
      };
  }
}
