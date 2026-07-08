import React from 'react';
import {
  X,
  Calendar,
  ArrowDownRight,
  ArrowUpRight,
  ArrowLeftRight,
  Tag,
  Tags,
  Search,
  Coins,
} from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import {
  getTransactionTypeLabel,
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
  const hasFilters = parsed.matchedTokens.length > 0 || parsed.textQuery.trim().length > 0;

  if (!hasFilters) {
    return null;
  }

  const getTokenIcon = (type: MatchedToken['type']) => {
    switch (type) {
      case 'date':
        return Calendar;
      case 'transactionType':
        return parsed.transactionType === 'outflows'
          ? ArrowDownRight
          : parsed.transactionType === 'inflows'
            ? ArrowUpRight
            : ArrowLeftRight;
      case 'category':
        return Tag;
      case 'label':
        return Tags;
      case 'amount':
        return Coins;
    }
  };

  const getTokenLabel = (token: MatchedToken) => {
    switch (token.type) {
      case 'date':
        return parsed.dateLabel || token.text;
      case 'transactionType':
        return parsed.transactionType
          ? getTransactionTypeLabel(parsed.transactionType)
          : token.text;
      case 'category': {
        const matchedCategory = parsed.categoryMatches.find(
          (cat) =>
            cat.toLowerCase().includes(token.text.toLowerCase()) ||
            token.text.toLowerCase().startsWith(cat.toLowerCase().substring(0, 3))
        );
        return matchedCategory || token.text;
      }
      case 'label': {
        const raw = token.text.replace(/^label:/i, '').trim();
        const matchedLabel = parsed.labelMatches.find(
          (label) =>
            label.toLowerCase().includes(raw.toLowerCase()) ||
            raw.toLowerCase().includes(label.toLowerCase())
        );
        return matchedLabel ? `Label: ${matchedLabel}` : `Label: ${raw}`;
      }
      case 'amount':
        // Use the token's own amountFilter data
        return token.amountFilter
          ? getAmountFilterLabel(token.amountFilter, currencyFormatter)
          : token.text;
    }
  };

  const getTokenStyles = (type: MatchedToken['type']) => {
    switch (type) {
      case 'date':
        return 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20 hover:bg-blue-500/20';
      case 'transactionType':
        if (parsed.transactionType === 'outflows') {
          return 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20 hover:bg-orange-500/20';
        }
        if (parsed.transactionType === 'inflows') {
          return 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20 hover:bg-green-500/20';
        }
        return 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20 hover:bg-purple-500/20';
      case 'category':
        return 'bg-muted text-foreground border-border hover:bg-muted/80';
      case 'label':
        return 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/20 hover:bg-teal-500/20';
      case 'amount':
        return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/20 hover:bg-yellow-500/20';
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {parsed.matchedTokens.map((token, index) => {
        const Icon = getTokenIcon(token.type);
        return (
          <Badge
            key={`${token.type}-${token.text}-${index}`}
            variant="outline"
            className={cn(
              'flex items-center gap-1.5 pr-1 text-xs font-medium',
              getTokenStyles(token.type)
            )}
          >
            <Icon className="h-3 w-3" />
            <span>{getTokenLabel(token)}</span>
            <button
              type="button"
              onClick={() => onRemoveToken(token)}
              className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
              aria-label={`Remove ${getTokenLabel(token)} filter`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        );
      })}

      {parsed.textQuery.trim() && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Search className="h-3 w-3" />
          <span>Searching: "{parsed.textQuery}"</span>
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
          Clear all
        </Button>
      )}
    </div>
  );
});
