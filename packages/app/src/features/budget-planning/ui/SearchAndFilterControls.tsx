import type { ReactNode } from 'react';
import { Search, ChevronUp, ChevronDown, Filter, RotateCcw } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { cn } from '@shared/lib/utils';

export type FilterType = 'all' | 'overspent' | 'underfunded' | 'overfunded';

interface SearchAndFilterControlsProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  filterType: FilterType;
  onFilterChange: (value: FilterType) => void;
  collapsedGroups: Set<string>;
  onToggleAllGroups: () => void;
  hideSearch?: boolean;
  hideCollapseButton?: boolean;
  hideFilter?: boolean;
  onResetOrder?: () => void;
  hideResetOrder?: boolean;
  disableSticky?: boolean;
  extraButtons?: ReactNode;
  inlineFilterOnDesktop?: boolean;
}

export function SearchAndFilterControls({
  searchTerm,
  onSearchChange,
  filterType,
  onFilterChange,
  collapsedGroups,
  onToggleAllGroups,
  hideSearch = false,
  hideCollapseButton = false,
  hideFilter = false,
  onResetOrder,
  hideResetOrder = false,
  disableSticky = false,
  extraButtons,
  inlineFilterOnDesktop = false,
}: SearchAndFilterControlsProps) {
  if (hideSearch && hideCollapseButton && hideFilter) {
    return null;
  }

  const filterSelect = !hideFilter ? (
    <div
      className={cn(
        'w-full min-w-0',
        inlineFilterOnDesktop && 'lg:w-auto lg:min-w-[150px] lg:flex-none'
      )}
    >
      <Select value={filterType} onValueChange={(value) => onFilterChange(value as FilterType)}>
        <SelectTrigger
          size="sm"
          className="h-8 w-full rounded-lg border-border/70 bg-card/50 text-xs font-medium shadow-none transition-colors hover:bg-muted/60"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <SelectValue placeholder="Filter" />
          </div>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Categories</SelectItem>
          <SelectItem value="overspent">Overspent</SelectItem>
          <SelectItem value="underfunded">Underfunded Goals</SelectItem>
          <SelectItem value="overfunded">Overfunded Goals</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ) : null;

  return (
    <div className={cn('space-y-2', inlineFilterOnDesktop && 'lg:space-y-0')}>
      {/* Search and Collapse Controls */}
      {(!hideSearch || !hideCollapseButton || (inlineFilterOnDesktop && !hideFilter)) && (
        <div
          className={cn(
            'pb-2',
            !disableSticky &&
              'sticky top-0 z-10 border-b border-border/50 bg-card/80 backdrop-blur-md',
            inlineFilterOnDesktop && 'lg:pb-0'
          )}
        >
          <div
            className={cn(
              'flex items-center gap-1.5',
              inlineFilterOnDesktop && 'flex-wrap lg:flex-nowrap lg:items-center'
            )}
          >
            {/* Search Bar */}
            {!hideSearch && (
              <div className="group relative min-w-[160px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-foreground" />
                <Input
                  placeholder="Search categories..."
                  value={searchTerm}
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="h-8 rounded-lg border-transparent bg-muted/50 pl-8 pr-3 text-sm shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background"
                />
              </div>
            )}

            {/* Collapse/Expand All Button */}
            {!hideCollapseButton && (
              <Button
                variant="outline"
                size="sm"
                onClick={onToggleAllGroups}
                className="h-8 shrink-0 gap-1.5 whitespace-nowrap rounded-lg border-border/70 bg-card/50 px-2.5 text-xs font-medium text-muted-foreground shadow-none hover:bg-muted/60 hover:text-foreground"
                title={collapsedGroups.size === 0 ? 'Collapse all groups' : 'Expand all groups'}
              >
                {collapsedGroups.size === 0 ? (
                  <>
                    <ChevronUp className="h-3.5 w-3.5" />
                    <span className="hidden xl:inline">Collapse</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3.5 w-3.5" />
                    <span className="hidden xl:inline">Expand</span>
                  </>
                )}
              </Button>
            )}

            {/* Reset Order Button */}
            {!hideResetOrder && onResetOrder && (
              <Button
                variant="outline"
                size="sm"
                onClick={onResetOrder}
                className="h-8 w-8 shrink-0 rounded-lg border-border/70 bg-card/50 p-0 text-muted-foreground shadow-none hover:bg-muted/60 hover:text-foreground"
                title="Reset to default order"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}

            {extraButtons}

            {inlineFilterOnDesktop ? filterSelect : null}
          </div>
        </div>
      )}

      {/* Filter Select */}
      {!inlineFilterOnDesktop ? filterSelect : null}
    </div>
  );
}
