export { SpendingDrawerMobile } from './SpendingDrawerMobile';

export type {
  SpendingDrawerMobileProps,
  SelectedCategory,
  Transaction,
  CumulativeDataPoint,
  GoalStatus,
  CategoryHeaderProps,
  SpendingChartProps,
  TransactionListProps,
  TransactionDialogsProps,
} from './types';

// Sub-components (for advanced usage)
export { CategoryHeader } from './CategoryHeader';
export { SpendingChart } from './SpendingChart';
export { TransactionList } from './TransactionList';
export { TransactionDialogs } from './TransactionDialogs';

export { useSpendingDrawerState } from './useSpendingDrawerState';

export {
  filterTransactionsByDate,
  calculateCumulativeData,
  calculateGoalStatus,
  resolveAccountIdForTx,
} from './spending-drawer.utils';

export { ROWS_PER_PAGE, CHART_CONFIG } from './constants';
