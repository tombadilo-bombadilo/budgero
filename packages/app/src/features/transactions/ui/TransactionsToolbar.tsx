import { Trans, useLingui } from '@lingui/react/macro';
import React from 'react';
import { Button } from '@shared/ui/button';
import { cn } from '@shared/lib/utils';
import { getKeyboardShortcutLabels } from '@shared/lib/keyboard-shortcuts';
import {
  UNCATEGORIZED_FILTER_KEY,
  UNCLEARED_FILTER_KEY,
} from '@features/transactions/api/useQuickFilterShortcuts';
import { DialogTrigger } from '@shared/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { Input } from '@shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { PlusCircle, Search, Filter, Tag, Folder, Store, Wallet } from 'lucide-react';
import { CountryFlag } from '@shared/ui/country-flag';
import { CryptoIcon } from '@entities/currency/ui/CryptoIcon';
import { isCryptoCurrency } from '@budgero/core/browser';
import { SearchActiveFilters } from '@features/transactions/ui/SearchActiveFilters';
import { SearchHelpPopover } from '@features/transactions/ui/SearchHelpPopover';
import { currencies } from '@features/currencies/model/currency-data';
import type {
  ParsedSearchQuery,
  MatchedToken,
  SearchSuggestion,
  SearchSuggestionKind,
} from '@shared/lib/search-query-parser';
import type { Account, Budget } from '@budgero/core/browser';
import type { TransactionTableColumns } from '@features/transactions/lib/table-columns';
import { TransactionColumnsMenu } from '@features/transactions/ui/TransactionColumnsMenu';

// Currency → flag country code, derived from the canonical currency list.
const currencyCountryMap: Record<string, string> = Object.fromEntries(
  currencies.map((currency) => [currency.value, currency.countryCode])
);

function CurrencyFlagLabel({ currency }: { currency: string | undefined }) {
  const countryCode = currency ? currencyCountryMap[currency] : null;
  if (countryCode) {
    return <CountryFlag countryCode={countryCode} svg style={{ width: '1em', height: '1em' }} />;
  }
  if (currency && isCryptoCurrency(currency)) {
    return <CryptoIcon code={currency} className="h-[1.1em] w-[1.1em]" />;
  }
  // Fallback to currency code if no flag mapping
  return <span className="font-mono text-xs">{currency || '?'}</span>;
}

const SUGGESTION_ICONS: Record<SearchSuggestionKind, typeof Tag> = {
  category: Folder,
  label: Tag,
  payee: Store,
  account: Wallet,
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

interface TransactionsToolbarProps {
  headerActions?: React.ReactNode;
  addTransactionPending: boolean;
  /** Set when inline entry is on: the button opens the register's inline row. */
  onInlineAdd?: () => void;
  // Search
  searchQuery: string;
  setSearchQuery: (value: string, caret?: number) => void;
  /** Caret position in the search box (suggestions follow the term at the caret). */
  setCaret: (caret: number) => void;
  setIsSearchFocused: (value: boolean) => void;
  suggestions: SearchSuggestion[];
  /** The term being typed starts with "-": a picked name is excluded. */
  suggestionsNegated: boolean;
  highlightedIndex: number;
  setHighlightedIndex: React.Dispatch<React.SetStateAction<number>>;
  /** Inserts a picked suggestion; returns the caret position after it. */
  handleSelectSuggestion: (suggestion: SearchSuggestion) => number | null;
  parsedQuery: ParsedSearchQuery;
  handleRemoveToken: (token: MatchedToken) => void;
  handleClearAll: () => void;
  /** Formatter of the currency the table shows (amount chips). */
  amountFormatter: Intl.NumberFormat;
  // Currency display
  forceBudgetCurrency: boolean;
  selectedBudget: Budget | null;
  selectedAccount: Account | null;
  transactionCurrencyDisplay: 'budget' | 'account';
  storeCurrencyDisplay: 'budget' | 'account';
  setTransactionCurrencyDisplay: (value: 'budget' | 'account') => void;
  currencyLabel: string;
  // Balance column toggle
  isMobile: boolean;
  showBalanceColumn: boolean;
  handleToggleBalanceColumn: () => void;
  showLabelColumn: boolean;
  handleToggleLabelColumn: () => void;
  /** Desktop column options (Memo, Payee, memo wrapping). */
  tableColumns: TransactionTableColumns;
  onTableColumnsChange: (patch: Partial<TransactionTableColumns>) => void;
  // Page size
  pageSize: number;
  handlePageSizeChange: (value: string) => void;
  /** Mobile only: the "Sort by" control (desktop sorts from the column headers). */
  mobileSortControl?: React.ReactNode;
  // Uncategorized filter
  hideAccountColumn: boolean;
  uncategorizedCount: number;
  showOnlyUncategorized: boolean;
  setShowOnlyUncategorized: React.Dispatch<React.SetStateAction<boolean>>;
  unclearedCount: number;
  showOnlyUncleared: boolean;
  setShowOnlyUncleared: React.Dispatch<React.SetStateAction<boolean>>;
}

export function TransactionsToolbar({
  headerActions,
  addTransactionPending,
  onInlineAdd,
  searchQuery,
  setSearchQuery,
  setCaret,
  setIsSearchFocused,
  suggestions,
  suggestionsNegated,
  highlightedIndex,
  setHighlightedIndex,
  handleSelectSuggestion,
  parsedQuery,
  handleRemoveToken,
  handleClearAll,
  amountFormatter,
  forceBudgetCurrency,
  selectedBudget,
  selectedAccount,
  transactionCurrencyDisplay,
  storeCurrencyDisplay,
  setTransactionCurrencyDisplay,
  currencyLabel,
  isMobile,
  showBalanceColumn,
  handleToggleBalanceColumn,
  showLabelColumn,
  handleToggleLabelColumn,
  tableColumns,
  onTableColumnsChange,
  pageSize,
  handlePageSizeChange,
  mobileSortControl,
  hideAccountColumn,
  uncategorizedCount,
  showOnlyUncategorized,
  setShowOnlyUncategorized,
  unclearedCount,
  showOnlyUncleared,
  setShowOnlyUncleared,
}: TransactionsToolbarProps) {
  const { t } = useLingui();
  const { shift } = getKeyboardShortcutLabels();
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const suggestionKindLabel = (kind: SearchSuggestionKind) => {
    switch (kind) {
      case 'category':
        return t`Category`;
      case 'label':
        return t`Label`;
      case 'payee':
        return t`Payee`;
      case 'account':
        return t`Account`;
    }
  };

  const pickSuggestion = (suggestion: SearchSuggestion) => {
    const caret = handleSelectSuggestion(suggestion);
    if (caret === null) return;
    // Keep typing right after the inserted name.
    requestAnimationFrame(() => {
      const input = searchInputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(caret, caret);
    });
  };
  const trackCaret = (input: HTMLInputElement) =>
    setCaret(input.selectionStart ?? input.value.length);

  return (
    <div className="space-y-4 mb-4">
      <div className="flex justify-between items-center gap-4">
        <div className="flex items-center gap-2">{headerActions}</div>
        {onInlineAdd ? (
          <Button variant="outline" size="sm" className="gap-2" onClick={onInlineAdd}>
            <Trans>
              <PlusCircle className="h-4 w-4" />
              Add Transaction
            </Trans>
          </Button>
        ) : (
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={addTransactionPending} className="gap-2">
              <Trans>
                <PlusCircle className="h-4 w-4" />
                Add Transaction
              </Trans>
            </Button>
          </DialogTrigger>
        )}
      </div>

      {/* Search Bar */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            placeholder={t`Search: groceries, last 30 days, outflows...`}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value, e.target.selectionStart ?? undefined);
              setIsSearchFocused(true);
            }}
            onSelect={(e) => trackCaret(e.currentTarget)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => {
              // Delay to allow click on suggestion
              setTimeout(() => setIsSearchFocused(false), 150);
            }}
            onKeyDown={(e) => {
              if (suggestions.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHighlightedIndex((i) => Math.min(i + 1, suggestions.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHighlightedIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                  const picked = suggestions[highlightedIndex];
                  if (picked) {
                    e.preventDefault();
                    pickSuggestion(picked);
                  }
                } else if (e.key === 'Escape') {
                  setIsSearchFocused(false);
                }
              }
            }}
            className="pl-8 pr-9"
            aria-label={t`Search transactions`}
          />
          <SearchHelpPopover onPickExample={setSearchQuery} />
          {/* Suggestions for the term being typed */}
          {suggestions.length > 0 && (
            <div
              role="listbox"
              aria-label={t`Search suggestions`}
              className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-md overflow-hidden"
            >
              <div className="px-2 py-1.5 text-xs text-muted-foreground border-b border-border">
                {suggestionsNegated ? (
                  <Trans>Pick one to hide its transactions</Trans>
                ) : (
                  <Trans>Pick one to show only its transactions</Trans>
                )}
              </div>
              {suggestions.map((suggestion, index) => {
                const Icon = SUGGESTION_ICONS[suggestion.kind];
                return (
                  <button
                    key={`${suggestion.kind}:${suggestion.name}`}
                    type="button"
                    role="option"
                    aria-selected={index === highlightedIndex}
                    className={`w-full px-3 py-2 text-sm text-left transition-colors flex items-center gap-2 ${
                      index === highlightedIndex ? 'bg-muted' : 'hover:bg-muted/50'
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickSuggestion(suggestion);
                    }}
                    onMouseEnter={() => setHighlightedIndex(index)}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{suggestion.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {suggestionKindLabel(suggestion.kind)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {/* Active Filters Display */}
        <SearchActiveFilters
          parsed={parsedQuery}
          onRemoveToken={handleRemoveToken}
          onClearAll={handleClearAll}
          currencyFormatter={amountFormatter}
        />
      </div>

      {/* Currency Display Toggle + Uncategorized Filter (only on account pages) */}
      <div className="flex items-center gap-2 flex-wrap">
        {forceBudgetCurrency ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled
                className="flex items-center gap-1.5 text-xs"
              >
                <Trans>
                  <CurrencyFlagLabel currency={selectedBudget?.DisplayCurrency} />
                  Budget Currency
                </Trans>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 text-sm">
              <p>
                <Trans>
                  When viewing transactions from all accounts, amounts are always shown in your
                  budget currency for consistency.
                </Trans>
              </p>
            </PopoverContent>
          </Popover>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setTransactionCurrencyDisplay(
                storeCurrencyDisplay === 'budget' ? 'account' : 'budget'
              )
            }
            className="flex items-center gap-1.5 text-xs"
          >
            <CurrencyFlagLabel
              currency={
                transactionCurrencyDisplay === 'budget'
                  ? selectedBudget?.DisplayCurrency
                  : selectedAccount?.Currency
              }
            />
            {transactionCurrencyDisplay === 'budget' ? t`Budget Currency` : t`Account Currency`}
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          <Trans>Showing amounts in {currencyLabel}</Trans>
        </span>

        {/* Column visibility and memo wrapping - desktop only */}
        {!isMobile && (
          <TransactionColumnsMenu
            columns={tableColumns}
            onChange={onTableColumnsChange}
            showLabelColumn={showLabelColumn}
            onToggleLabelColumn={handleToggleLabelColumn}
            showBalanceColumn={showBalanceColumn}
            onToggleBalanceColumn={handleToggleBalanceColumn}
          />
        )}

        {/* Mobile cards retain paging; the desktop register is virtualized. */}
        {isMobile && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              <Trans>Rows:</Trans>
            </span>
            <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
              <SelectTrigger
                size="sm"
                className="h-8 w-[84px] text-xs"
                aria-label={t`Rows per page`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)} className="text-xs">
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {isMobile && mobileSortControl}

        {/* Quick filter toggles: only on account pages, and only while there is something to
            show (or an active, now-empty filter still needs clearing) */}
        {hideAccountColumn && (unclearedCount > 0 || showOnlyUncleared) && (
          <Button
            variant={showOnlyUncleared && unclearedCount > 0 ? 'default' : 'outline'}
            size="sm"
            className="ml-auto flex items-center gap-1.5 text-xs"
            onClick={() => setShowOnlyUncleared((v) => !v)}
            title={`${showOnlyUncleared ? t`Show all transactions` : t`Show uncleared only`} (${shift(UNCLEARED_FILTER_KEY)})`}
          >
            <Filter className="h-4 w-4" />
            {!showOnlyUncleared
              ? t`Uncleared (${unclearedCount})`
              : unclearedCount > 0
                ? t`Showing Uncleared`
                : t`All transactions`}
          </Button>
        )}
        {hideAccountColumn && (uncategorizedCount > 0 || showOnlyUncategorized) && (
          <Button
            variant={showOnlyUncategorized && uncategorizedCount > 0 ? 'default' : 'outline'}
            size="sm"
            className={cn(
              'flex items-center gap-1.5 text-xs',
              !(unclearedCount > 0 || showOnlyUncleared) && 'ml-auto'
            )}
            onClick={() => setShowOnlyUncategorized((v) => !v)}
            title={`${showOnlyUncategorized ? t`Show all transactions` : t`Show uncategorized only`} (${shift(UNCATEGORIZED_FILTER_KEY)})`}
          >
            <Filter className="h-4 w-4" />
            {!showOnlyUncategorized
              ? t`Uncategorized (${uncategorizedCount})`
              : uncategorizedCount > 0
                ? t`Showing Uncategorized`
                : t`All transactions`}
          </Button>
        )}
      </div>
    </div>
  );
}
