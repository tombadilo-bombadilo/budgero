import * as React from 'react';

import { useAccounts } from './useAccounts';

/**
 * Fetch the non-archived accounts for a budget.
 *
 * Archived accounts remain visible in history views but are excluded from
 * pickers and reorder lists, which is what every consumer of this hook wants.
 */
export function useActiveAccounts(budgetId: number) {
  const { data, isLoading } = useAccounts(budgetId);
  const activeAccounts = React.useMemo(() => (data ?? []).filter((a) => !a.Archived), [data]);
  return { data: activeAccounts, isLoading };
}
