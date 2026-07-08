import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { CategoryRow } from '@features/budget-planning/ui/category-row';
import { BudgetRow } from '@features/budget-planning/lib/budget-transforms';
import type { MouseEvent, PointerEvent } from 'react';

interface DraggableCategoryRowProps {
  id: string;
  item: BudgetRow;
  isExpanded: boolean;
  isHighlighted: boolean;
  onEditCategory: (item: BudgetRow) => void;
  onDeleteCategory: (item: BudgetRow) => void;
  onHideCategory?: (item: BudgetRow) => void;
  onUpdateAssignment: (categoryId: number, value: number) => Promise<void>;
  onActivityClick: (categoryId: number, categoryName: string) => void;
  onMoveMoney?: (sourceCategoryId: number, amount: number, target: number | 'rta') => Promise<void>;
  globalLocalizer: Intl.NumberFormat;
  currentMonth: string;
  selectedBudgetId: number;
  isDragging?: boolean;
  isOver?: boolean;
  isSelected: boolean;
  onPress?: (event: MouseEvent<HTMLDivElement>) => void;
  onLongPress?: (event: PointerEvent<HTMLDivElement>) => void;
  longPressDuration?: number;
  layoutVariant?: 'default' | 'desktop-compact';
  mobileLayout?: 'cards' | 'compact' | 'table';
  onToggleExpand?: () => void;
}

export function DraggableCategoryRow({
  id,
  item,
  isExpanded,
  isHighlighted,
  onEditCategory,
  onDeleteCategory,
  onHideCategory,
  onUpdateAssignment,
  onActivityClick,
  onMoveMoney,
  globalLocalizer,
  currentMonth,
  selectedBudgetId,
  isDragging = false,
  isOver = false,
  isSelected,
  onPress,
  onLongPress,
  longPressDuration,
  layoutVariant = 'default',
  mobileLayout = 'cards',
  onToggleExpand,
}: DraggableCategoryRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id });

  const { onPointerDown: sortablePointerDown, ...restListeners } = listeners ?? {};

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative transition-all duration-200 group',
        isSortableDragging && 'z-50',
        isDragging && 'opacity-50',
        isOver && !isDragging && 'ring-2 ring-primary/30 bg-primary/3'
      )}
    >
      <div className="ml-1 md:ml-2 flex">
        <div className="flex flex-none w-4 items-center md:opacity-70 md:hover:opacity-100 md:transition-opacity">
          <div
            {...attributes}
            {...restListeners}
            onPointerDown={(event) => {
              event.stopPropagation();
              sortablePointerDown?.(event);
            }}
            className="cursor-grab active:cursor-grabbing p-0 hover:bg-muted/60 rounded transition-colors touch-none select-none"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        <div className="flex-1">
          <CategoryRow
            item={item}
            isExpanded={isExpanded}
            isHighlighted={isHighlighted}
            onEditCategory={onEditCategory}
            onDeleteCategory={onDeleteCategory}
            onHideCategory={onHideCategory}
            onUpdateAssignment={onUpdateAssignment}
            onActivityClick={onActivityClick}
            onMoveMoney={onMoveMoney}
            globalLocalizer={globalLocalizer}
            currentMonth={currentMonth}
            selectedBudgetId={selectedBudgetId}
            isSelected={isSelected}
            onPress={onPress}
            onLongPress={onLongPress}
            longPressDuration={longPressDuration}
            layoutVariant={layoutVariant}
            mobileLayout={mobileLayout}
            onToggleExpand={onToggleExpand}
          />
        </div>
      </div>
    </div>
  );
}
