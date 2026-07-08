import type { ReactNode } from 'react';
import type { GetMonthlyBudgetRow, Goal } from '@budgero/core/browser';
import type { BudgetRow } from '../../lib/budget-transforms';
import type { FilterType } from '../SearchAndFilterControls';

export interface BudgetTableToolbarControls {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  filterType: FilterType;
  onFilterChange: (value: FilterType) => void;
  collapsedGroups: Set<string>;
  onToggleAllGroups: () => void;
  onResetOrder?: () => void;
}

export interface BudgetTableProps {
  rawRows: GetMonthlyBudgetRow[];
  goals: Goal[];
  globalLocalizer: Intl.NumberFormat;
  budgetId: number;
  monthOverride?: string;
  disableDragAndReorder?: boolean;
  disableSwipe?: boolean;
  externalSearchTerm?: string;
  hideSearch?: boolean;
  globalCollapsed?: boolean;
  hideCollapseButton?: boolean;
  hideAddCategoryGroup?: boolean;
  sharedCollapsedGroups?: Set<string>;
  onSharedCollapsedGroupsChange?: (groups: Set<string>) => void;
  sharedExpandedCategories?: Set<string>;
  onSharedExpandedCategoriesChange?: (categories: Set<string>) => void;
  renderToolbar?: (controls: BudgetTableToolbarControls) => ReactNode;
  enableLongPressSelection?: boolean;
  longPressDuration?: number;
  onCategoryPress?: (row: BudgetRow) => void;
  onSelectionChange?: (selectedIds: number[]) => void;
  disableSelection?: boolean;
  layoutVariant?: 'default' | 'desktop-compact' | 'desktop-table';
  focusCategoryId?: number | null;
  setFocusCategoryId?: (id: number | null) => void;
  onHideCategory?: (item: BudgetRow) => void;
  showHiddenCategories?: boolean;
}

export interface CategoryModalState {
  editModalOpen: boolean;
  editingCategory: {
    id: number;
    name: string;
    excludeFromBudgetPace: boolean;
  } | null;
  deleteModalOpen: boolean;
  deletingCategory: BudgetRow | null;
  confirmDeleteOpen: boolean;
  pendingDelete: BudgetRow | null;
  addCategoryGroupOpen: boolean;
  addCategoryOpen: boolean;
  selectedGroupId: number | null;
}

export interface SpendingDrawerState {
  drawerOpen: boolean;
  selectedCategory: { id: number; name: string } | null;
}

export type SelectionEventLike = {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
};
