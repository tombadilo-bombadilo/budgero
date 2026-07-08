import type { Services } from '../service-manager.js';
import type { GetMonthlyBudgetRow } from '../monthly-budgets/types.js';
import { getLocalDateString } from '../../utils/date.js';
import { AccountTypeEnum } from '../accounts/types.js';

export interface MonthlyBudgetData {
  month: string;
  monthName: string;
  categories: {
    group: string;
    name: string;
    assigned: number;
    activity: number;
    available: number;
  }[];
  totals: {
    assigned: number;
    activity: number;
    available: number;
  };
}

export interface RecentTransaction {
  date: string;
  payee: string;
  category: string;
  memo: string;
  inflow: number;
  outflow: number;
}

export interface BudgetContextData {
  currencySymbol: string;
  readyToAssign: number;
  accounts: {
    id: number;
    name: string;
    /** Balance in the account's own (native) currency. */
    balance: number;
    /** The account's native currency code (e.g. "EUR"). */
    currency: string;
    /** Balance converted to the budget's display currency. */
    balanceConverted: number;
    type: string;
    onBudget: boolean;
  }[];
  monthlyBudgets: MonthlyBudgetData[];
  recentTransactions: RecentTransaction[];
  uncategorizedCount: number;
}

export interface BudgetContext {
  summary: string;
  rawData: BudgetContextData;
}

function formatYearMonth(date: Date): string {
  return getLocalDateString(date).slice(0, 7);
}

function subMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() - months);
  return result;
}

function getMonthName(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Build comprehensive budget context for AI prompts
 * Includes full budget table data for better AI understanding
 */
export function buildBudgetContext(
  services: Services,
  budgetId: number,
  contextMonths = 3
): BudgetContext {
  const today = new Date();

  let currencySymbol = '$';
  try {
    const budget = services.budgets.getBudget(budgetId);
    currencySymbol = budget?.DisplayCurrency || '$';
  } catch {
    // Fallback
  }

  // Get ready to assign (don't pass a date - use default which is today)
  let readyToAssign = 0;
  try {
    readyToAssign = services.monthlyBudgets.getReadyToAssign(budgetId);
  } catch {
    // Fallback
  }

  let accounts: BudgetContextData['accounts'] = [];
  try {
    const accountsRaw = services.accounts.listAccounts(budgetId);
    accounts = accountsRaw.map((a) => ({
      id: a.ID,
      name: a.Name,
      balance: a.Balance || 0,
      currency: a.Currency || currencySymbol,
      balanceConverted: a.BalanceConverted ?? a.Balance ?? 0,
      type: a.Type || AccountTypeEnum.CHECKING,
      onBudget: Boolean(a.OnBudget),
    }));
  } catch {
    // Fallback
  }

  const monthlyBudgets: MonthlyBudgetData[] = [];
  for (let i = 0; i < contextMonths; i++) {
    const monthDate = subMonths(today, i);
    const monthStr = formatYearMonth(monthDate);

    try {
      const rows = services.monthlyBudgets.getMonthlyBudget(monthStr, budgetId);
      const budgetData = transformMonthlyBudget(rows, monthStr, monthDate);
      monthlyBudgets.push(budgetData);
    } catch {
      // Skip if not available
    }
  }

  let recentTransactions: RecentTransaction[] = [];
  let uncategorizedCount = 0;
  try {
    const allTx = services.transactions.getAllTransactions(budgetId);

    uncategorizedCount = allTx.filter(
      (t) => !t.CategoryID || t.CategoryID === 0 || t.Category === 'Uncategorized'
    ).length;

    recentTransactions = allTx
      .sort((a, b) => new Date(b.Date).getTime() - new Date(a.Date).getTime())
      .slice(0, 30)
      .map((t) => ({
        date: t.Date,
        payee: t.Payee || '',
        category: t.Category || 'Uncategorized',
        memo: t.Memo || '',
        inflow: t.Inflow || 0,
        outflow: t.Outflow || 0,
      }));
  } catch {
    // Fallback
  }

  const rawData: BudgetContextData = {
    currencySymbol,
    readyToAssign,
    accounts,
    monthlyBudgets,
    recentTransactions,
    uncategorizedCount,
  };

  const summary = buildSummaryString(rawData);

  return { summary, rawData };
}

/**
 * Transform raw monthly budget rows into structured data
 */
function transformMonthlyBudget(
  rows: GetMonthlyBudgetRow[],
  monthStr: string,
  monthDate: Date
): MonthlyBudgetData {
  const categories: MonthlyBudgetData['categories'] = [];
  let totalAssigned = 0;
  let totalActivity = 0;
  let totalAvailable = 0;

  for (const row of rows) {
    // Skip empty group placeholder rows
    if (row.CategoryID === -1 || !row.Category?.trim()) {
      continue;
    }

    categories.push({
      group: row.CategoryGroup || 'Ungrouped',
      name: row.Category,
      assigned: row.Assigned || 0,
      activity: row.Activity || 0,
      available: row.Available || 0,
    });

    totalAssigned += row.Assigned || 0;
    totalActivity += row.Activity || 0;
    totalAvailable += row.Available || 0;
  }

  return {
    month: monthStr,
    monthName: getMonthName(monthDate),
    categories,
    totals: {
      assigned: totalAssigned,
      activity: totalActivity,
      available: totalAvailable,
    },
  };
}

/**
 * Build a compact summary string for AI context
 * Uses CSV format and skips zero-value rows to minimize tokens
 */
function buildSummaryString(data: BudgetContextData): string {
  const lines: string[] = [];

  // Header. All amounts below are in DISPLAY_CURRENCY unless a row carries its
  // own currency column. Use the *_in_<display> values for any cross-account
  // math (net worth, totals) — never sum the native balances directly.
  lines.push(`DISPLAY_CURRENCY: ${data.currencySymbol}`);
  lines.push(`READY_TO_ASSIGN: ${formatCompact(data.readyToAssign)}`);
  lines.push('');

  // Accounts (CSV format). native_balance is in the account's own currency;
  // balance_in_display is converted to DISPLAY_CURRENCY for safe totalling.
  if (data.accounts.length > 0) {
    lines.push(`ACCOUNTS: name|native_balance|currency|balance_in_${data.currencySymbol}|type`);
    for (const acc of data.accounts) {
      const type = acc.onBudget ? acc.type : `${acc.type}/off-budget`;
      lines.push(
        `${acc.name}|${formatCompact(acc.balance)}|${acc.currency}|${formatCompact(acc.balanceConverted)}|${type}`
      );
    }
    lines.push('');
  }

  // Monthly budgets (CSV format, skip zero rows)
  for (const month of data.monthlyBudgets) {
    const activeCategories = month.categories.filter(
      (cat) => cat.assigned !== 0 || cat.activity !== 0 || cat.available !== 0
    );

    if (activeCategories.length === 0) continue;

    lines.push(`BUDGET ${month.monthName}: group/category|assigned|spent|available`);

    for (const cat of activeCategories) {
      lines.push(
        `${cat.group}/${cat.name}|${formatCompact(cat.assigned)}|${formatCompact(Math.abs(cat.activity))}|${formatCompact(cat.available)}`
      );
    }

    lines.push(
      `TOTAL|${formatCompact(month.totals.assigned)}|${formatCompact(Math.abs(month.totals.activity))}|${formatCompact(month.totals.available)}`
    );
    lines.push('');
  }

  // Recent transactions (compact format)
  if (data.recentTransactions.length > 0) {
    lines.push('TRANSACTIONS: date|payee|category|amount');
    for (const tx of data.recentTransactions.slice(0, 20)) {
      const amount = tx.outflow > 0 ? -tx.outflow : tx.inflow;
      const payeeOrMemo = tx.payee || tx.memo || '-';
      lines.push(`${tx.date}|${payeeOrMemo}|${tx.category}|${formatCompact(amount)}`);
    }
    if (data.recentTransactions.length > 20) {
      lines.push(`+${data.recentTransactions.length - 20} more`);
    }
    lines.push('');
  }

  // Alerts
  if (data.uncategorizedCount > 0) {
    lines.push(`UNCATEGORIZED: ${data.uncategorizedCount}`);
  }

  return lines.join('\n');
}

function formatCompact(milli: number): string {
  // Amounts arrive as integer milliunits; the LLM context speaks decimals
  const num = milli / 1000;
  // Skip decimals if whole number, otherwise 2 decimals
  if (num === Math.floor(num)) {
    return num.toString();
  }
  return num.toFixed(2);
}
