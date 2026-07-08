import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { CategoryGroupRow } from '@features/budget-planning/ui/CategoryGroupRow';
import { BudgetRow } from '@features/budget-planning/lib/budget-transforms';

interface DraggableCategoryGroupRowProps {
  id: string;
  item: BudgetRow;
  isCollapsed: boolean;
  onToggle: () => void;
  onAddCategory: (groupId: number) => void;
  onUpdateGroup: (id: number, name: string) => Promise<void>;
  onDeleteGroup: (item: BudgetRow) => Promise<void>;
  globalLocalizer: Intl.NumberFormat;
  isUpdating?: boolean;
  isDeleting?: boolean;
  isDragging?: boolean;
  isOver?: boolean;
  layoutVariant?: 'default' | 'desktop-compact';
  mobileLayout?: 'cards' | 'compact' | 'table';
}

export function DraggableCategoryGroupRow({
  id,
  item,
  isCollapsed,
  onToggle,
  onAddCategory,
  onUpdateGroup,
  onDeleteGroup,
  globalLocalizer,
  isUpdating = false,
  isDeleting = false,
  isDragging = false,
  isOver = false,
  layoutVariant = 'default',
  mobileLayout = 'cards',
}: DraggableCategoryGroupRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center transition-all duration-200 group',
        isSortableDragging && 'z-50',
        isDragging && 'opacity-50',
        isOver && !isDragging && 'ring-2 ring-primary/50 bg-primary/5'
      )}
    >
      <div className="flex flex-none w-4 items-center mr-0.5">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-0 hover:bg-muted/60 rounded transition-colors touch-none select-none md:opacity-70 md:hover:opacity-100 md:transition-opacity"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      <div className="flex-1">
        <CategoryGroupRow
          item={item}
          isCollapsed={isCollapsed}
          onToggle={onToggle}
          onAddCategory={onAddCategory}
          onUpdateGroup={onUpdateGroup}
          onDeleteGroup={onDeleteGroup}
          globalLocalizer={globalLocalizer}
          isUpdating={isUpdating}
          isDeleting={isDeleting}
          layoutVariant={layoutVariant}
          mobileLayout={mobileLayout}
        />
      </div>
    </div>
  );
}
