// Browser-specific entry point for @budgero/core
// Only exports web-compatible modules, excludes Node.js dependencies

// Money (integer milliunits — platform-agnostic)
export * from './money/index.js';

// Database abstractions (web-only)
export type {
  DatabaseAdapter,
  DatabaseOptions,
  LocalPersistenceCipher,
} from './database/interface.js';
export { DatabaseError } from './database/interface.js';
export { WebDatabaseAdapter } from './database/web-adapter.js';

export { MigrationRunner, getMaxSupportedSchemaVersion } from './database/migrations.js';

// Services (platform-agnostic)
export { BudgetService } from './services/budgets/index.js';
export { CategoryService } from './services/categories/index.js';
export { AccountService } from './services/accounts/index.js';
export { TransactionService } from './services/transactions/index.js';
export { GoalService } from './services/goals/index.js';
export { MonthlyBudgetService } from './services/monthly-budgets/index.js';
export { AnalyticsService } from './services/analytics/index.js';
export { RulesService } from './services/rules/index.js';
export { RecurringTransactionService } from './services/recurring/index.js';
export { DatabaseCustomDashboardService } from './services/custom-dashboards/index.js';

export { ServiceManager, type Services } from './services/service-manager.js';

// File-format parsers (pure, browser-safe). We re-export from the specific
// modules rather than the ./services/import barrel so this entry stays an
// explicit, curated surface.
export {
  parseOfx,
  ofxToImportRows,
  type ParsedOfx,
  type ParsedOfxStatement,
  type ParsedOfxTransaction,
  type OfxAccountKind,
  type OfxImportRows,
} from './services/import/ofx-parser.js';
export {
  parseQif,
  qifToImportRows,
  type ParsedQif,
  type ParsedQifSection,
  type ParsedQifTransaction,
  type QifSectionKind,
  type QifImportRows,
} from './services/import/qif-parser.js';
export {
  parseCamt,
  camtToImportRows,
  looksLikeCamt,
  type ParsedCamt,
  type ParsedCamtStatement,
  type ParsedCamtTransaction,
  type CamtImportRows,
} from './services/import/camt-parser.js';
export { decodeImportText, type DecodeResult } from './services/import/encoding.js';

export * from './types/index.js';
export type {
  UnifiedReport,
  ChartConfiguration,
  UnifiedReportService,
} from './services/reports/index.js';
export type { ScenarioRecord, SaveScenarioInput } from './services/scenarios/index.js';
export type {
  CustomDashboard,
  CustomDashboardWidget,
  DesktopWidgetLayout,
  MobileWidgetLayout,
  CustomDashboardWithWidgets,
  CustomDashboardService,
} from './services/custom-dashboards/index.js';

// Service domain types (type-only — erased at runtime, safe for any bundle).
// This is the public type surface for consumers; do not deep-import
// service internals from outside the package.
export type { Account } from './services/accounts/types.js';
export type * from './services/analytics/types.js';
export type * from './services/budgets/types.js';
export type * from './services/categories/types.js';
export type * from './services/chat/types.js';
export type { Goal } from './services/goals/types.js';
export type * from './services/import/types.js';
export type * from './services/llm-settings/types.js';
export type * from './services/monthly-budgets/types.js';
export type * from './services/mutation-history/types.js';
export type * from './services/recurring/types.js';
export type {
  RuleMode,
  RuleConditionField,
  MemoConditionOperator,
  PayeeConditionOperator,
  AmountConditionOperator,
  AccountConditionOperator,
  RuleConditionOperator,
  RuleCondition,
  RuleActionType,
  RuleAction,
  TransactionRule,
  RuleTrigger,
  RuleRunStatus,
  TransactionRuleRun,
  TransactionRuleRunChange,
  CreateRuleInput,
  UpdateRuleInput,
  CreateRuleRunInput,
  UpdateRuleRunInput,
  LogRuleRunChangeInput,
  ExecuteRuleOptions,
  RuleExecutionResult,
  RuleRunUndoResult,
  AutofillApplicationChange,
  LogAutofillApplicationInput,
  AutofillApplicationResult,
  AutofillContext,
  AutofillSuggestion,
  ComputeAutofillOptions,
} from './services/rules/index.js';
export type * from './services/transactions/types.js';
export type * from './services/warranties/types.js';

// Goal enums and pure calculations (values, browser-safe)
export {
  GoalPurpose,
  GoalType,
  getValidTypesForPurpose,
  requiresTargetDate,
  GoalCalculations,
} from './services/goals/index.js';
export type {
  GoalProgress,
  GoalStatus,
  GoalBreakdown,
  TimeMetrics,
  CategoryFinancials,
  MonthlyAssignment,
  MonthlyActivity,
} from './services/goals/calculations.js';

// Rule autofill suggestions (pure computation)
export { computeAutofillSuggestions } from './services/rules/index.js';

// Chat budget-context builder (pure computation over services)
export { buildBudgetContext, type BudgetContext } from './services/chat/context-builder.js';

// Canonical account-type vocabulary (single source of truth for accounts.Type)
export {
  AccountTypeEnum,
  LIABILITY_ACCOUNT_TYPES,
  DEBT_ACCOUNT_TYPES,
  DEFAULT_OFF_BUDGET_ACCOUNT_TYPES,
  isLiabilityAccountType,
  isCreditAccountType,
  isDebtAccountType,
  defaultOnBudgetForType,
} from './services/accounts/types.js';

// Account business calculations (pure, browser-safe)
export {
  computeLiabilityInfo,
  convertLiabilityInfoToBudgetCurrency,
  calculateTransactionStats,
  type LiabilityInfo,
  type TransactionStats,
  type MobilePageStats,
} from './services/accounts/account-calcs.js';

// CSV/PDF import pipeline (browser-safe)
export {
  parseDelimitedText,
  detectColumnMapping,
  getSeparatorsFromFormat,
  parseAmount,
  dateStringLacksYear,
} from './services/import/parsing.js';
export {
  createImportNameMaps,
  resolveImportCategoryId,
} from './services/import/category-resolver.js';
export {
  findColumnBoundaries,
  findColumnIndex,
  findHeaderRow,
  extractTablesFromPageItems,
  mergeExtractedTables,
  applyHeaderSelection,
  type ExtractedTable,
  type PDFTextItem,
} from './services/import/pdf-table.js';
export { planImportRows } from './services/import/row-planner.js';
export { YNABImportService } from './services/import/ynab-import-service.js';
