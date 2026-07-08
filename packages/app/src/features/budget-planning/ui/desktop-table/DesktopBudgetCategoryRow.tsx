/**
 * Desktop Budget Category Row Component
 *
 * Displays a category row in the desktop table view with assignment editing,
 * activity click, and move money functionality.
 */

import { useId, useState, useMemo, type MouseEvent } from 'react';
import { MoreVertical, ExternalLink, EyeOff } from 'lucide-react';
import { TableRow, TableCell } from '@shared/ui/table';
import { Button } from '@shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Checkbox } from '@shared/ui/checkbox';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import { cn } from '@shared/lib/utils';
import { fromDecimal, toDecimal, ZERO_MILLI } from '@shared/lib/currency/milli';
import { useUiStore } from '@shared/store/useUiStore';
import { useFormatMaskedMilli } from '@features/budget-planning/lib/useFormatMaskedMilli';
import { AnimatedNumber } from '@shared/ui/animated-number';
import { SearchableCategorySelect } from '@features/category-management/ui/SearchableCategorySelect';
import { GoalCalculations, type CategoryFinancials } from '@budgero/core/browser';
import { CCPaymentCoverPopover } from '@features/budget-planning/ui/category-row/CCPaymentCoverPopover';
import { CoverOverspendingPopover } from '@features/budget-planning/ui/category-row/CoverOverspendingPopover';
import { AvailableInfoPopover } from '@features/budget-planning/ui/AvailableInfoPopover';
import { getAvailableColorByGoalStatus, shouldPreventRowSelection } from './utils';
import { useSortableDragHandle } from './useSortableDragHandle';
import type { DesktopBudgetCategoryRowProps } from './types';

export function DesktopBudgetCategoryRow({
  row,
  globalLocalizer,
  currentMonth,
  selectedBudgetId,
  onEditCategory,
  onDeleteCategory,
  onHideCategory,
  onUpdateAssignment,
  onActivityClick,
  onMoveMoney,
  onSelect,
  isSelected,
  dragHandleProps,
  selectable,
}: DesktopBudgetCategoryRowProps) {
  const moveAmountInputId = useId();
  const [movePopoverOpen, setMovePopoverOpen] = useState(false);
  const [moveAmount, setMoveAmount] = useState<string>('');
  const [moveTarget, setMoveTarget] = useState<number | null>(null);
  const [isEditingAllocated, setIsEditingAllocated] = useState(false);

  const highlightAssignmentCategoryId = useUiStore((state) => state.highlightAssignmentCategoryId);
  const setHighlightAssignmentCategoryId = useUiStore(
    (state) => state.setHighlightAssignmentCategoryId
  );
  const formatAmount = useFormatMaskedMilli(globalLocalizer);

  const isAssignmentHighlighted = highlightAssignmentCategoryId === row.categoryId;

  const goalProgress = useMemo(() => {
    if (!row.goal) return null;

    const currencyCode = globalLocalizer?.resolvedOptions().currency;
    const finances: CategoryFinancials = {
      available: row.available,
      assigned: row.assigned,
      activity: row.activity,
      currencyCode,
    };

    return GoalCalculations.calculateProgress(row.goal, finances, currentMonth);
  }, [row.goal, row.available, row.assigned, row.activity, globalLocalizer, currentMonth]);

  const availableSignClass = useMemo(() => {
    // Negative always takes precedence - always red
    if (row.available < 0) {
      return 'text-red-600 dark:text-red-300';
    }

    if (goalProgress) {
      const goalColor = getAvailableColorByGoalStatus(goalProgress.status);
      if (goalColor) return goalColor;
    }

    return row.available > 0 ? 'text-foreground' : 'text-muted-foreground';
  }, [goalProgress, row.available]);

  const handleMove = async () => {
    if (!onMoveMoney) return;
    // moveAmount is a decimal input string; cross into milliunits once here.
    const parsed = parseFloat(moveAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    const amount = fromDecimal(parsed);
    if (amount > Math.max(0, row.available || 0)) return;
    const target: number | 'rta' = moveTarget === 0 ? 'rta' : (moveTarget ?? 'rta');
    await onMoveMoney(row.categoryId, amount, target);
    setMovePopoverOpen(false);
  };

  const dragProps = dragHandleProps ?? {
    setNodeRef: undefined,
    style: undefined,
    listeners: {},
    attributes: {},
    isDragging: false,
    isOver: false,
  };

  const { setNodeRef, style, listeners, attributes, isDragging, isOver } = dragProps;

  return (
    <TableRow
      data-category-id={row.categoryId}
      data-testid={`budget-row-${row.name.toLowerCase().replace(/\s+/g, '-')}`}
      ref={setNodeRef as React.Ref<HTMLTableRowElement>}
      style={style}
      className={cn(
        'transition-colors text-sm align-middle',
        selectable && isSelected && 'bg-primary/10',
        isDragging && 'opacity-60',
        isOver && 'ring-2 ring-primary/50'
      )}
      onClick={(event) => {
        if (!selectable || !onSelect) return;
        if (isEditingAllocated) return;
        // Clicks inside portaled popovers (move money, available explainer, …)
        // bubble here through the React tree but their DOM target lives outside
        // the row — don't treat those as row selection.
        if (!event.currentTarget.contains(event.target as Node)) return;
        if (shouldPreventRowSelection(event.target)) return;
        onSelect(event, row);
      }}
    >
      <TableCell className="align-middle w-[48px] py-1.5">
        <div className="flex items-center gap-2">
          {selectable ? (
            // Shield: only stops row-selection clicks from reaching the row;
            // the checkbox inside is the real control.
            <div
              role="presentation"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => {
                  if (!onSelect) return;
                  const syntheticEvent = {
                    shiftKey: false,
                    ctrlKey: true,
                    metaKey: true,
                    preventDefault() {
                      /* synthetic event stub */
                    },
                    stopPropagation() {
                      /* synthetic event stub */
                    },
                  } as unknown as MouseEvent<HTMLElement>;
                  onSelect(syntheticEvent, row);
                }}
              />
            </div>
          ) : (
            <span className="inline-flex h-4 w-4" />
          )}
        </div>
      </TableCell>
      <TableCell className="align-middle w-auto max-w-[320px] py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              'font-medium leading-snug',
              dragHandleProps && 'cursor-grab active:cursor-grabbing'
            )}
            {...(dragHandleProps ? listeners : {})}
            {...(dragHandleProps ? attributes : {})}
          >
            {row.name}
          </span>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-40" align="start">
              <div className="space-y-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs"
                  onClick={() => onEditCategory(row)}
                >
                  Edit
                </Button>
                {onHideCategory && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onHideCategory(row);
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
                  onClick={() => onDeleteCategory(row)}
                >
                  Delete
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </TableCell>
      <TableCell className="align-middle text-right py-1.5" data-budget-prevent-row-select="true">
        <div className="inline-flex min-h-[28px] w-full items-center justify-end">
          <CalculatorCell
            value={row.assigned}
            onCommit={(val) => onUpdateAssignment(row.categoryId, val)}
            formatter={globalLocalizer.format}
            displayFormatter={globalLocalizer.format}
            localizer={globalLocalizer}
            inputAlign="right"
            placeholder="0"
            useFormatterForDisplay
            onEditingChange={(editing) => {
              setIsEditingAllocated(editing);
              if (editing) {
                setHighlightAssignmentCategoryId(row.categoryId);
              } else if (isAssignmentHighlighted) {
                setHighlightAssignmentCategoryId(null);
              }
            }}
            displayClassName={cn(
              'text-right font-medium text-sm',
              isAssignmentHighlighted && 'ring-2 ring-primary/60 bg-primary/10 animate-pulse'
            )}
            inputClassName={cn(
              'h-8 text-right text-sm',
              !isEditingAllocated &&
                'border-none bg-transparent shadow-none focus-visible:ring-0 px-0 h-auto font-medium',
              isAssignmentHighlighted && 'ring-2 ring-primary/60'
            )}
          />
        </div>
      </TableCell>
      <TableCell className="hidden align-middle text-right py-1.5 min-[1250px]:table-cell">
        <button
          type="button"
          data-testid={`activity-${row.name.toLowerCase().replace(/\s+/g, '-')}`}
          className={cn(
            'inline-flex min-h-[28px] items-center justify-end gap-1 rounded-md px-2 font-mono text-sm transition-colors hover:bg-muted/40 hover:text-primary',
            row.activity < 0
              ? 'text-red-600'
              : row.activity > 0
                ? 'text-green-600'
                : 'text-muted-foreground'
          )}
          onClick={(e) => {
            e.stopPropagation();
            onActivityClick(row.categoryId, row.name);
          }}
        >
          <AnimatedNumber
            value={Math.abs(row.activity)}
            formatter={formatAmount}
            className="tabular-nums"
          />
          <ExternalLink className="h-3 w-3 text-muted-foreground" />
        </button>
      </TableCell>
      <TableCell className="align-middle text-right pr-6 py-1.5">
        <div className="flex min-h-[28px] items-center justify-end gap-2">
          {row.available > 0 && row.fundingBreakdown !== undefined ? (
            <CCPaymentCoverPopover
              available={row.available}
              ccCategoryId={row.categoryId}
              budgetId={selectedBudgetId}
              globalLocalizer={globalLocalizer}
              triggerClassName="inline-flex min-h-[28px] items-center rounded-md px-2 font-mono text-sm"
            />
          ) : row.available > 0 && onMoveMoney ? (
            <Popover
              open={movePopoverOpen}
              onOpenChange={(open) => {
                setMovePopoverOpen(open);
                if (open) {
                  setMoveAmount(String(toDecimal(row.available > 0 ? row.available : ZERO_MILLI)));
                  setMoveTarget(null);
                }
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'inline-flex min-h-[28px] items-center rounded-md px-2 font-mono text-sm underline decoration-dotted underline-offset-2 hover:bg-muted/40 hover:text-primary',
                    availableSignClass
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <AnimatedNumber
                    value={row.available}
                    formatter={formatAmount}
                    className="tabular-nums"
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 space-y-3" align="end">
                <div className="text-sm font-medium">Move Money</div>
                <div className="space-y-1">
                  <Label
                    htmlFor={moveAmountInputId}
                    className="font-normal text-xs text-muted-foreground"
                  >
                    Amount
                  </Label>
                  <Input
                    id={moveAmountInputId}
                    value={moveAmount}
                    onChange={(e) => setMoveAmount(e.target.value)}
                    type="number"
                    step="0.01"
                    min="0"
                    max={String(toDecimal(row.available > 0 ? row.available : ZERO_MILLI))}
                  />
                  <div className="text-[11px] text-muted-foreground">
                    Available: {formatAmount(Math.max(0, row.available || 0))}
                  </div>
                </div>
                <div className="space-y-1">
                  {/* Caption, not a <label>: SearchableCategorySelect exposes no labelable control. */}
                  <span className="text-xs text-muted-foreground">Move to</span>
                  <SearchableCategorySelect
                    budgetId={selectedBudgetId}
                    selectedCategoryId={moveTarget}
                    onCategorySelect={(id) => setMoveTarget(id)}
                    placeholder="Select target"
                    triggerClassName="justify-start h-8"
                    includeReadyToAssign
                    excludeCategoryId={row.categoryId}
                    showAvailableForMonth
                    month={currentMonth}
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button variant="ghost" size="sm" onClick={() => setMovePopoverOpen(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleMove} disabled={moveTarget === null}>
                    Move
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          ) : row.available < 0 && onMoveMoney ? (
            <CoverOverspendingPopover
              available={row.available}
              categoryId={row.categoryId}
              budgetId={selectedBudgetId}
              month={currentMonth}
              globalLocalizer={globalLocalizer}
              onMoveMoney={onMoveMoney}
              triggerClassName="inline-flex min-h-[28px] items-center rounded-md px-2 font-mono text-sm hover:bg-muted/40"
            />
          ) : (
            <AnimatedNumber
              value={row.available}
              formatter={formatAmount}
              className={cn(
                'inline-flex min-h-[28px] items-center rounded-md px-2 font-mono text-sm tabular-nums',
                availableSignClass
              )}
            />
          )}
          <AvailableInfoPopover
            item={row}
            globalLocalizer={globalLocalizer}
            month={currentMonth}
            budgetId={selectedBudgetId}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

interface SortableDesktopBudgetCategoryRowProps
  extends Omit<DesktopBudgetCategoryRowProps, 'dragHandleProps'> {
  overId: string | null;
}

export function SortableDesktopBudgetCategoryRow({
  row,
  overId,
  ...rest
}: SortableDesktopBudgetCategoryRowProps) {
  const dragHandleProps = useSortableDragHandle(row.id, overId);

  return <DesktopBudgetCategoryRow row={row} dragHandleProps={dragHandleProps} {...rest} />;
}
