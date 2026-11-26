import React from 'react';
import { useWeekStartsOn } from '@shared/contexts/WeekStartsOnContext';
import type { DateRange } from 'react-day-picker';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import {
  parseSearchQuery,
  removeTokenFromQuery,
  getSearchSuggestionsAt,
  applySearchSuggestion,
  type SearchSuggestion,
  type ClearedStatusFilter,
  type ParsedSearchQuery,
  type MatchedToken,
  type SearchState,
  type TransactionTypeFilter,
} from '@shared/lib/search-query-parser';
import { fromDecimal } from '@shared/lib/currency/milli';
import { useUiStore } from '@shared/store/useUiStore';

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

export function isUncleared(tx: GetTransactionsByAccountRow): boolean {
  return !tx.IsProjected && !tx.Cleared && !tx.Reconciled;
}

export interface QuickFilters {
  uncategorized: boolean;
  uncleared: boolean;
}

/** Lower-cased searchable text of a row, computed once per row object. */
interface RowSearchFields {
  memo: string;
  payee: string;
  category: string;
  label: string;
  account: string;
  /** Every field above, newline-joined (a typed term never spans two fields). */
  all: string;
}

const rowFieldsCache = new WeakMap<GetTransactionsByAccountRow, RowSearchFields>();

function lower(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).toLowerCase();
}

function rowSearchFields(tx: GetTransactionsByAccountRow): RowSearchFields {
  let fields = rowFieldsCache.get(tx);
  if (!fields) {
    const memo = lower(tx.Memo);
    // Transfers and split parents show the other account / line payees as the payee.
    const payee = [lower(tx.Payee), lower(tx.TransferAccountName), lower(tx.SplitPayees)]
      .filter(Boolean)
      .join('\n');
    const category = lower(tx.Category);
    const label = lower(tx.Label);
    const account = lower(tx.Account);
    fields = {
      memo,
      payee,
      category,
      label,
      account,
      all: [memo, payee, category, label, account].join('\n'),
    };
    rowFieldsCache.set(tx, fields);
  }
  return fields;
}

type RowPredicate = (tx: GetTransactionsByAccountRow) => boolean;

function matchesType(tx: GetTransactionsByAccountRow, type: TransactionTypeFilter): boolean {
  switch (type) {
    case 'inflows':
      return tx.InflowConverted > 0 && !tx.TransferID;
    case 'outflows':
      return tx.OutflowConverted > 0 && !tx.TransferID;
    case 'transfers':
      return !!tx.TransferID;
  }
}

function matchesStatus(tx: GetTransactionsByAccountRow, status: ClearedStatusFilter): boolean {
  switch (status) {
    case 'reconciled':
      return Boolean(tx.Reconciled);
    case 'cleared':
      return Boolean(tx.Cleared) || Boolean(tx.Reconciled);
    case 'uncleared':
      return !tx.Cleared && !tx.Reconciled;
  }
}

function matchesState(tx: GetTransactionsByAccountRow, state: SearchState): boolean {
  switch (state) {
    case 'uncategorized':
      return isUncategorized(tx);
    case 'split':
      return tx.Category === 'Split';
    case 'upcoming':
      return Boolean(tx.IsProjected);
    case 'memo':
      return rowSearchFields(tx).memo.trim() !== '';
    case 'label':
      return rowSearchFields(tx).label.trim() !== '';
    case 'payee':
      return rowSearchFields(tx).payee.trim() !== '';
  }
}

/**
 * Turns a parsed query into row predicates, built once per query (not per row).
 * Amounts are compared in milliunits against the displayed currency.
 */
export function buildSearchPredicates(
  parsedQuery: ParsedSearchQuery,
  getPrimaryInflow: (transaction: GetTransactionsByAccountRow) => number,
  getPrimaryOutflow: (transaction: GetTransactionsByAccountRow) => number
): RowPredicate[] {
  const predicates: RowPredicate[] = [];

  const type = parsedQuery.transactionType;
  if (type) predicates.push((tx) => matchesType(tx, type));
  for (const excluded of parsedQuery.excludedTransactionTypes) {
    predicates.push((tx) => !matchesType(tx, excluded));
  }

  // Projected rows have no status yet, so they never match a status filter (negated or not).
  const status = parsedQuery.clearedStatus;
  if (status) predicates.push((tx) => !tx.IsProjected && matchesStatus(tx, status));
  for (const excluded of parsedQuery.excludedStatuses) {
    predicates.push((tx) => !tx.IsProjected && !matchesStatus(tx, excluded));
  }

  for (const { state, negated } of parsedQuery.states) {
    predicates.push((tx) => matchesState(tx, state) !== negated);
  }

  if (parsedQuery.categoryMatches.length > 0) {
    const wanted = new Set(parsedQuery.categoryMatches.map((c) => c.toLowerCase()));
    predicates.push((tx) => wanted.has(rowSearchFields(tx).category));
  }
  if (parsedQuery.excludedCategories.length > 0) {
    const excluded = new Set(parsedQuery.excludedCategories.map((c) => c.toLowerCase()));
    predicates.push((tx) => !excluded.has(rowSearchFields(tx).category));
  }

  if (parsedQuery.labelMatches.length > 0) {
    const wanted = new Set(parsedQuery.labelMatches.map((l) => l.toLowerCase()));
    predicates.push((tx) => wanted.has(rowSearchFields(tx).label));
  }
  if (parsedQuery.excludedLabels.length > 0) {
    const excluded = new Set(parsedQuery.excludedLabels.map((l) => l.toLowerCase()));
    predicates.push((tx) => !excluded.has(rowSearchFields(tx).label));
  }

  if (parsedQuery.amountFilters.length > 0) {
    const bounds = parsedQuery.amountFilters.map((filter) => ({
      operator: filter.operator,
      amount: fromDecimal(filter.amount),
      amountMax: fromDecimal(filter.amountMax ?? filter.amount),
    }));
    predicates.push((tx) => {
      // The size of the transaction, money in or out (milliunits).
      const txAmount = Math.max(getPrimaryInflow(tx) || 0, getPrimaryOutflow(tx) || 0);
      return bounds.every(({ operator, amount, amountMax }) => {
        switch (operator) {
          case 'over':
            return txAmount > amount;
          case 'under':
            return txAmount > 0 && txAmount < amount;
          case 'between':
            return txAmount >= amount && txAmount <= amountMax;
          default:
            // equal: within one cent (10 milliunits)
            return Math.abs(txAmount - amount) < 10;
        }
      });
    });
  }

  for (const term of parsedQuery.textTerms) {
    const { value, negated } = term;
    const field = term.field === 'any' ? 'all' : term.field;
    predicates.push((tx) => rowSearchFields(tx)[field].includes(value) !== negated);
  }

  return predicates;
}

/**
 * Pure filter pipeline for the transactions table: applies every filter of the
 * semantic search query (all must match), then the uncategorized/uncleared toggles.
 * Date words don't filter here: they move the register's date range instead.
 */
export function filterTransactions(
  data: GetTransactionsByAccountRow[],
  parsedQuery: ParsedSearchQuery,
  quickFilters: QuickFilters,
  getPrimaryInflow: (transaction: GetTransactionsByAccountRow) => number,
  getPrimaryOutflow: (transaction: GetTransactionsByAccountRow) => number
): GetTransactionsByAccountRow[] {
  const predicates = buildSearchPredicates(parsedQuery, getPrimaryInflow, getPrimaryOutflow);
  if (quickFilters.uncategorized) predicates.push(isUncategorized);
  if (quickFilters.uncleared) predicates.push(isUncleared);
  if (predicates.length === 0) return data;
  if (predicates.length === 1) return data.filter(predicates[0]);
  return data.filter((tx) => {
    for (const predicate of predicates) {
      if (!predicate(tx)) return false;
    }
    return true;
  });
}

/** The decimal separator of the user's number format ("1.096,56" → ","). */
export function decimalSeparatorOf(formatter: Intl.NumberFormat): '.' | ',' {
  // The locale decides it; the formatter itself may show no decimals at all.
  const { locale } = formatter.resolvedOptions();
  const decimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1 })
    .formatToParts(1.5)
    .find((part) => part.type === 'decimal');
  return decimal?.value === ',' ? ',' : '.';
}

export interface TransactionSearchOptions {
  /** Payee names offered as suggestions. */
  payeeNames?: string[];
  /** Account names offered as suggestions (empty on a single account's register). */
  accountNames?: string[];
  /**
   * Formatter of the currency the table shows; typed amounts use its decimal separator.
   * Defaults to the budget currency's formatter.
   */
  amountFormatter?: Intl.NumberFormat;
}

const NO_NAMES: string[] = [];

/**
 * Owns the transactions table's semantic search box: the query string, its
 * parsed structured filters, the suggestions dropdown (categories, labels,
 * payees, accounts for the term at the caret), and syncing a detected date
 * range up to the parent.
 */
export function useTransactionSearch(
  categoryNames: string[],
  labelNames: string[],
  onDateRangeChange?: (range: DateRange | undefined) => void,
  options: TransactionSearchOptions = {}
) {
  const { payeeNames = NO_NAMES, accountNames = NO_NAMES, amountFormatter } = options;
  const weekStartsOn = useWeekStartsOn();
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  const numberFormatter = amountFormatter ?? globalLocalizer;
  const decimalSeparator = React.useMemo(
    () => decimalSeparatorOf(numberFormatter),
    [numberFormatter]
  );
  const [searchQuery, setSearchQueryState] = React.useState('');
  // Caret position in the search box; suggestions are for the term it is in.
  const [caret, setCaret] = React.useState(0);

  const setSearchQuery = React.useCallback((value: string, nextCaret?: number) => {
    setSearchQueryState(value);
    setCaret(nextCaret ?? value.length);
  }, []);

  const parsedQuery = React.useMemo(() => {
    return parseSearchQuery(searchQuery, categoryNames, labelNames, {
      weekStartsOn,
      decimalSeparator,
    });
  }, [searchQuery, categoryNames, labelNames, weekStartsOn, decimalSeparator]);

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
    [searchQuery, parsedQuery, setSearchQuery]
  );

  const handleClearAll = React.useCallback(() => {
    setSearchQuery('');
    lastSyncedDateRange.current = null;
  }, [setSearchQuery]);

  // Search input focus state for suggestions dropdown
  const [isSearchFocused, setIsSearchFocused] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);

  const sources = React.useMemo(
    () => ({
      categories: categoryNames,
      labels: labelNames,
      payees: payeeNames,
      accounts: accountNames,
    }),
    [categoryNames, labelNames, payeeNames, accountNames]
  );

  const { term: activeTerm, suggestions } = React.useMemo(() => {
    if (!isSearchFocused) return { term: null, suggestions: [] as SearchSuggestion[] };
    return getSearchSuggestionsAt(searchQuery, caret, parsedQuery, sources);
  }, [isSearchFocused, searchQuery, caret, parsedQuery, sources]);

  const suggestionsKey = suggestions.map((s) => `${s.kind}:${s.name}`).join('|');
  React.useEffect(() => {
    setHighlightedIndex(0);
  }, [suggestionsKey]);

  /** Puts the picked name in place of the term being typed; returns the new caret. */
  const handleSelectSuggestion = React.useCallback(
    (suggestion: SearchSuggestion): number | null => {
      if (!activeTerm) return null;
      const next = applySearchSuggestion(searchQuery, activeTerm, suggestion);
      setSearchQuery(next.query, next.caret);
      return next.caret;
    },
    [activeTerm, searchQuery, setSearchQuery]
  );

  return {
    searchQuery,
    setSearchQuery,
    setCaret,
    parsedQuery,
    isSearchFocused,
    setIsSearchFocused,
    highlightedIndex,
    setHighlightedIndex,
    activeTerm,
    suggestions,
    handleRemoveToken,
    handleClearAll,
    handleSelectSuggestion,
  };
}
