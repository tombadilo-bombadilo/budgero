import React from 'react';
import type { DateRange } from 'react-day-picker';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import {
  parseSearchQuery,
  removeTokenFromQuery,
  getCategorySuggestions,
  type ParsedSearchQuery,
  type MatchedToken,
} from '@shared/lib/search-query-parser';
import { fromDecimal } from '@shared/lib/currency/milli';

export function isUncategorized(tx: GetTransactionsByAccountRow): boolean {
  const categoryName = tx.Category;
  if (categoryName === 'Split') return false;
  const categoryId = tx.CategoryID;
  return (
    !categoryId ||
    categoryId === 0 ||
    categoryName === 'Uncategorized' ||
    categoryName === null ||
    categoryName === undefined ||
    categoryName === ''
  );
}

function toSearchValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.toLowerCase();
  return String(value).toLowerCase();
}

/**
 * Pure filter pipeline for the transactions table: applies the semantic search
 * query's structured filters (type, category, label, amount), its free-text
 * remainder, and the "uncategorized only" toggle, in that order.
 */
export function filterTransactions(
  data: GetTransactionsByAccountRow[],
  parsedQuery: ParsedSearchQuery,
  showOnlyUncategorized: boolean,
  getPrimaryInflow: (transaction: GetTransactionsByAccountRow) => number,
  getPrimaryOutflow: (transaction: GetTransactionsByAccountRow) => number
): GetTransactionsByAccountRow[] {
  let filtered = data;

  if (parsedQuery.transactionType) {
    filtered = filtered.filter((tx) => {
      switch (parsedQuery.transactionType) {
        case 'inflows':
          return tx.Inflow > 0 && !tx.TransferID;
        case 'outflows':
          return tx.Outflow > 0 && !tx.TransferID;
        case 'transfers':
          return !!tx.TransferID;
        default:
          return true;
      }
    });
  }

  if (parsedQuery.categoryMatches.length > 0) {
    const matchedCategoriesLower = parsedQuery.categoryMatches.map((c) => c.toLowerCase());
    filtered = filtered.filter((tx) => {
      const txCategory = typeof tx.Category === 'string' ? tx.Category.toLowerCase() : '';
      return matchedCategoriesLower.some((cat) => txCategory === cat);
    });
  }

  // Apply explicit label semantic filter from search tokens (label:<name>)
  if (parsedQuery.labelMatches.length > 0) {
    const matchedLabelsLower = parsedQuery.labelMatches.map((label) => label.toLowerCase());
    filtered = filtered.filter((tx) => {
      const txLabel = typeof tx.Label === 'string' ? tx.Label.toLowerCase() : '';
      return matchedLabelsLower.some((label) => txLabel === label);
    });
  }

  // Apply amount filters from semantic search (supports combining over + under for ranges)
  const amountTokens = parsedQuery.matchedTokens.filter(
    (t) => t.type === 'amount' && t.amountFilter
  );
  if (amountTokens.length > 0) {
    filtered = filtered.filter((tx) => {
      // Get the transaction amount (whichever is non-zero: inflow or outflow).
      // Row amounts are milliunits; the search parser yields user-typed decimals.
      const txAmount = Math.max(getPrimaryInflow(tx) || 0, getPrimaryOutflow(tx) || 0);
      // All amount filters must pass (AND logic)
      return amountTokens.every((token) => {
        if (!token.amountFilter) return true;
        const { operator, amount } = token.amountFilter;
        const amountMilli = fromDecimal(amount);
        if (operator === 'over') {
          return txAmount > amountMilli;
        }
        if (operator === 'under') {
          return txAmount > 0 && txAmount < amountMilli;
        }
        // equal — within one cent (10 milliunits)
        return Math.abs(txAmount - amountMilli) < 10;
      });
    });
  }

  const textTerm = parsedQuery.textQuery.toLowerCase().trim();
  if (textTerm) {
    filtered = filtered.filter((transaction) => {
      const memo = toSearchValue(transaction.Memo);
      const category = toSearchValue(transaction.Category);
      const label = toSearchValue(transaction.Label);
      const account = toSearchValue(transaction.Account);
      const payee = toSearchValue(transaction.Payee);
      return (
        memo.includes(textTerm) ||
        category.includes(textTerm) ||
        label.includes(textTerm) ||
        account.includes(textTerm) ||
        payee.includes(textTerm)
      );
    });
  }

  if (showOnlyUncategorized) {
    filtered = filtered.filter(isUncategorized);
  }

  return filtered;
}

/**
 * Owns the transactions table's semantic search box: the query string, its
 * parsed structured filters, the category-suggestions dropdown, and syncing a
 * detected date range up to the parent.
 */
export function useTransactionSearch(
  categoryNames: string[],
  labelNames: string[],
  onDateRangeChange?: (range: DateRange | undefined) => void
) {
  const [searchQuery, setSearchQuery] = React.useState('');

  const parsedQuery = React.useMemo(() => {
    return parseSearchQuery(searchQuery, categoryNames, labelNames);
  }, [searchQuery, categoryNames, labelNames]);

  // Sync date range with parent when detected in search query
  const lastSyncedDateRange = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (onDateRangeChange && parsedQuery.dateRange) {
      const rangeKey = `${parsedQuery.dateRange.from.getTime()}-${parsedQuery.dateRange.to.getTime()}`;
      if (lastSyncedDateRange.current !== rangeKey) {
        lastSyncedDateRange.current = rangeKey;
        onDateRangeChange({
          from: parsedQuery.dateRange.from,
          to: parsedQuery.dateRange.to,
        });
      }
    }
  }, [parsedQuery.dateRange, onDateRangeChange]);

  const handleRemoveToken = React.useCallback(
    (token: MatchedToken) => {
      const newQuery = removeTokenFromQuery(searchQuery, token, parsedQuery);
      setSearchQuery(newQuery);
      // If removing date token, reset the date range sync
      if (token.type === 'date') {
        lastSyncedDateRange.current = null;
      }
    },
    [searchQuery, parsedQuery]
  );

  const handleClearAll = React.useCallback(() => {
    setSearchQuery('');
    lastSyncedDateRange.current = null;
  }, []);

  // Search input focus state for suggestions dropdown
  const [isSearchFocused, setIsSearchFocused] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);

  const categorySuggestions = React.useMemo(() => {
    if (!isSearchFocused || !parsedQuery.textQuery.trim()) {
      return [];
    }
    // Don't show suggestions for categories that are already matched
    const alreadyMatched = new Set(parsedQuery.categoryMatches.map((c) => c.toLowerCase()));
    return getCategorySuggestions(parsedQuery.textQuery, categoryNames).filter(
      (suggestion) => !alreadyMatched.has(suggestion.toLowerCase())
    );
  }, [isSearchFocused, parsedQuery.textQuery, parsedQuery.categoryMatches, categoryNames]);

  React.useEffect(() => {
    setHighlightedIndex(0);
  }, [categorySuggestions.length]);

  const handleSelectCategory = React.useCallback(
    (categoryName: string) => {
      // Build new query: keep all matched tokens, add selected category (quoted if has spaces)
      const parts: string[] = [];

      // Add back matched tokens (date, transaction type, existing categories)
      for (const token of parsedQuery.matchedTokens) {
        if (token.type === 'label') {
          const raw = token.text.replace(/^label:/i, '').trim();
          parts.push(raw.includes(' ') ? `label:"${raw}"` : `label:${raw}`);
          continue;
        }
        parts.push(token.text.includes(' ') ? `"${token.text}"` : token.text);
      }

      if (categoryName.includes(' ')) {
        parts.push(`"${categoryName}"`);
      } else {
        parts.push(categoryName);
      }

      setSearchQuery(parts.join(' '));
      setIsSearchFocused(false);
    },
    [parsedQuery.matchedTokens]
  );

  return {
    searchQuery,
    setSearchQuery,
    parsedQuery,
    isSearchFocused,
    setIsSearchFocused,
    highlightedIndex,
    setHighlightedIndex,
    categorySuggestions,
    handleRemoveToken,
    handleClearAll,
    handleSelectCategory,
  };
}
