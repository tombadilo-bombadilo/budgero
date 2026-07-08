import { useState } from 'react';
import { ChevronDown, ChevronUp, Layers } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { BudgetRow } from '@features/budget-planning/lib/budget-transforms';
import { useFormatMaskedMilli } from '@features/budget-planning/lib/useFormatMaskedMilli';
import { AnimatedNumber } from '@shared/ui/animated-number';
import { GroupNameEditPopover } from './GroupNameEditPopover';
import { AddCategoryButton } from './AddCategoryButton';

interface CategoryGroupRowProps {
  item: BudgetRow;
  isCollapsed: boolean;
  onToggle: () => void;
  onAddCategory: (groupId: number) => void;
  onUpdateGroup: (id: number, name: string) => Promise<void>;
  onDeleteGroup: (item: BudgetRow) => Promise<void>;
  globalLocalizer: Intl.NumberFormat;
  isUpdating?: boolean;
  isDeleting?: boolean;
  layoutVariant?: 'default' | 'desktop-compact';
  mobileLayout?: 'cards' | 'compact' | 'table';
}

export function CategoryGroupRow({
  item,
  isCollapsed,
  onToggle,
  onAddCategory,
  onUpdateGroup,
  onDeleteGroup,
  globalLocalizer,
  isUpdating = false,
  isDeleting = false,
  layoutVariant = 'default',
  mobileLayout = 'cards',
}: CategoryGroupRowProps) {
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const hasGroupId = item.categoryGroupId !== undefined && item.categoryGroupId !== null;
  const groupId = hasGroupId ? Number(item.categoryGroupId) : null;
  const isTableLayout = mobileLayout === 'table';
  const isCompactLayout = mobileLayout === 'compact';
  const formatAmount = useFormatMaskedMilli(globalLocalizer);

  const handleSave = async () => {
    if (groupId !== null) {
      await onUpdateGroup(groupId, editingName);
      setEditingGroupId(null);
    }
  };

  const handleEditOpenChange = (open: boolean) => {
    if (open) {
      setEditingGroupId(item.id);
      setEditingName(item.name);
    } else {
      setEditingGroupId(null);
    }
  };

  const editPopoverProps = {
    open: editingGroupId === item.id,
    onOpenChange: handleEditOpenChange,
    name: editingName,
    onNameChange: setEditingName,
    onSave: handleSave,
    onDelete: () => onDeleteGroup(item),
    isUpdating,
    isDeleting,
  };

  if (isTableLayout) {
    return (
      <div className="bg-muted/60 border-b border-border/40 select-none">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 items-center py-1.5 pl-1 pr-2">
          {/* Group name column */}
          <div className="flex items-center gap-0.5 min-w-0">
            <button onClick={onToggle} className="shrink-0 text-muted-foreground/50">
              <ChevronDown
                className={cn('h-2.5 w-2.5 transition-transform', isCollapsed && '-rotate-90')}
              />
            </button>

            <GroupNameEditPopover {...editPopoverProps}>
              <span className="flex cursor-pointer items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate">
                {item.name}
              </span>
            </GroupNameEditPopover>

            {groupId !== null && (
              <AddCategoryButton
                groupId={groupId}
                onAddCategory={onAddCategory}
                unstyled
                className="ml-auto h-4 w-4 shrink-0 flex items-center justify-center text-muted-foreground hover:text-primary"
                highlightClassName="text-primary animate-pulse"
                iconClassName="h-3 w-3"
              />
            )}
          </div>

          {/* Allocated total column */}
          <div className="text-right text-[11px] font-semibold text-muted-foreground whitespace-nowrap tabular-nums">
            <AnimatedNumber value={item.assigned} formatter={formatAmount} />
          </div>

          {/* Available total column */}
          <div
            className={cn(
              'text-right text-[11px] font-semibold whitespace-nowrap tabular-nums',
              item.available < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
            )}
          >
            <AnimatedNumber value={item.available} formatter={formatAmount} />
          </div>
        </div>
      </div>
    );
  }

  const groupNameTrigger = (
    <span className="flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-wide truncate max-w-[60vw] sm:text-sm md:max-w-none">
      <Layers className="h-3.5 w-3.5" />
      {item.name}
    </span>
  );

  return (
    <div className="mb-1 overflow-hidden rounded-xl border border-border/60 bg-background dark:border-white/10 dark:bg-white/[0.06] select-none">
      <div className="flex flex-col gap-2 bg-muted px-3 py-2 text-foreground dark:bg-white/12 dark:text-white">
        {layoutVariant === 'desktop-compact' ? (
          <div className="hidden md:grid grid-cols-[minmax(0,1fr)_minmax(96px,120px)_minmax(96px,120px)_minmax(96px,120px)] items-center gap-2 text-xs lg:text-sm">
            <div className="flex items-center gap-2">
              <button
                onClick={onToggle}
                className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/80 text-primary-foreground/90 transition-colors hover:bg-primary/70 dark:bg-white/15 dark:text-white dark:hover:bg-white/20"
              >
                {isCollapsed ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronUp className="h-3.5 w-3.5" />
                )}
              </button>

              <GroupNameEditPopover {...editPopoverProps}>{groupNameTrigger}</GroupNameEditPopover>

              {groupId !== null && (
                <AddCategoryButton
                  groupId={groupId}
                  onAddCategory={onAddCategory}
                  className="h-7 w-7 text-primary hover:bg-primary/10 dark:text-white dark:hover:bg-white/15"
                  highlightClassName="border border-primary ring-2 ring-primary/60 bg-primary/10 animate-pulse"
                  title="Add category"
                />
              )}
            </div>
            <div className="text-right text-xs lg:text-sm font-semibold">
              <AnimatedNumber value={item.assigned} formatter={formatAmount} />
            </div>
            <div
              className={cn(
                'text-right text-xs lg:text-sm font-semibold',
                item.activity < 0
                  ? 'text-red-500 dark:text-red-200'
                  : item.activity > 0
                    ? 'text-green-600 dark:text-green-200'
                    : 'text-muted-foreground'
              )}
            >
              <AnimatedNumber value={Math.abs(item.activity)} formatter={formatAmount} />
            </div>
            <div
              className={cn(
                'text-right text-xs lg:text-sm font-semibold',
                item.available < 0
                  ? 'text-red-500 dark:text-red-200'
                  : 'text-foreground dark:text-white'
              )}
            >
              <AnimatedNumber value={item.available} formatter={formatAmount} />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs lg:text-sm">
            <button
              onClick={onToggle}
              className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/80 text-primary-foreground/90 transition-colors hover:bg-primary/70 dark:bg-white/15 dark:text-white dark:hover:bg-white/20"
            >
              {isCollapsed ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
            </button>

            <GroupNameEditPopover {...editPopoverProps}>{groupNameTrigger}</GroupNameEditPopover>

            {groupId !== null && (
              <AddCategoryButton
                groupId={groupId}
                onAddCategory={onAddCategory}
                className="ml-auto h-7 w-7 text-primary hover:bg-primary/10 dark:text-white dark:hover:bg-white/15"
                highlightClassName="border border-primary ring-2 ring-primary/60 bg-primary/10 animate-pulse"
              />
            )}
          </div>
        )}

        {layoutVariant === 'desktop-compact' ? null : (
          <div className="hidden text-[11px] text-muted-foreground md:flex md:items-center md:justify-between md:gap-1 md:text-center lg:text-xs">
            <div className="flex flex-1 items-center justify-between gap-1 md:flex-1 md:min-w-0 md:border-l md:border-white/20 md:px-1 md:first:border-l-0 md:first:pl-0 md:justify-center">
              <span className="uppercase tracking-wide text-[9px] text-muted-foreground lg:text-[10px]">
                Allocated
              </span>
              <span className="truncate text-xs font-semibold text-foreground dark:text-white text-right md:text-center lg:text-sm">
                <AnimatedNumber value={item.assigned} formatter={formatAmount} />
              </span>
            </div>
            {!isCompactLayout && (
              <div className="flex flex-1 items-center justify-between gap-1 md:flex-1 md:min-w-0 md:border-l md:border-white/20 md:px-1 md:justify-center">
                <span className="uppercase tracking-wide text-[9px] text-muted-foreground lg:text-[10px]">
                  Activity
                </span>
                <span
                  className={cn(
                    'truncate text-xs font-semibold text-foreground text-right md:text-center lg:text-sm',
                    item.activity < 0
                      ? 'text-red-500 dark:text-red-200'
                      : item.activity > 0
                        ? 'text-green-600 dark:text-green-200'
                        : 'text-muted-foreground'
                  )}
                >
                  <AnimatedNumber value={Math.abs(item.activity)} formatter={formatAmount} />
                </span>
              </div>
            )}
            <div className="flex flex-1 items-center justify-between gap-1 md:flex-1 md:min-w-0 md:border-l md:border-white/20 md:px-1 md:justify-center">
              <span className="uppercase tracking-wide text-[9px] text-muted-foreground lg:text-[10px]">
                Available
              </span>
              <span
                className={cn(
                  'truncate text-xs font-semibold text-foreground text-right md:text-center lg:text-sm',
                  item.available < 0
                    ? 'text-red-500 dark:text-red-200'
                    : 'text-foreground dark:text-white'
                )}
              >
                <AnimatedNumber value={item.available} formatter={formatAmount} />
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border/60 bg-background px-1 py-3 text-center text-xs dark:border-white/12 dark:bg-white/[0.03] md:hidden">
        <div className="flex items-center justify-between gap-1 md:hidden">
          <div className="flex flex-col items-center gap-1 flex-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Allocated
            </span>
            <span className="text-sm font-semibold text-foreground">
              <AnimatedNumber value={item.assigned} formatter={formatAmount} />
            </span>
          </div>
          {!isCompactLayout && (
            <div className="flex flex-col items-center gap-1 flex-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Activity
              </span>
              <span
                className={cn(
                  'text-sm font-semibold',
                  item.activity < 0
                    ? 'text-red-600 dark:text-red-400'
                    : item.activity > 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-muted-foreground'
                )}
              >
                <AnimatedNumber value={Math.abs(item.activity)} formatter={formatAmount} />
              </span>
            </div>
          )}
          <div className="flex flex-col items-center gap-1 flex-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Available
            </span>
            <span
              className={cn(
                'text-sm font-semibold',
                item.available < 0 ? 'text-destructive' : 'text-foreground'
              )}
            >
              <AnimatedNumber value={item.available} formatter={formatAmount} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
