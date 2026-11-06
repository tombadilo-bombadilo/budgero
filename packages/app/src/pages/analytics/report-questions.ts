import { t } from '@lingui/core/macro';
import type { ReportKey } from './analytics-state';

export interface ReportMeta {
  /** Short name, shown as secondary text in the picker. */
  label: string;
  /** The household question the report answers; the report's heading. */
  question: string;
}

export const reportTabId = (key: ReportKey) => `report-tab-${key}`;
export const REPORT_PANEL_ID = 'report-panel';

/** Order of the report picker. */
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
      return { label: t`Wealth`, question: t`Is my net worth growing?` };
    case 'spending':
      return { label: t`Spending`, question: t`Where does my money go?` };
    case 'in-out':
      return { label: t`In vs Out`, question: t`Am I living within my means?` };
    case 'plan':
      return { label: t`Plan vs Reality`, question: t`Did my budget hold?` };
    case 'money-map':
      return { label: t`Money Map`, question: t`How does my money move?` };
    case 'scenario':
      return { label: t`Scenario`, question: t`What if things change?` };
    case 'ledger':
      return { label: t`Ledger`, question: t`What did each category do, month by month?` };
  }
}
