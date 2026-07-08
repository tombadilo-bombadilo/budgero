'use client';

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calculator,
  Clock,
  CreditCard,
  Home,
  PieChart,
  Plus,
  Search,
  TrendingUp,
  Wallet,
  Tag,
  ArrowRight,
  Shield,
  Palette,
  Receipt,
  LayoutGrid,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@shared/ui/command';
import {
  NAV_SETTINGS_ACCOUNT,
  NAV_SETTINGS_AUTOMATION,
  NAV_SETTINGS_DATA,
  NAV_SETTINGS_PREFERENCES,
} from '@shared/model/nav-registry';
import { focusCategoryNavState } from '@shared/hooks/useFocusCategoryFromNavState';
import { useCategories } from '@entities/category/api/useCategories';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useUiStore } from '@shared/store/useUiStore';
import { Dialog, DialogContent } from '@shared/ui/dialog';
import { AddTransactionForm } from '@features/transactions/ui/add-transaction';
import { useAddTransaction, useAllTransactions } from '@entities/transaction/api/useTransactions';
import { useTransactionCellCommit } from '@features/transactions/api/useTransactionCellCommit';
import { type TransactionColumnName as DbTransactionColumn } from '@entities/transaction/api/mutations';
import { TransactionQuickViewDialog } from '@features/transactions/ui/TransactionQuickViewDialog';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { STARTUP_INTENT_KEY } from '@shared/lib/pwa-constants';
import type {
  MilliUnits,
  GetAllTransactions,
  GetTransactionsByAccountRow,
} from '@budgero/core/browser';
import { formatMilli, toDecimal } from '@shared/lib/currency/milli';

/** Extended transaction type with account display info and optional original currency values */
interface SelectedTransactionData extends GetTransactionsByAccountRow {
  AccountID?: number;
  AccountId?: number;
  AccountName?: string;
  InflowOriginal?: MilliUnits;
  OutflowOriginal?: MilliUnits;
}

export function CommandPalette() {
  const [showTransactionDialog, setShowTransactionDialog] = React.useState(false);
  const [searchValue, setSearchValue] = React.useState('');
  const [selectedTransaction, setSelectedTransaction] =
    React.useState<SelectedTransactionData | null>(null);
  const [showTransactionView, setShowTransactionView] = React.useState(false);
  const navigate = useNavigate();

  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  const transactionCurrencyDisplay = useUiStore((state) => state.transactionCurrencyDisplay);
  const commandPaletteOpen = useUiStore((state) => state.commandPaletteOpen);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const toggleCommandPalette = useUiStore((state) => state.toggleCommandPalette);
  const budgetId = selectedBudget?.ID || 0;

  const { data: categories = [] } = useCategories(budgetId);
  const { data: accounts = [] } = useAccounts(budgetId);
  const { data: allTransactions = [] } = useAllTransactions(budgetId);
  const addTransactionMutation = useAddTransaction();
  const cellCommit = useTransactionCellCommit();

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const { code } = e; // code is layout-agnostic and unaffected by Option/Alt combos

      if (key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleCommandPalette();
      }
      if (code === 'KeyT') {
        // Browser/SaaS builds: fall back to Cmd/Ctrl+Alt+T to avoid fighting
        // the browser's reserved Cmd/Ctrl+T "new tab" shortcut.
        if ((e.metaKey || e.ctrlKey) && e.altKey) {
          e.preventDefault();
          setShowTransactionDialog(true);
        }
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [toggleCommandPalette, setShowTransactionDialog]);

  const handleNavigation = React.useCallback(
    (path: string) => {
      setCommandPaletteOpen(false);
      void navigate(path);
    },
    [navigate, setCommandPaletteOpen]
  );

  const readStartupIntent = React.useCallback((): string | null => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = window.localStorage.getItem(STARTUP_INTENT_KEY);
      if (stored) return stored;
    } catch {
      // ignore storage errors
    }
    try {
      const params = new URLSearchParams(window.location.search || '');
      return params.get('intent');
    } catch {
      return null;
    }
  }, []);

  const clearStartupIntent = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(STARTUP_INTENT_KEY);
    } catch {
      // ignore storage errors
    }
    try {
      const params = new URLSearchParams(window.location.search || '');
      if (!params.has('intent')) return;
      params.delete('intent');
      const nextSearch = params.toString();
      const nextUrl =
        window.location.pathname + (nextSearch ? `?${nextSearch}` : '') + window.location.hash;
      window.history.replaceState(null, document.title, nextUrl);
    } catch {
      // ignore history/url errors
    }
  }, []);

  const executeStartupIntent = React.useCallback(
    (intent: string): boolean => {
      if (intent === 'new-transaction') {
        // Wait until a budget is selected before opening transaction form.
        if (!budgetId) return false;
        setShowTransactionDialog(true);
        return true;
      }
      if (intent === 'open-budget') {
        handleNavigation('/budgeting');
        return true;
      }
      if (intent === 'open-accounts') {
        handleNavigation('/accounts');
        return true;
      }
      if (intent === 'open-reports') {
        handleNavigation('/reports/prebuilt');
        return true;
      }
      return true;
    },
    [budgetId, handleNavigation]
  );

  // Startup intents: handle any deferred "open X" actions once the
  // app shell (and guards like master password) are fully initialized.
  // External integrations (e.g., desktop wrapper) can set a flag before
  // the app loads and this effect will execute it exactly once.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const processIntent = (preferredIntent?: string) => {
      const intent = preferredIntent ?? readStartupIntent();
      if (!intent) return;
      const handled = executeStartupIntent(intent);
      if (handled) clearStartupIntent();
    };

    processIntent();

    const handleIntentEvent: EventListener = (event) => {
      const customEvent = event as CustomEvent<{ intent?: string }>;
      processIntent(customEvent.detail?.intent);
    };

    window.addEventListener('budgero-startup-intent', handleIntentEvent);
    return () => {
      window.removeEventListener('budgero-startup-intent', handleIntentEvent);
    };
  }, [clearStartupIntent, executeStartupIntent, readStartupIntent, budgetId]);

  const handleCategoryNavigation = React.useCallback(
    (categoryName: string) => {
      setCommandPaletteOpen(false);
      const categoryToExpand = categories.find((cat) => cat.Name === categoryName);
      if (categoryToExpand) {
        // Navigate with state to tell the budgeting page which category to expand
        void navigate('/budgeting', { state: focusCategoryNavState(categoryToExpand.ID) });
      } else {
        void navigate('/budgeting');
      }
    },
    [navigate, categories, setCommandPaletteOpen]
  );

  const handleAccountNavigation = React.useCallback(
    (accountId: number) => {
      setCommandPaletteOpen(false);
      void navigate(`/accounts/${accountId}`);
    },
    [navigate, setCommandPaletteOpen]
  );

  const handleTransactionView = React.useCallback(
    (transaction: GetAllTransactions) => {
      const accountName =
        transaction.AccountName ||
        accounts.find((account) => account.ID === transaction.AccountId)?.Name ||
        '';
      setSelectedTransaction({
        ID: transaction.ID,
        Date: transaction.Date,
        CategoryID: transaction.CategoryID,
        Category: transaction.Category,
        Memo: transaction.Memo,
        Reconciled: false,
        Inflow: transaction.Inflow,
        Outflow: transaction.Outflow,
        RunningBalance: transaction.RunningBalance ?? null,
        TransferID: transaction.TransferID,
        Payee: transaction.Payee,
        Account: accountName,
        AccountID: transaction.AccountId ?? 0,
        AccountId: transaction.AccountId ?? 0,
        AccountName: transaction.AccountName,
      });
      setCommandPaletteOpen(false);
      setShowTransactionView(true);
    },
    [accounts, setCommandPaletteOpen]
  );

  const handleTransactionCellCommit = React.useCallback(
    (transactionId: number, columnId: string, newVal: string | number | Date | null) => {
      if (!selectedTransaction) return;
      const accountId = selectedTransaction.AccountId ?? selectedTransaction.AccountID ?? 0;
      const patch = cellCommit.mutate(transactionId, columnId as DbTransactionColumn, newVal, {
        accountId,
      });
      if (!patch) return;
      setSelectedTransaction((prev) =>
        prev ? ({ ...prev, ...patch } as SelectedTransactionData) : prev
      );
    },
    [selectedTransaction, cellCommit]
  );

  const currentFormatter = globalLocalizer;
  const getPrimaryInflow = React.useCallback(
    (transaction: { Inflow: number; InflowOriginal?: number }) => {
      return transactionCurrencyDisplay === 'budget'
        ? transaction.Inflow
        : transaction.InflowOriginal || transaction.Inflow;
    },
    [transactionCurrencyDisplay]
  );
  const getPrimaryOutflow = React.useCallback(
    (transaction: { Outflow: number; OutflowOriginal?: number }) => {
      return transactionCurrencyDisplay === 'budget'
        ? transaction.Outflow
        : transaction.OutflowOriginal || transaction.Outflow;
    },
    [transactionCurrencyDisplay]
  );
  const getSecondaryInflow = React.useCallback(
    (transaction: { Inflow: number; InflowOriginal?: number }) => {
      return transactionCurrencyDisplay === 'budget'
        ? transaction.InflowOriginal || transaction.Inflow
        : transaction.Inflow;
    },
    [transactionCurrencyDisplay]
  );
  const getSecondaryOutflow = React.useCallback(
    (transaction: { Outflow: number; OutflowOriginal?: number }) => {
      return transactionCurrencyDisplay === 'budget'
        ? transaction.OutflowOriginal || transaction.Outflow
        : transaction.Outflow;
    },
    [transactionCurrencyDisplay]
  );

  const handleAddTransaction = async (
    date: Date | null,
    category: string,
    memo: string,
    payee: string,
    outflow: number,
    inflow: number,
    accountId: number,
    labelId: number | null,
    transferId: string | null
  ): Promise<number> => {
    const categoryObject = categories.find((cat) => cat.Name === category);
    const categoryId = categoryObject?.ID || 0;

    const transactionDate = date
      ? date.toLocaleDateString('en-CA')
      : new Date().toLocaleDateString('en-CA');

    const id = await addTransactionMutation.mutateAsync({
      inflow,
      outflow,
      accountId,
      categoryId,
      labelId,
      budgetId,
      date: transactionDate,
      memo,
      payee,
      transferId: transferId || '',
    });

    setShowTransactionDialog(false);
    return id;
  };

  const isSearching = searchValue.length > 0;

  const displayedCategories = React.useMemo(() => {
    if (isSearching) {
      return categories; // Show all when searching
    }
    return categories.slice(0, 5); // Show top 5 when not searching
  }, [categories, isSearching]);

  const displayedAccounts = React.useMemo(() => {
    if (isSearching) {
      return accounts; // Show all when searching
    }
    return accounts.slice(0, 5); // Show top 5 when not searching
  }, [accounts, isSearching]);

  const displayedTransactions = React.useMemo(() => {
    if (!isSearching || !searchValue) {
      return []; // Don't show transactions when not searching
    }

    const searchLower = searchValue.toLowerCase();

    const filtered = allTransactions.filter((transaction) => {
      const memo = (transaction.Memo || '').toLowerCase();
      const category = (transaction.Category || '').toLowerCase();
      const payee = (transaction.Payee || '').toLowerCase();
      const amount = transaction.Inflow > 0 ? transaction.Inflow : transaction.Outflow;
      // Stored amounts are milliunits; match against the decimal the user types.
      const amountStr = toDecimal(amount).toFixed(2);

      return (
        memo.includes(searchLower) ||
        category.includes(searchLower) ||
        payee.includes(searchLower) ||
        amountStr.includes(searchLower)
      );
    });

    return filtered
      .sort((a, b) => new Date(b.Date).getTime() - new Date(a.Date).getTime())
      .slice(0, 50);
  }, [allTransactions, isSearching, searchValue]);

  return (
    <>
      <CommandDialog
        open={commandPaletteOpen}
        onOpenChange={(newOpen) => {
          setCommandPaletteOpen(newOpen);
          if (!newOpen) {
            setSearchValue(''); // Clear search when closing
          }
        }}
      >
        <CommandInput
          placeholder="Type a command or search..."
          value={searchValue}
          onValueChange={setSearchValue}
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {/* Quick Actions */}
          <CommandGroup heading="Quick Actions">
            <CommandItem
              onSelect={() => {
                setCommandPaletteOpen(false);
                setShowTransactionDialog(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              <span>Add Transaction</span>
              {/* Handler listens for (Cmd|Ctrl)+Alt+T — plain Cmd/Ctrl+T is
                  reserved by the browser for "new tab" and can't be overridden. */}
              <CommandShortcut>⌥⌘T</CommandShortcut>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          {/* Main Pages */}
          <CommandGroup heading="Pages">
            <CommandItem onSelect={() => handleNavigation('/dashboard')}>
              <Home className="mr-2 h-4 w-4" />
              <span>Dashboard</span>
            </CommandItem>
            <CommandItem onSelect={() => handleNavigation('/budgeting')}>
              <Calculator className="mr-2 h-4 w-4" />
              <span>Budget Planning</span>
            </CommandItem>
            <CommandItem onSelect={() => handleNavigation('/accounts')}>
              <Wallet className="mr-2 h-4 w-4" />
              <span>Accounts</span>
            </CommandItem>
            <CommandItem onSelect={() => handleNavigation('/reports/prebuilt')}>
              <PieChart className="mr-2 h-4 w-4" />
              <span>Reports</span>
            </CommandItem>
            <CommandItem onSelect={() => handleNavigation('/reports/explorer')}>
              <TrendingUp className="mr-2 h-4 w-4" />
              <span>Explorer</span>
            </CommandItem>
            <CommandItem onSelect={() => handleNavigation('/reports/dashboards')}>
              <LayoutGrid className="mr-2 h-4 w-4" />
              <span>Custom Dashboards</span>
            </CommandItem>
            <CommandItem onSelect={() => handleNavigation('/settings/recurring')}>
              <Clock className="mr-2 h-4 w-4" />
              <span>Recurring</span>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          {/* Settings Pages — sourced from the shared nav registry so routes/icons/labels
              stay in sync with the sidebar and mobile nav. */}
          <CommandGroup heading="Settings">
            <CommandItem onSelect={() => handleNavigation('/settings/appearance')}>
              <Palette className="mr-2 h-4 w-4" />
              <span>Appearance</span>
            </CommandItem>
            {!IS_SELF_HOSTABLE_BUILD &&
              NAV_SETTINGS_ACCOUNT.map((item) => (
                <CommandItem key={item.to} onSelect={() => handleNavigation(item.to)}>
                  <item.icon className="mr-2 h-4 w-4" />
                  <span>{item.label}</span>
                </CommandItem>
              ))}
            {IS_SELF_HOSTABLE_BUILD && (
              <CommandItem onSelect={() => handleNavigation('/settings/security')}>
                <Shield className="mr-2 h-4 w-4" />
                <span>Security & Privacy</span>
              </CommandItem>
            )}
            {NAV_SETTINGS_DATA.map((item) => (
              <CommandItem key={item.to} onSelect={() => handleNavigation(item.to)}>
                <item.icon className="mr-2 h-4 w-4" />
                <span>{item.label}</span>
              </CommandItem>
            ))}
            {NAV_SETTINGS_AUTOMATION.map((item) => (
              <CommandItem key={item.to} onSelect={() => handleNavigation(item.to)}>
                <item.icon className="mr-2 h-4 w-4" />
                <span>{item.label}</span>
              </CommandItem>
            ))}
            {NAV_SETTINGS_PREFERENCES.filter((item) => item.to !== '/settings/appearance').map(
              (item) => (
                <CommandItem key={item.to} onSelect={() => handleNavigation(item.to)}>
                  <item.icon className="mr-2 h-4 w-4" />
                  <span>{item.label}</span>
                </CommandItem>
              )
            )}
          </CommandGroup>

          <CommandSeparator />

          {/* Categories */}
          {categories.length > 0 && (
            <>
              <CommandGroup heading="Categories">
                {displayedCategories.map((category) => (
                  <CommandItem
                    key={category.ID}
                    value={`category-${category.Name}`}
                    onSelect={() => handleCategoryNavigation(category.Name)}
                  >
                    <Tag className="mr-2 h-4 w-4" />
                    <span>{category.Name}</span>
                    <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
                  </CommandItem>
                ))}
                {!isSearching && categories.length > 5 && (
                  <CommandItem
                    onSelect={() => handleNavigation('/budgeting')}
                    className="text-muted-foreground"
                  >
                    <Search className="mr-2 h-4 w-4" />
                    <span>View all categories...</span>
                  </CommandItem>
                )}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          {/* Accounts */}
          {accounts.length > 0 && (
            <CommandGroup heading="Accounts">
              {displayedAccounts.map((account) => (
                <CommandItem
                  key={account.ID}
                  value={`account-${account.Name}`}
                  onSelect={() => handleAccountNavigation(account.ID)}
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  <span>{account.Name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{account.Currency}</span>
                </CommandItem>
              ))}
              {!isSearching && accounts.length > 5 && (
                <CommandItem
                  onSelect={() => handleNavigation('/accounts')}
                  className="text-muted-foreground"
                >
                  <Search className="mr-2 h-4 w-4" />
                  <span>View all accounts...</span>
                </CommandItem>
              )}
            </CommandGroup>
          )}

          {/* Transactions - Only show when searching */}
          {displayedTransactions.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Recent Transactions">
                {displayedTransactions.map((transaction) => {
                  const rawAmount =
                    transaction.Inflow > 0 ? transaction.Inflow : transaction.Outflow;
                  const isPositive = transaction.Inflow > 0;
                  // Format the absolute value and add sign manually to ensure it's on the same line
                  const formattedAmount = formatMilli(globalLocalizer, rawAmount);
                  const amount = isPositive ? `+${formattedAmount}` : `-${formattedAmount}`;
                  const date = new Date(transaction.Date).toLocaleDateString();

                  return (
                    <CommandItem
                      key={transaction.ID}
                      value={`transaction-${transaction.Memo}-${transaction.Category}-${amount}`}
                      onSelect={() => handleTransactionView(transaction)}
                    >
                      <Receipt className="mr-2 h-4 w-4" />
                      <div className="flex flex-1 items-center justify-between">
                        <div>
                          <span className="font-medium">{transaction.Memo || 'No memo'}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {transaction.Category}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`whitespace-nowrap font-mono text-sm ${isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                          >
                            {amount}
                          </span>
                          <span className="text-xs text-muted-foreground">{date}</span>
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>

      {/* Add Transaction Dialog */}
      <Dialog open={showTransactionDialog} onOpenChange={setShowTransactionDialog}>
        <DialogContent onInteractOutside={(e) => e.preventDefault()}>
          <AddTransactionForm
            budgetId={budgetId}
            onAddTransaction={handleAddTransaction}
            onCancel={() => setShowTransactionDialog(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Transaction View Dialog */}
      <TransactionQuickViewDialog
        open={showTransactionView}
        onOpenChange={setShowTransactionView}
        transaction={selectedTransaction}
        budgetId={budgetId}
        globalLocalizer={globalLocalizer}
        currentFormatter={currentFormatter}
        transactionCurrencyDisplay={transactionCurrencyDisplay}
        getPrimaryInflow={getPrimaryInflow}
        getPrimaryOutflow={getPrimaryOutflow}
        getSecondaryInflow={getSecondaryInflow}
        getSecondaryOutflow={getSecondaryOutflow}
        onCellCommit={handleTransactionCellCommit}
        isPending={cellCommit.isPending}
        pendingId={cellCommit.pendingId}
        footer={
          selectedTransaction ? (
            <div className="pt-3 pb-4">
              <div className="text-center text-xs text-muted-foreground">
                Transaction from {new Date(selectedTransaction.Date).toLocaleDateString()}
              </div>
            </div>
          ) : null
        }
      />
    </>
  );
}
