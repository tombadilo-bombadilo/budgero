import type { CSSProperties, MouseEvent } from 'react';
import type { DragStartEvent, DragOverEvent, DragEndEvent, useSensors } from '@dnd-kit/core';
import type { BudgetRow } from '../../lib/budget-transforms';

export type Sensors = ReturnType<typeof useSensors>;

export interface DragHandleProps {
  setNodeRef: (node: HTMLElement | null) => void;
  style?: CSSProperties;
  listeners: object;
  attributes: object;
  isDragging: boolean;
  isOver: boolean;
}

export interface DesktopBudgetGroupRowProps {
  row: BudgetRow;
  totals?: { assigned: number; activity: number; available: number };
  isCollapsed: boolean;
  onToggle: () => void;
  onAddCategory: (groupId: number) => void;
  onUpdateGroup: (id: number, name: string) => Promise<void>;
  onDeleteGroup: (item: BudgetRow) => Promise<void>;
  globalLocalizer: Intl.NumberFormat;
  isUpdating: boolean;
  isDeleting: boolean;
  dragHandleProps?: DragHandleProps;
}

export interface DesktopBudgetCategoryRowProps {
  row: BudgetRow;
  globalLocalizer: Intl.NumberFormat;
  currentMonth: string;
  selectedBudgetId: number;
  onEditCategory: (item: BudgetRow) => void;
  onDeleteCategory: (item: BudgetRow) => void;
  onHideCategory?: (item: BudgetRow) => void;
  onUpdateAssignment: (categoryId: number, value: number) => Promise<void>;
  onActivityClick: (categoryId: number, categoryName: string) => void;
  onMoveMoney?: (sourceCategoryId: number, amount: number, target: number | 'rta') => Promise<void>;
  onSelect?: ((event: MouseEvent<HTMLElement>, item: BudgetRow) => void) | undefined;
  isSelected: boolean;
  dragHandleProps?: DragHandleProps;
  selectable: boolean;
}

export interface DesktopBudgetTableViewProps {
  data: BudgetRow[];
  collapsedGroups: Set<string>;
  groupTotals: Map<string, { assigned: number; activity: number; available: number }>;
  onToggleGroup: (groupId: string) => void;
  onAddCategory: (groupId: number) => void;
  onUpdateGroup: (id: number, name: string) => Promise<void>;
  onDeleteGroup: (item: BudgetRow) => Promise<void>;
  onEditCategory: (item: BudgetRow) => void;
  onDeleteCategory: (item: BudgetRow) => void;
  onHideCategory?: (item: BudgetRow) => void;
  onUpdateAssignment: (categoryId: number, value: number) => Promise<void>;
  onActivityClick: (categoryId: number, categoryName: string) => void;
  onMoveMoney?: (sourceCategoryId: number, amount: number, target: number | 'rta') => Promise<void>;
  globalLocalizer: Intl.NumberFormat;
  currentMonth: string;
  selectedBudgetId: number;
  selectedCategoryIds?: Set<number>;
  onCategoryPress?: (event: MouseEvent<HTMLDivElement>, item: BudgetRow) => void;
  disableSelection?: boolean;
  disableDrag?: boolean;
  sensors: Sensors;
  onDragStart: (event: DragStartEvent) => void;
  onDragOver: (event: DragOverEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  overId: string | null;
  isUpdatingGroup?: boolean;
  isDeletingGroup?: boolean;
}
