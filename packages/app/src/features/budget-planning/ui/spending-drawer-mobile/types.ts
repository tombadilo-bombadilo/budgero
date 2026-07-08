import type { MilliUnits } from '@budgero/core/browser';

export interface SpendingDrawerMobileProps {
  open: boolean;
  onClose: () => void;
  selectedCategory: {
    id: number;
    name: string;
  } | null;
  currentMonth: string;
}

export interface SelectedCategory {
  id: number;
  name: string;
}

export interface Transaction {
  ID: number;
  Date: string;
  Memo: string;
  Account: string;
  AccountID?: number;
  CategoryID?: number | null;
  account_id?: number;
  account_name?: string;
  Inflow: MilliUnits;
  Outflow: MilliUnits;
  Inflow_original?: MilliUnits;
  Outflow_original?: MilliUnits;
  Category?: string;
  LabelID?: number | null;
  Label?: string | null;
  LabelColor?: string | null;
  Payee?: string;
  id?: number;
  ExchangeRate?: number | null;
  ExchangeRateOverride?: boolean;
}

/** Chart-ready point: amounts are DECIMAL currency units (converted from milli at the mapping). */
export interface CumulativeDataPoint {
  date: string;
  value: number;
  cumulative: number;
  budgetPace: number;
  isOverPace: boolean;
}

export interface GoalStatus {
  percentage: number;
  isOver: boolean;
  remaining: MilliUnits;
}

export interface CategoryHeaderProps {
  selectedCategory: SelectedCategory | null;
  currentMonth: string;
  loading: boolean;
  totalSpent: MilliUnits;
  goalStatus: GoalStatus | null;
  globalLocalizer: Intl.NumberFormat;
}

export interface SpendingChartProps {
  cumulativeData: CumulativeDataPoint[];
  maxValue: number;
  shouldShowBudgetPace: boolean;
  globalLocalizer: Intl.NumberFormat;
}

export interface TransactionListProps {
  transactions: Transaction[];
  loading: boolean;
  page: number;
  rowsPerPage: number;
  collapsedDates: Set<string>;
  globalLocalizer: Intl.NumberFormat;
  onPageChange: (page: number) => void;
  onToggleDateCollapse: (dateKey: string) => void;
  onTransactionClick: (transaction: Transaction) => void;
  onRecategorize: (transaction: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
}

export interface TransactionDialogsProps {
  // Quick View Dialog
  quickViewOpen: boolean;
  quickViewTx: Transaction | null;
  onQuickViewClose: () => void;
  onQuickCommit: (
    transactionId: number,
    columnId: string,
    newVal: string | number | Date | null
  ) => void;
  isPending: boolean;
  pendingId?: number;
  globalLocalizer: Intl.NumberFormat;
  budgetId: number;

  // Confirm Delete Dialog
  confirmDeleteOpen: boolean;
  onConfirmDeleteClose: () => void;
  onOpenDeleteConfirm: () => void;
  onDeleteConfirm: () => void;
  isDeleting: boolean;

  // Recategorize Dialog
  recatOpen: boolean;
  recatTx: Transaction | null;
  onRecatClose: () => void;
  onRecategorize: (categoryId: number) => void;
}
