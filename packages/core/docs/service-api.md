# Service API Reference

High-level overview of key services and their commonly used methods. Consult source under `src/services/**` for full signatures.

## ServiceManager
File: `src/services/service-manager.ts`
- initialize(database): Promise<void> — runs migrations if needed, sets up services, integrity checks
- getServices(): Services — returns all service instances
- getDatabase(): any — raw DB access (advanced)

## Budgets
File: `src/services/budgets/index.ts`
- insertBudget(name, displayCurrency, badgeIcon, numberFormat): Promise<number>
- getAllBudgets(): Budget[]
- updateBudgetName(id, name): void
- updateBudgetCurrency(id, currency): Promise<void> — triggers conversion adjustments
- updateBudgetIcon(id, icon): void
- deleteBudget(id): void
- insertDefaultCategories(budgetId): Promise<void>

## Categories
File: `src/services/categories/index.ts`
- addCategory(categoryGroupId, budgetId, name, note?): number
- getAllCategories(budgetId): Category[]
- getCategory(id): Category
- updateCategory(id, categoryGroupId, name, note): void
- moveCategoryToNewGroup(newGroupId, categoryId): void
- updateCategoryName(id, name): void
- hasAssignments(categoryId): boolean

## Accounts
File: `src/services/accounts/index.ts`
- createAccount(name, budgetId, type, currency, balance, metadata?, onBudget?): Promise<Account>
  - Auto-creates Transfers/Income categories if missing
  - Inserts initial balance transaction (or liability setup)
  - For credit cards: creates CC Payment category under "Credit Card Payments" group
  - For loans/mortgages: creates linked category under "Liabilities" group
  - See [debt-handling.md](./debt-handling.md) for details
- getAccount(id): Account
- listAccounts(budgetId): Account[]
- updateAccount(id, name, type, currency, metadata?, onBudget?): Promise<void>
  - Updates linked category names when account is renamed
- deleteAccount(id): void
  - Cascade deletes transactions and linked/CC Payment categories

## Transactions
File: `src/services/transactions/index.ts`
- addTransaction(inflowOriginal, outflowOriginal, accountId, categoryId, budgetId, date, memo, transferId?, payee?): Promise<number>
  - Maintains running balances (converted + original)
  - Auto-handles exchange rates via CurrencyService
- getAllTransactions(budgetId): GetAllTransactions[]
- getTransactionsByAccount(accountId): GetTransactionsByAccountRow[]
- getTransactionsByAccountAndMonth(accountId, month): GetTransactionsByAccountAndMonthRow[]
- getTransactionsByCategory(categoryId): Transaction[]
- getTransactionByID(id): Transaction
- updateTransaction(id, inflow, outflow, accountId, categoryId, date, memo, payee?): Promise<void>
- getDistinctPayees(budgetId): string[]
- deleteTransaction(id): void
- moveTransactionToNewAccount(transactionId, newAccountId): Promise<void>
- moveTransactionToNewCategory(transactionId, categoryId): void
- reassignTransactions(newCategoryId, oldCategoryId): void
- getTransactionsByTransferID(transferId): Transaction[]
- upsertSplits(transactionId, splits): Promise<void>
- getSplits(transactionId): TransactionSplit[]

## Currency
File: `src/services/currency/index.ts`
- getRate(from, to, month, budgetId): Promise<number|null>
- fetchAndStoreRates(fromCurrencies[], toCurrency, month, budgetId): Promise<void>
- convertAmount(amount, from, to, month, budgetId): Promise<number>
- handleBudgetCurrencyChange(budgetId, newCurrency, oldCurrency): Promise<void>
- handleAccountCurrencyChange(accountId, budgetId, newCurrency, oldCurrency): Promise<void>

## Analytics
File: `src/services/analytics/index.ts`
- getSpendingBreakdown(opts)
- getNetWorthHistory(opts)
- getMonthlyAnalytics(year, month)

## Monthly Budgets
File: `src/services/monthly-budgets/index.ts`
- getMonthlyBudget(month, budgetId): GetMonthlyBudgetRow[]
  - Returns budget rows with Assigned, Activity, Available
  - For CC Payment categories: includes `fundingBreakdown` and `totalFunded`
  - See [debt-handling.md](./debt-handling.md) for CC Payment calculations
- upsertMonthlyAssignment(categoryId, amount, month, budgetId): void
- getReadyToAssign(budgetId, asOfDate?): number
- getAssignedLastMonth(month, categoryId): number
- getAverageAssigned(categoryId): number
- batchUpsertMonthlyAssignments(assignments[]): void

## Reports
Files: `src/services/reports/*`
- Unified report interfaces and generation helpers (unified-service)

## Import / Export
Files: `src/services/import/*`, `src/services/export/*`
- Import: YNAB import service, parser helpers, and import history
- Export: CSV, report generation helpers (PDF generation orchestrated in app/server)

## Errors & Types
File: `src/types/index.ts`
- Error classes: BudgetError, ValidationError, NotFoundError
- Core entity types: Budget, Account, Category, Transaction, etc.

## Notes
- All services operate over the `DatabaseAdapter` contract and are agnostic of environment.
- Foreign keys are enforced by migrations and during service operations where relevant.
