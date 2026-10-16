import type {
  Account,
  Category,
  CategoryGroup,
  GetMonthlyBudgetRow,
  LabelListItem,
} from '@budgero/core/browser';

export type TransactionEditableColumn =
  | 'date'
  | 'memo'
  | 'account'
  | 'payee'
  | 'label'
  | 'category'
  | 'inflow'
  | 'outflow'
  | 'exchangeRate';

export interface TransactionEditorDirectories {
  accounts: Account[];
  categories: Category[];
  categoryGroups: CategoryGroup[];
  labels: LabelListItem[];
  payees: string[];
  /** Omit to let each category picker load Available itself while open. */
  monthlyRows?: GetMonthlyBudgetRow[];
  /** Omit to let each category picker load Ready to Assign itself while open. */
  readyToAssignAmount?: number;
}
