import { MoreVertical, Edit3, Trash, ChevronDown, ChevronRight, EyeOff } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import type { BudgetRow } from '@features/budget-planning/lib/budget-transforms';
import { getStatusColor, getStatusDotClasses, type StatusColorParams } from './category-row.utils';

export interface CategoryRowHeaderProps {
  item: BudgetRow;
  onEditCategory: (item: BudgetRow) => void;
  onDeleteCategory: (item: BudgetRow) => void;
  onHideCategory?: (item: BudgetRow) => void;
  isCompactLayout?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export function CategoryRowHeader({
  item,
  onEditCategory,
  onDeleteCategory,
  onHideCategory,
  isCompactLayout = false,
  isExpanded = false,
  onToggleExpand,
}: CategoryRowHeaderProps) {
  const statusParams: StatusColorParams = {
    available: item.available,
    goalStatus: item.goalStatus,
  };
  const statusColor = getStatusColor(statusParams);
  const statusDotClasses = getStatusDotClasses(statusColor);

  return (
    <div
      className="flex min-w-0 items-center gap-2 text-xs font-semibold text-foreground md:text-[13px] lg:text-sm"
      data-select-handle
    >
      {isCompactLayout && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand?.();
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/60 transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn('inline-flex h-2 w-2 rounded-full', statusDotClasses)} />
        <span
          className="block min-w-0 max-w-[11rem] truncate text-current sm:max-w-[12rem] md:max-w-[25rem] lg:max-w-[25rem]"
          title={item.name}
        >
          {item.name}
        </span>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-7 w-7 text-muted-foreground hover:bg-muted/40 dark:hover:bg-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-36" align="end">
          <div className="space-y-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs"
              onClick={() => onEditCategory(item)}
            >
              <Edit3 className="mr-2 h-3 w-3" />
              Edit
            </Button>
            {onHideCategory && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onHideCategory(item);
                }}
              >
                <EyeOff className="mr-2 h-3 w-3" />
                Hide
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs text-destructive hover:text-destructive"
              onClick={() => onDeleteCategory(item)}
            >
              <Trash className="mr-2 h-3 w-3" />
              Delete
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export interface DesktopCompactHeaderProps {
  item: BudgetRow;
  onEditCategory: (item: BudgetRow) => void;
  onDeleteCategory: (item: BudgetRow) => void;
  onHideCategory?: (item: BudgetRow) => void;
}

export function DesktopCompactHeader({
  item,
  onEditCategory,
  onDeleteCategory,
  onHideCategory,
}: DesktopCompactHeaderProps) {
  const statusParams: StatusColorParams = {
    available: item.available,
    goalStatus: item.goalStatus,
  };
  const statusColor = getStatusColor(statusParams);
  const statusDotClasses = getStatusDotClasses(statusColor);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex min-w-0 items-center gap-2" data-select-handle>
        <span className={cn('inline-flex h-2 w-2 rounded-full', statusDotClasses)} />
        <span
          className="block min-w-0 max-w-[11rem] truncate text-current sm:max-w-[12rem] md:max-w-[25rem] lg:max-w-[25rem]"
          title={item.name}
        >
          {item.name}
        </span>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="ml-1 h-7 w-7 text-muted-foreground hover:bg-muted/40 dark:hover:bg-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-36" align="end">
          <div className="space-y-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs"
              onClick={() => onEditCategory(item)}
            >
              <Edit3 className="mr-2 h-3 w-3" />
              Edit
            </Button>
            {onHideCategory && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onHideCategory(item);
                }}
              >
                <EyeOff className="mr-2 h-3 w-3" />
                Hide
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs text-destructive hover:text-destructive"
              onClick={() => onDeleteCategory(item)}
            >
              <Trash className="mr-2 h-3 w-3" />
              Delete
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
