# Debt Account Handling

This document explains how Budgero handles debt accounts (credit cards, loans, and mortgages) using YNAB-style envelope budgeting mechanics.

## Overview

Budgero supports three types of debt accounts:
- **Credit Cards** (`credit`) - Revolving debt with special payment tracking
- **Loans** (`loan`) - Installment debt like personal or auto loans
- **Mortgages** (`mortgage`) - Real estate debt

Each type has slightly different handling to match real-world usage patterns.

## Credit Card Handling

Credit cards use YNAB-style "Credit Card Payment" categories that automatically track how much money you have available to pay your card.

### How It Works

1. **When you create a credit card account:**
   - A "Credit Card Payments" category group is created (if it doesn't exist)
   - A payment category named after your card is created (e.g., "Chase CC")
   - The `cc_payment_category_id` is stored in the account's metadata

2. **When you spend on the credit card:**
   - The transaction is categorized normally (e.g., "Groceries")
   - Money is automatically "funded" from that category to your CC Payment category
   - **Important:** Only budgeted spending funds the CC Payment category

3. **When you pay the credit card:**
   - Create a transfer from your checking account to the credit card
   - The payment shows as negative Activity in the CC Payment category
   - Available decreases by the payment amount

### The Funding Formula

When you make a purchase of amount `A` in category `C`:

```
funded_from_C = min(A, max(0, C.available + A))
```

Where `C.available + A` represents what the category's Available would be *without* the CC spending (the "budget ceiling").

**Examples:**

| Groceries Budget | CC Spend | Funded to CC Payment | CC Debt Created |
|------------------|----------|----------------------|-----------------|
| $100             | $50      | $50                  | $0              |
| $100             | $150     | $100                 | $50             |
| $0               | $50      | $0                   | $50             |
| $30              | $50      | $30                  | $20             |

### CC Payment Category Calculation

```
Available = Assigned + Funded (from budgeted spending) - Payments
Activity = -Payments (negative, money leaving the envelope)
```

### Viewing Funding Sources

The CC Payment category includes a `fundingBreakdown` array showing exactly which categories contributed:

```typescript
{
  Category: "Chase CC",
  Available: 90,
  totalFunded: 90,
  fundingBreakdown: [
    { categoryId: 5, categoryName: "Groceries", amount: 60 },
    { categoryId: 6, categoryName: "Gas", amount: 30 }
  ]
}
```

This is displayed in the UI via the info popover on the Available column.

### Legacy Debt

If you have existing credit card debt when you start using Budgero:
- The initial debt is recorded as an outflow using the "Transfers" category
- This affects only the account balance, not any budget category
- To pay down legacy debt, assign money directly to the CC Payment category
- When you pay more than what's "funded," Available goes negative (showing you're paying down old debt)

## Loan and Mortgage Handling

Loans and mortgages work differently from credit cards because the payment itself IS the expense (unlike CC where spending is categorized when you swipe the card).

### How It Works

1. **When you create a loan/mortgage account:**
   - A "Liabilities" category group is created (if it doesn't exist)
   - A linked category named after the account is created (e.g., "Home Mortgage")
   - The `linked_category_id` is stored in the account's metadata

2. **Initial debt setup:**
   - `debt_total` in metadata records the original loan amount
   - `paid_so_far` in metadata records prior payments (if importing mid-loan)
   - Initial transactions use "Transfers" category (doesn't affect budget)

3. **When you make a payment:**
   - Create a transfer from your checking account to the loan account
   - The source transaction is categorized under the linked category
   - This creates actual spending in your budget

### On-Budget vs Off-Budget

- **On-budget debt accounts:** Payments affect your budget categories
- **Off-budget debt accounts:** Use regular "Transfers" category (tracking only)

Mortgages and "other asset" accounts default to off-budget since they're typically long-term tracking items.

## Account Metadata

Debt accounts store important information in the `Metadata` JSON field:

```typescript
{
  // For credit cards
  cc_payment_category_id: 123,

  // For loans/mortgages
  linked_category_id: 456,
  liability: true,
  debt_total: 250000,      // Original loan amount
  paid_so_far: 50000       // Prior payments
}
```

## API Reference

### Creating a Debt Account

```typescript
// Credit card with no initial balance
const cc = await accounts.createAccount(
  'Chase CC',
  budgetId,
  'credit',
  'USD',
  0,
  { debt_total: 0 }
);

// Credit card with existing debt
const cc = await accounts.createAccount(
  'Chase CC',
  budgetId,
  'credit',
  'USD',
  0,
  { debt_total: 500 }  // $500 existing debt
);

// Mortgage
const mortgage = await accounts.createAccount(
  'Home Mortgage',
  budgetId,
  'mortgage',
  'USD',
  0,
  {
    debt_total: 250000,
    paid_so_far: 50000
  }
);
```

### Making a CC Payment (Transfer)

```typescript
const transferId = `cc_pay_${Date.now()}`;

// Outflow from checking
await transactions.addTransaction(
  0, 100,           // $100 outflow
  checkingId,
  transfersCategoryId,
  budgetId,
  '2024-01-15',
  'CC Payment',
  transferId
);

// Inflow to credit card
await transactions.addTransaction(
  100, 0,           // $100 inflow
  ccAccountId,
  transfersCategoryId,
  budgetId,
  '2024-01-15',
  'CC Payment',
  transferId
);
```

### Monthly Budget Response

For CC Payment categories, `getMonthlyBudget` returns:

```typescript
interface GetMonthlyBudgetRow {
  Category: string;
  CategoryID: number;
  Assigned: number;
  Activity: number;      // Negative = payments made
  Available: number;     // Assigned + Funded - Payments

  // CC Payment specific fields
  fundingBreakdown?: FundingSource[];
  totalFunded?: number;
}

interface FundingSource {
  categoryId: number;
  categoryName: string;
  amount: number;
}
```

## Common Scenarios

### Scenario 1: Fully Budgeted CC Spending

1. Budget $100 to Groceries
2. Spend $80 on CC at grocery store
3. Result:
   - Groceries: Available = $20
   - CC Payment: Available = $80 (funded from Groceries)

### Scenario 2: Overspent CC Purchase

1. Budget $50 to Dining
2. Spend $75 on CC at restaurant
3. Result:
   - Dining: Available = -$25 (overspent)
   - CC Payment: Available = $50 (only budgeted portion)
   - CC Debt: $25 (the overspent amount)

### Scenario 3: Paying Down Legacy Debt

1. Start with $500 CC debt, $0 in CC Payment category
2. Assign $200 to CC Payment category
3. Pay $200 to CC
4. Result:
   - CC Payment: Available = $0 (200 assigned - 200 paid)
   - CC Balance: -$300 (500 debt - 200 payment)

### Scenario 4: Overpaying the Card

1. CC Payment Available = $100
2. Pay $150 to CC
3. Result:
   - CC Payment: Available = -$50 (paid more than set aside)
   - This negative shows you're paying down old debt

## Deleting Debt Accounts

When a debt account is deleted:
- All transactions are cascade-deleted
- The linked category (for loans/mortgages) is deleted
- The CC Payment category (for credit cards) is deleted

## Files Reference

- `packages/core/src/services/accounts/index.ts` - Account creation with debt setup
- `packages/core/src/services/monthly-budgets/index.ts` - CC Payment calculations
- `packages/core/src/services/monthly-budgets/queries.ts` - SQL queries for funding
- `packages/core/src/services/monthly-budgets/types.ts` - FundingSource type
- `packages/app/src/components/features/budget_planing/*/AvailableInfoPopover.tsx` - UI display
