import { Trans, useLingui } from '@lingui/react/macro';
import React from 'react';
import {
  X,
  Calendar,
  ArrowDownRight,
  ArrowUpRight,
  ArrowLeftRight,
  Tag,
  Folder,
  Store,
  StickyNote,
  Wallet,
  Search,
  SearchX,
  Coins,
  CircleCheck,
  ListFilter,
} from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import {
  getAmountFilterLabel,
  type ParsedSearchQuery,
  type MatchedToken,
} from '@shared/lib/search-query-parser';
import { cn } from '@shared/lib/utils';

interface SearchActiveFiltersProps {
  parsed: ParsedSearchQuery;
  onRemoveToken: (token: MatchedToken) => void;
  onClearAll: () => void;
  currencyFormatter?: Intl.NumberFormat;
}

export const SearchActiveFilters = React.memo(function SearchActiveFilters({
  parsed,
  onRemoveToken,
  onClearAll,
  currencyFormatter,
}: SearchActiveFiltersProps) {
  const { t } = useLingui();

  const hasFilters = parsed.matchedTokens.length > 0 || parsed.textQuery.trim().length > 0;

  if (!hasFilters) {
    return null;
  }

  const getTokenIcon = (token: MatchedToken) => {
    switch (token.type) {
      case 'date':
        return Calendar;
      case 'transactionType':
        return token.transactionType === 'outflows'
          ? ArrowDownRight
          : token.transactionType === 'inflows'
            ? ArrowUpRight
            : ArrowLeftRight;
      // Same icons as the suggestions list and the Label column toggle.
      case 'category':
        return Folder;
      case 'label':
        return Tag;
      case 'amount':
        return Coins;
      case 'status':
        return CircleCheck;
      case 'state':
        return ListFilter;
      case 'text':
        switch (token.field) {
          case 'category':
            return Folder;
          case 'label':
            return Tag;
          case 'payee':
            return Store;
          case 'memo':
            return StickyNote;
          case 'account':
            return Wallet;
          default:
            return token.negated ? SearchX : Search;
        }
    }
  };

  const getTokenLabel = (token: MatchedToken) => {
    if (token.type === 'amount' && token.amountFilter) {
      return getAmountFilterLabel(token.amountFilter, currencyFormatter);
    }
    return token.label ?? token.text;
  };

  const getTokenStyles = (token: MatchedToken) => {
    if (token.negated) {
      return 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20 hover:bg-red-500/20';
    }
    switch (token.type) {
      case 'date':
        return 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20 hover:bg-blue-500/20';
      case 'transactionType':
        if (token.transactionType === 'outflows') {
          return 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20 hover:bg-orange-500/20';
        }
        if (token.transactionType === 'inflows') {
          return 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20 hover:bg-green-500/20';
        }
        return 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20 hover:bg-purple-500/20';
      case 'label':
        return 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/20 hover:bg-teal-500/20';
      case 'amount':
        return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/20 hover:bg-yellow-500/20';
      default:
        return 'bg-muted text-foreground border-border hover:bg-muted/80';
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {parsed.matchedTokens.map((token, index) => {
        const Icon = getTokenIcon(token);
        const label = getTokenLabel(token);
        return (
          <Badge
            key={`${token.type}-${token.start}-${index}`}
            variant="outline"
            className={cn(
              'flex items-center gap-1.5 pr-1 text-xs font-medium',
              getTokenStyles(token)
            )}
          >
            <Icon className="h-3 w-3" />
            <span>{label}</span>
            <button
              type="button"
              onClick={() => onRemoveToken(token)}
              className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
              aria-label={t`Remove ${label} filter`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        );
      })}

      {parsed.textQuery.trim() && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Search className="h-3 w-3" />
          <span>
            <Trans>Searching: "{parsed.textQuery}"</Trans>
          </span>
        </div>
      )}

      {(parsed.matchedTokens.length > 1 ||
        (parsed.matchedTokens.length >= 1 && parsed.textQuery.trim())) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearAll}
          className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <Trans>Clear all</Trans>
        </Button>
      )}
    </div>
  );
});
