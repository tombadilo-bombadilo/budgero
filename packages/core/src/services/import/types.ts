export interface ImportProgress {
  step: string;
  progress: number;
  currentItem: string;
  isComplete: boolean;
  error?: string;
}

export interface YNABImportConfig {
  spaceId: string;
  budgetName: string;
  currency: string;
  numberFormat: string;
  /** ZIP source number format; an empty string detects separators from the source amounts. */
  sourceNumberFormat?: string;
  badgeIcon: string;
  /** Explicit source date order for ZIP exports whose numeric dates are ambiguous. */
  dateOrder?: 'day-first' | 'month-first';
  /** Explicit source-ID links selected for this exact API snapshot. */
  creditPaymentMappings?: YNABCreditPaymentMappings;
  /**
   * Called at import stage and batch boundaries. Returning a promise applies
   * backpressure, allowing browser clients to paint before work continues.
   */
  onProgress?: (update: YNABImportProgressUpdate) => void | Promise<void>;
}

export type YNABImportStage =
  | 'preparing'
  | 'source-verification'
  | 'categories'
  | 'accounts'
  | 'assignments'
  | 'transactions'
  | 'account-verification'
  | 'category-verification'
  | 'rta-verification'
  | 'complete';

export type YNABImportProgressStatus = 'running' | 'passed' | 'warning' | 'skipped';

export interface YNABImportProgressUpdate {
  stage: YNABImportStage;
  status: YNABImportProgressStatus;
  progress: number;
  label: string;
  detail?: string;
}

export interface YNABImportCategorySummary {
  categoryGroup: string;
  category: string;
  transactionCount: number;
}

export interface YNABSplitTransactionSummary {
  account: string;
  date: string;
  payees: string[];
  partCount: number;
}

export interface YNABImportPreview {
  /** True when the ZIP needs a date-order choice to distinguish day and month. */
  dateOrderAmbiguous?: boolean;
  /** Present only when source credit-card payment links need a user choice. */
  creditPaymentMatching?: YNABCreditPaymentMatching;
  registerRowCount: number;
  accountCount: number;
  categoryCount: number;
  missingCategories: YNABImportCategorySummary[];
  splitTransactions: YNABSplitTransactionSummary[];
}

export interface YNABCreditPaymentMappings {
  planId: string;
  serverKnowledge: number;
  byAccountId: Record<string, string>;
}

export interface YNABCreditPaymentMatching {
  planId: string;
  serverKnowledge: number;
  accounts: {
    accountId: string;
    name: string;
    balance: number;
    closed: boolean;
    note?: string;
    candidateCategoryIds: string[];
    recentTransactions: { date: string; payee: string; amount: number }[];
  }[];
  categories: {
    categoryId: string;
    name: string;
    available: number;
    assigned: number;
    note?: string;
  }[];
}

export interface YNABImportSummary {
  registerRowsImported: number;
  transactionsCreated: number;
  missingCategoriesCreated: YNABImportCategorySummary[];
  splitTransactionsImported: number;
  /** Present for API imports after every imported account balance has matched YNAB. */
  accountBalancesVerified?: number;
  /** Present for API imports after every imported month's RTA has matched YNAB. */
  readyToAssignMonthsVerified?: number;
  /** Source register rows that were accounted for by an imported row or split. */
  sourceRowsVerified?: number;
  /** Category-month values that matched YNAB after import. */
  categoryMonthsVerified?: number;
  /** YNAB category-month assignments independently confirmed by Money Movements. */
  moneyMovementAssignmentsVerified?: number;
  /** Visible ledger adjustments derived from YNAB-managed debt interest. */
  debtBalanceAdjustmentsCreated?: number;
}

export interface YNABImportResult {
  budgetId: number;
  summary: YNABImportSummary;
  /** Present for direct API imports, where YNAB supplies authoritative totals. */
  verification?: YNABReconciliationReport;
}

export interface YNABReadyToAssignCategoryCause {
  categoryGroup: string;
  category: string;
  reason: 'cash_overspend' | 'assigned_diff';
  month: string;
  amount: number;
  expectedAmount?: number;
  computedAmount?: number;
  details?: string;
}

export type YNABReadyToAssignCause = YNABReadyToAssignCategoryCause;

export interface YNABReadyToAssignMismatch {
  month: string;
  expectedReadyToAssign: number;
  computedReadyToAssign: number;
  difference: number;
  breakdown: {
    income: number;
    assignments: number;
    offBudgetTransfers: number;
    inBudgetTransfers: number;
    revaluations: number;
    priorCashOverspend: number;
    priorCashOverspendDetails?: {
      categoryId: number;
      categoryName: string;
      categoryGroupName: string;
      month: string;
      amount: number;
    }[];
  };
  /** Potential contributors from Budgero's calculation, not a proven decomposition
   * of the difference: YNAB may already include the same cash overspending. */
  affectedCategories?: YNABReadyToAssignCategoryCause[];
}

export type YNABCategoryMonthField = 'assigned' | 'activity' | 'available';

export interface YNABCategoryMonthMismatch {
  month: string;
  categoryGroup: string;
  category: string;
  field: YNABCategoryMonthField;
  expectedAmount: number;
  computedAmount: number;
  difference: number;
}

export interface YNABDebtBalanceAdjustment {
  accountName: string;
  date: string;
  amount: number;
  balanceBefore: number;
  expectedBalance: number;
}

export interface YNABReconciliationReport {
  status: 'passed' | 'warning';
  source: {
    transactions: number;
    subtransactions: number;
    registerRows: number;
    moneyMovements?: number;
    categoryAssignmentsVerified?: number;
  };
  accounts: {
    checked: number;
    matched: number;
    debtBalanceAdjustments: YNABDebtBalanceAdjustment[];
  };
  categories: {
    checked: number;
    matched: number;
    mismatches: YNABCategoryMonthMismatch[];
    allMismatches?: YNABCategoryMonthMismatch[];
    omittedMismatches: number;
  };
  readyToAssign: {
    checked: number;
    matched: number;
    mismatches: YNABReadyToAssignMismatch[];
  };
}

export interface YNABApiCurrencyFormat {
  iso_code: string;
  example_format: string;
  decimal_digits: number;
  decimal_separator: string;
  symbol_first: boolean;
  group_separator: string;
  currency_symbol: string;
  display_symbol: boolean;
}

export interface YNABApiPlanSummary {
  id: string;
  name: string;
  last_modified_on: string;
  first_month: string;
  last_month: string;
  currency_format: YNABApiCurrencyFormat | null;
}

export interface YNABApiAccount {
  id: string;
  name: string;
  type: string;
  on_budget: boolean;
  closed: boolean;
  deleted: boolean;
  balance: number;
  transfer_payee_id: string;
  note?: string | null;
  debt_original_balance?: number | null;
  debt_interest_rates?: Record<string, number>;
  debt_minimum_payments?: Record<string, number>;
  debt_escrow_amounts?: Record<string, number>;
}

export interface YNABApiCategoryGroup {
  id: string;
  name: string;
  hidden: boolean;
  deleted: boolean;
  internal: boolean;
}

export interface YNABApiCategory {
  id: string;
  category_group_id: string;
  name: string;
  hidden: boolean;
  deleted: boolean;
  internal: boolean;
  note?: string | null;
  budgeted: number;
  activity: number;
  balance: number;
  goal_type?: string | null;
  goal_target?: number | null;
  goal_target_month?: string | null;
  goal_cadence?: number | null;
  goal_cadence_frequency?: number | null;
  goal_creation_month?: string | null;
  goal_needs_whole_amount?: boolean | null;
}

export interface YNABApiMonth {
  month: string;
  deleted: boolean;
  budgeted: number;
  activity: number;
  income: number;
  to_be_budgeted: number;
  categories: YNABApiCategory[];
}

export interface YNABApiPayee {
  id: string;
  name: string;
  transfer_account_id: string | null;
  deleted: boolean;
}

export interface YNABApiTransaction {
  id: string;
  account_id: string;
  date: string;
  amount: number;
  memo: string | null;
  cleared: string;
  approved: boolean;
  payee_id: string | null;
  category_id: string | null;
  transfer_account_id: string | null;
  transfer_transaction_id: string | null;
  debt_transaction_type?: string | null;
  import_id?: string | null;
  deleted: boolean;
}

export interface YNABApiSubtransaction {
  id: string;
  transaction_id: string;
  amount: number;
  memo: string | null;
  payee_id: string | null;
  category_id: string | null;
  transfer_account_id: string | null;
  transfer_transaction_id?: string | null;
  deleted: boolean;
}

export interface YNABApiPlan extends YNABApiPlanSummary {
  accounts: YNABApiAccount[];
  category_groups: YNABApiCategoryGroup[];
  categories: YNABApiCategory[];
  months: YNABApiMonth[];
  payees: YNABApiPayee[];
  transactions: YNABApiTransaction[];
  subtransactions: YNABApiSubtransaction[];
}

export interface YNABApiPlanSnapshot {
  plan: YNABApiPlan;
  serverKnowledge: number;
  moneyMovements?: YNABApiMoneyMovement[];
}

export interface YNABApiMoneyMovement {
  id: string;
  month?: string | null;
  from_category_id: string | null;
  to_category_id: string | null;
  amount: number;
  deleted: boolean;
}

export interface YNABImportAccountSpec {
  name: string;
  type: string;
  onBudget: boolean;
  archived: boolean;
  ynabAccountId: string;
  /** Authoritative native balance supplied by the YNAB API. */
  expectedBalance?: number;
  /** Sum of exported YNAB transaction amounts before debt-engine adjustments. */
  expectedLedgerBalance?: number;
  /** Original YNAB type, used to identify balances managed by YNAB's debt engine. */
  ynabAccountType?: string;
  /** Latest exported ledger date for a visible derived debt adjustment. */
  balanceAdjustmentDate?: string;
  /** Payment category inferred from categorized transfers into this debt account. */
  linkedCategoryGroup?: string;
  linkedCategory?: string;
  linkedYNABCategoryId?: string;
  /** Unambiguous source credit payment category, when one can be identified. */
  creditPaymentYNABCategoryId?: string;
}

export interface YNABImportReadyToAssignSpec {
  month: string;
  expectedReadyToAssign: number;
}

export interface YNABImportCategoryMonthSpec {
  month: string;
  ynabCategoryId?: string;
  categoryGroup: string;
  category: string;
  expectedAssigned: number;
  expectedActivity: number;
  expectedAvailable: number;
}

export interface YNABRegisterRow {
  Account: string;
  Flag: string;
  Date: string;
  Payee: string;
  CategoryPath: string;
  CategoryGroup: string;
  Category: string;
  Memo: string;
  Outflow: string;
  Inflow: string;
  Cleared: string;
  /** Stable transfer relationship supplied by the YNAB API import path. */
  TransferID?: string;
  /** API parent transaction identity, also used for deterministic same-day ordering. */
  SourceId?: string;
  /** API account identities; display names must not be used to resolve these rows. */
  SourceAccountId?: string;
  SourceTransferAccountId?: string | null;
  /** An API split child belongs to SourceId regardless of its memo or payee. */
  SourceSubtransactionId?: string;
  SourceParentMemo?: string;
  SourceParentPayee?: string;
  SourceCategoryId?: string;
  SourceCategoryGroupId?: string;
  SourceCategoryInternal?: boolean;
  SourceCategoryGroupInternal?: boolean;
  /** Preserve a source-system transfer that intentionally did not move RTA. */
  ExcludeFromReadyToAssign?: boolean;
}

export interface YNABBudgetRow {
  Month: string;
  CategoryPath: string;
  CategoryGroup: string;
  Category: string;
  Assigned: string;
  Activity: string;
  Available: string;
  SourceCategoryId?: string;
  SourceCategoryGroupId?: string;
  SourceCategoryInternal?: boolean;
  SourceCategoryGroupInternal?: boolean;
}

// CSV/PDF Import Types
export interface ImportSource {
  type: 'csv' | 'pdf' | 'ofx' | 'qif' | 'camt';
  file: File;
  fileName: string;
}

export type ParsedRow = Record<string, string>;

export interface ParsedData {
  headers: string[];
  rows: ParsedRow[];
  source: ImportSource;
}

export interface ColumnMapping {
  date?: string;
  amount?: string;
  inflow?: string;
  outflow?: string;
  description?: string;
  memo?: string;
  payee?: string;
  account?: string;
  category?: string;
  [key: string]: string | undefined;
}

export interface ImportTemplate {
  id: string;
  name: string;
  description?: string;
  columnMapping: ColumnMapping;
  numberFormat: string;
  dateFormat: string;
  skipRows?: number;
  createdAt: string;
  updatedAt: string;
}

export type ImportSourceType = 'csv' | 'pdf' | 'ofx' | 'qif' | 'camt' | 'ynab-api' | 'ynab-zip';

export interface ImportRunSummary {
  duplicatesSkipped?: number;
  userSkipped?: number;
  invalidRows?: number;
  failedRows?: number;
  failures?: { index: number; message: string }[];
  transactionsImported: number;
  accountsCreated: number;
  categoriesCreated: number;
  verification?: YNABReconciliationReport;
  acceptedWithWarnings?: boolean;
}

export interface ImportRunRecordInput {
  runKey?: string;
  budgetId: number;
  sourceType: ImportSourceType;
  sourceName: string;
  summary: ImportRunSummary;
  transactionIds: number[];
  accountIds: number[];
  categoryIds: number[];
  status?: 'in_progress' | 'completed' | 'completed_with_warnings';
}

export interface ImportRun {
  id: number;
  budgetId: number;
  sourceType: ImportSourceType | string;
  sourceName: string;
  summary: ImportRunSummary;
  transactionIds: number[];
  accountIds: number[];
  categoryIds: number[];
  status: 'in_progress' | 'completed' | 'completed_with_warnings' | 'undone';
  createdAt: string;
}

export interface ImportRunUndoResult {
  runId: number;
  transactionsRemoved: number;
  accountsRemoved: number;
  categoriesRemoved: number;
  alreadyUndone: boolean;
}
