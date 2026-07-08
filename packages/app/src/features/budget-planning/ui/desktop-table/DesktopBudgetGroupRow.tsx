/**
 * Desktop Budget Group Row Component
 *
 * Displays a category group header row in the desktop table view.
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, Layers } from 'lucide-react';
import { TableRow, TableCell } from '@shared/ui/table';
import { cn } from '@shared/lib/utils';
import { useFormatMaskedMilli } from '@features/budget-planning/lib/useFormatMaskedMilli';
import { AnimatedNumber } from '@shared/ui/animated-number';
import { GroupNameEditPopover } from '@features/budget-planning/ui/GroupNameEditPopover';
import { AddCategoryButton } from '@features/budget-planning/ui/AddCategoryButton';
import { useSortableDragHandle } from './useSortableDragHandle';
import type { DesktopBudgetGroupRowProps } from './types';

export function DesktopBudgetGroupRow({
  row,
  totals,
  isCollapsed,
  onToggle,
  onAddCategory,
  onUpdateGroup,
  onDeleteGroup,
  globalLocalizer,
  isUpdating,
  isDeleting,
  dragHandleProps,
}: DesktopBudgetGroupRowProps) {
  const [editingOpen, setEditingOpen] = useState(false);
  const [editingName, setEditingName] = useState(row.name);
  const formatAmount = useFormatMaskedMilli(globalLocalizer);

  const groupId = row.categoryGroupId ?? null;

  const handleSave = async () => {
    if (groupId !== null) {
      await onUpdateGroup(groupId, editingName);
      setEditingOpen(false);
    }
  };

  const totalsAssigned = totals?.assigned ?? 0;
  const totalsActivity = totals?.activity ?? 0;
  const totalsAvailable = totals?.available ?? 0;

  const rowProps = dragHandleProps ?? {
    setNodeRef: undefined,
    style: undefined,
    listeners: {},
    attributes: {},
    isDragging: false,
    isOver: false,
  };

  const { setNodeRef, style, listeners, attributes, isDragging, isOver } = rowProps;

  return (
    <TableRow
      ref={setNodeRef as React.Ref<HTMLTableRowElement>}
      style={style}
      className={cn(
        'bg-muted/40 text-sm',
        isDragging && 'opacity-60',
        isOver && 'ring-2 ring-primary/50'
      )}
    >
      <TableCell className="align-top w-[48px]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded bg-muted text-muted-foreground hover:text-foreground"
            onClick={onToggle}
          >
            {isCollapsed ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <GroupNameEditPopover
            open={editingOpen}
            onOpenChange={(open) => {
              setEditingOpen(open);
              if (open) {
                setEditingName(row.name);
              }
            }}
            name={editingName}
            onNameChange={setEditingName}
            onSave={handleSave}
            onDelete={() => onDeleteGroup(row)}
            isUpdating={isUpdating}
            isDeleting={isDeleting}
            align="start"
          >
            <button
              type="button"
              className="flex items-center gap-2 font-semibold uppercase tracking-wide"
            >
              <span
                className={cn(
                  'inline-flex',
                  dragHandleProps && 'cursor-grab active:cursor-grabbing'
                )}
                {...(dragHandleProps ? listeners : {})}
                {...(dragHandleProps ? attributes : {})}
              >
                <Layers className="h-3.5 w-3.5" />
              </span>
              <span className="truncate">{row.name}</span>
            </button>
          </GroupNameEditPopover>
          {groupId !== null && (
            <AddCategoryButton
              groupId={groupId}
              onAddCategory={onAddCategory}
              className="h-7 w-7 text-primary hover:bg-primary/10"
              highlightClassName="border border-primary ring-2 ring-primary/60 bg-primary/10"
            />
          )}
        </div>
      </TableCell>
      <TableCell className="text-right font-mono text-sm font-semibold">
        <AnimatedNumber value={totalsAssigned} formatter={formatAmount} className="tabular-nums" />
      </TableCell>
      <TableCell
        className={cn(
          'hidden text-right font-mono text-sm font-semibold min-[1250px]:table-cell',
          totalsActivity < 0
            ? 'text-red-600'
            : totalsActivity > 0
              ? 'text-green-600'
              : 'text-muted-foreground'
        )}
      >
        <AnimatedNumber
          value={Math.abs(totalsActivity)}
          formatter={formatAmount}
          className="tabular-nums"
        />
      </TableCell>
      <TableCell
        className={cn(
          'text-right font-mono text-sm pr-6 font-semibold',
          totalsAvailable < 0 ? 'text-red-600' : 'text-foreground'
        )}
      >
        <AnimatedNumber value={totalsAvailable} formatter={formatAmount} className="tabular-nums" />
      </TableCell>
    </TableRow>
  );
}

interface SortableDesktopBudgetGroupRowProps
  extends Omit<DesktopBudgetGroupRowProps, 'dragHandleProps'> {
  overId: string | null;
}

export function SortableDesktopBudgetGroupRow({
  row,
  overId,
  ...rest
}: SortableDesktopBudgetGroupRowProps) {
  const dragHandleProps = useSortableDragHandle(row.id, overId);

  return <DesktopBudgetGroupRow row={row} dragHandleProps={dragHandleProps} {...rest} />;
}
