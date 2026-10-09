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
import { PlusCircle, Search, Filter, Columns, Tag } from 'lucide-react';
import { CountryFlag } from '@shared/ui/country-flag';
import { CryptoIcon } from '@entities/currency/ui/CryptoIcon';
import { isCryptoCurrency } from '@budgero/core/browser';
import { SearchActiveFilters } from '@features/transactions/ui/SearchActiveFilters';
import { currencies } from '@features/currencies/model/currency-data';
import type { ParsedSearchQuery, MatchedToken } from '@shared/lib/search-query-parser';
import type { Account, Budget } from '@budgero/core/browser';

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

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

interface TransactionsToolbarProps {
  headerActions?: React.ReactNode;
  addTransactionPending: boolean;
  /** Set when inline entry is on: the button opens the register's inline row. */
  onInlineAdd?: () => void;
  // Search
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  setIsSearchFocused: (value: boolean) => void;
  categorySuggestions: string[];
  highlightedIndex: number;
  setHighlightedIndex: React.Dispatch<React.SetStateAction<number>>;
  handleSelectCategory: (categoryName: string) => void;
  parsedQuery: ParsedSearchQuery;
  handleRemoveToken: (token: MatchedToken) => void;
  handleClearAll: () => void;
  globalLocalizer: Intl.NumberFormat;
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
  // Page size
  pageSize: number;
  handlePageSizeChange: (value: string) => void;
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
  setIsSearchFocused,
  categorySuggestions,
  highlightedIndex,
  setHighlightedIndex,
  handleSelectCategory,
  parsedQuery,
  handleRemoveToken,
  handleClearAll,
  globalLocalizer,
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
  pageSize,
  handlePageSizeChange,
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
            placeholder={t`Search: groceries, last 30 days, outflows...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => {
              // Delay to allow click on suggestion
              setTimeout(() => setIsSearchFocused(false), 150);
            }}
            onKeyDown={(e) => {
              if (categorySuggestions.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHighlightedIndex((i) => Math.min(i + 1, categorySuggestions.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHighlightedIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSelectCategory(categorySuggestions[highlightedIndex]);
                } else if (e.key === 'Escape') {
                  setIsSearchFocused(false);
                }
              }
            }}
            className="pl-8"
          />
          {/* Category Suggestions Dropdown */}
          {categorySuggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-md overflow-hidden">
              <div className="px-2 py-1.5 text-xs text-muted-foreground border-b border-border">
                <Trans>Categories matching "{parsedQuery.textQuery}"</Trans>
              </div>
              {categorySuggestions.map((suggestion, index) => (
                <button
                  key={suggestion}
                  type="button"
                  className={`w-full px-3 py-2 text-sm text-left transition-colors flex items-center gap-2 ${
                    index === highlightedIndex ? 'bg-muted' : 'hover:bg-muted/50'
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectCategory(suggestion);
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Active Filters Display */}
        <SearchActiveFilters
          parsed={parsedQuery}
          onRemoveToken={handleRemoveToken}
          onClearAll={handleClearAll}
          currencyFormatter={globalLocalizer}
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

        {/* Balance column toggle - desktop only */}
        {!isMobile && (
          <Button
            variant={showBalanceColumn ? 'default' : 'outline'}
            size="sm"
            onClick={handleToggleBalanceColumn}
            className="flex items-center gap-1.5 text-xs"
            title={showBalanceColumn ? t`Hide balance column` : t`Show balance column`}
          >
            <Trans>
              <Columns className="h-4 w-4" />
              Balance
            </Trans>
          </Button>
        )}

        {/* Label column toggle - desktop only */}
        {!isMobile && (
          <Button
            variant={showLabelColumn ? 'default' : 'outline'}
            size="sm"
            onClick={handleToggleLabelColumn}
            className="flex items-center gap-1.5 text-xs"
            title={showLabelColumn ? t`Hide label column` : t`Show label column`}
          >
            <Trans>
              <Tag className="h-4 w-4" />
              Label
            </Trans>
          </Button>
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
