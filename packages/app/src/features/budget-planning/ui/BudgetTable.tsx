import { useState, useEffect, useMemo, useCallback, type MouseEvent } from 'react';
import { cn } from '@shared/lib/utils';
import { Plus } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { useUiStore } from '@shared/store/useUiStore';
import { useActiveSpaceId } from '@shared/runtime/runtime-provider';
import { resolveSpaceKey } from '@shared/lib/query-utils';
import { useBudgetTableState } from '@features/budget-planning/api/useBudgetTableState';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';
import { SearchAndFilterControls, type FilterType } from './SearchAndFilterControls';
import { EmptyStateDisplay } from './EmptyStateDisplay';
import { DraggableBudgetTable } from './DraggableBudgetTable';
import type { BudgetRow } from '../lib/budget-transforms';
import { CCPaymentActivityDialog } from './CCPaymentActivityDialog';
import {
  BudgetModals,
  useCategorySelection,
  useCategoryOperations,
  useSwipeMonth,
  type BudgetTableProps,
  type BudgetTableToolbarControls,
  type CategoryModalState,
  type SpendingDrawerState,
} from './budget-table';

export type { BudgetTableToolbarControls } from './budget-table';

export function BudgetTable({
  rawRows,
  goals,
  globalLocalizer,
  budgetId,
  monthOverride,
  disableDragAndReorder = false,
  disableSwipe = false,
  externalSearchTerm,
  hideSearch = false,
  globalCollapsed,
  hideCollapseButton = false,
  hideAddCategoryGroup = false,
  sharedCollapsedGroups,
  onSharedCollapsedGroupsChange,
  sharedExpandedCategories,
  onSharedExpandedCategoriesChange,
  renderToolbar,
  enableLongPressSelection = false,
  longPressDuration = 500,
  onCategoryPress,
  onSelectionChange,
  disableSelection = false,
  layoutVariant = 'default',
  focusCategoryId: focusCategoryIdProp,
  setFocusCategoryId: setFocusCategoryIdProp,
  onHideCategory,
  showHiddenCategories = false,
}: BudgetTableProps) {
  const swipeDisabled = disableSwipe || layoutVariant === 'desktop-table';
  const longPressEnabled = enableLongPressSelection && layoutVariant !== 'desktop-table';

  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const focusCategoryIdFromStore = useUiStore((state) => state.focusCategoryId);
  const setFocusCategoryIdInStore = useUiStore((state) => state.setFocusCategoryId);
  const focusCategoryId = focusCategoryIdProp ?? focusCategoryIdFromStore;
  const setFocusCategoryId = setFocusCategoryIdProp ?? setFocusCategoryIdInStore;
  const currentMonth = useUiStore((state) => state.currentMonth);
  const setCurrentMonth = useUiStore((state) => state.setCurrentMonth);
  const selectedCategories = useUiStore((state) => state.selectedCategories);
  const setSelectedCategories = useUiStore((state) => state.setSelectedCategories);
  const lastSelectedCategoryId = useUiStore((state) => state.lastSelectedCategoryId);
  const setLastSelectedCategoryId = useUiStore((state) => state.setLastSelectedCategoryId);
  const mobileBudgetLayout = useUiStore((state) => state.mobileBudgetLayout);
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);

  const spaceId = useActiveSpaceId();
  const spaceKey = resolveSpaceKey(spaceId);
  const effectiveMonth = monthOverride || currentMonth;

  const [drawerState, setDrawerState] = useState<SpendingDrawerState>({
    drawerOpen: false,
    selectedCategory: null,
  });

  const [ccActivityState, setCcActivityState] = useState<{
    open: boolean;
    categoryId: number | null;
    categoryName: string;
  }>({ open: false, categoryId: null, categoryName: '' });

  const [modalState, setModalState] = useState<CategoryModalState>({
    editModalOpen: false,
    editingCategory: null,
    deleteModalOpen: false,
    deletingCategory: null,
    confirmDeleteOpen: false,
    pendingDelete: null,
    addCategoryGroupOpen: false,
    addCategoryOpen: false,
    selectedGroupId: null,
  });

  const {
    collapsedGroups,
    expandedCategories,
    searchTerm,
    filterType,
    highlightedCategoryId,
    setInternalSearchTerm,
    setFilterType,
    transformedRows,
    data,
    toggleGroup,
    toggleCategory,
    toggleAllGroups,
  } = useBudgetTableState({
    rawRows,
    goals,
    currentMonth: effectiveMonth,
    currencyCode: globalLocalizer.resolvedOptions().currency ?? 'USD',
    sharedCollapsedGroups,
    onSharedCollapsedGroupsChange,
    sharedExpandedCategories,
    onSharedExpandedCategoriesChange,
    globalCollapsed,
    externalSearchTerm,
    focusCategoryId,
    setFocusCategoryId,
    budgetId,
    showHiddenCategories,
  });

  // Ordering is persisted in the database (Position column). Clear any legacy
  // localStorage order data left over from the previous client-side approach.
  useEffect(() => {
    if (!budgetId) return;
    try {
      localStorage.removeItem(`budgero_item_order_${budgetId}`);
      localStorage.removeItem(`budgero_category_groups_${budgetId}`);
    } catch (error) {
      console.error('Failed to clear legacy budget order localStorage:', error);
    }
  }, [budgetId]);

  const hasCategories = transformedRows.length > 0;

  const { selectedCategoryIdsSet, rowsByCategoryId, handleRowPress, handleRowLongPress } =
    useCategorySelection({
      orderedData: data,
      selectedCategories,
      setSelectedCategories,
      lastSelectedCategoryId,
      setLastSelectedCategoryId,
      highlightedCategoryId,
      disableSelection,
      budgetId,
      selectedBudgetId: selectedBudget?.ID || 0,
      onSelectionChange,
    });

  const {
    categories,
    handleDeleteCategoryGroup,
    handleUpdateCategoryGroup,
    handleCreateCategoryGroup,
    handleSaveCategoryEdit,
    handleConfirmDelete,
    handleConfirmCategoryDelete,
    handleCreateCategory,
    handleUpsertAssignment,
    handleMoveMoney,
    handleReorderItems,
    overspendingWarning,
    handleOverspendingConfirm,
    handleOverspendingCancel,
    isUpdatingGroup,
    isDeletingGroup,
    isCreatingGroup,
    isCreatingCategory,
    isDeletingCategory,
    isSavingCategoryEdit,
    isDeletingCategoryWithData,
  } = useCategoryOperations({
    budgetId,
    selectedBudgetId: selectedBudget?.ID || 0,
    effectiveMonth,
    spaceKey,
    globalLocalizer,
    transformedRows,
    rowsByCategoryId,
  });

  const { enableSwipe, swipeHandlers } = useSwipeMonth({
    currentMonth,
    setCurrentMonth,
    monthOverride,
    swipeDisabled,
  });

  // Clear selection on context change (switching budgets or filter). Deliberately
  // NOT on month change — selection should persist as the user navigates months.
  useEffect(() => {
    if (disableSelection) return;
    setSelectedCategories([]);
    setLastSelectedCategoryId(null);
  }, [budgetId, disableSelection, filterType, setLastSelectedCategoryId, setSelectedCategories]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSelectedCategories([]);
      setLastSelectedCategoryId(null);
      setInternalSearchTerm(value);
    },
    [setInternalSearchTerm, setLastSelectedCategoryId, setSelectedCategories]
  );

  const handleFilterChange = useCallback(
    (value: FilterType) => {
      setSelectedCategories([]);
      setLastSelectedCategoryId(null);
      setFilterType(value);
    },
    [setFilterType, setLastSelectedCategoryId, setSelectedCategories]
  );

  const handleResetOrder = useCallback(() => {
    try {
      localStorage.removeItem(`budgero_item_order_${budgetId}`);
      localStorage.removeItem(`budgero_category_groups_${budgetId}`);
    } catch (error) {
      console.error('Failed to clear saved order:', error);
    }
    window.location.reload();
  }, [budgetId]);

  const handleActivityClick = useCallback(
    (categoryId: number, categoryName: string) => {
      // For CC Payment categories the "Activity" is a sum of card-payment
      // transfers, not transactions categorized to this category. Route to a
      // dedicated dialog that lists those transfers instead of the empty
      // SpendingDrawer.
      const row = rowsByCategoryId.get(categoryId);
      if (row?.fundingBreakdown !== undefined) {
        setCcActivityState({ open: true, categoryId, categoryName });
        return;
      }
      setDrawerState({
        drawerOpen: true,
        selectedCategory: { id: categoryId, name: categoryName },
      });
    },
    [rowsByCategoryId]
  );

  const handleDrawerClose = useCallback(() => {
    setDrawerState((prev) => ({ ...prev, drawerOpen: false }));
  }, []);

  useEffect(() => {
    if (drawerState.drawerOpen || !drawerState.selectedCategory) return;
    const timeoutId = window.setTimeout(() => {
      setDrawerState((prev) => {
        if (prev.drawerOpen || !prev.selectedCategory) return prev;
        return { ...prev, selectedCategory: null };
      });
    }, 220);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [drawerState.drawerOpen, drawerState.selectedCategory]);

  const handleEditCategory = (item: BudgetRow) => {
    const categoryData = categories?.find((c) => c.ID === item.categoryId);
    if (categoryData) {
      setModalState((prev) => ({
        ...prev,
        editModalOpen: true,
        editingCategory: {
          id: item.categoryId,
          name: item.name,
          excludeFromBudgetPace: categoryData.ExcludeFromBudgetPace || false,
        },
      }));
    }
  };

  const handleDeleteCategory = (item: BudgetRow) => {
    const hasAssignments = item.assigned !== 0;
    const hasTransactions = item.totalTransactions > 0;

    if (hasAssignments || hasTransactions) {
      setModalState((prev) => ({ ...prev, deleteModalOpen: true, deletingCategory: item }));
    } else {
      setModalState((prev) => ({ ...prev, confirmDeleteOpen: true, pendingDelete: item }));
    }
  };

  const handleAddCategoryGroup = () => {
    setModalState((prev) => ({ ...prev, addCategoryGroupOpen: true }));
  };

  const handleAddCategory = (groupId: number) => {
    setModalState((prev) => ({ ...prev, addCategoryOpen: true, selectedGroupId: groupId }));
  };

  const handleRowPressWrapper = useCallback(
    (event: MouseEvent<HTMLDivElement>, row: BudgetRow) => {
      handleRowPress(event, row, longPressEnabled, onCategoryPress);
    },
    [handleRowPress, longPressEnabled, onCategoryPress]
  );

  const handleRowLongPressWrapper = useCallback(
    (_event: MouseEvent<HTMLDivElement>, item: BudgetRow) => {
      handleRowLongPress(item, longPressEnabled);
    },
    [handleRowLongPress, longPressEnabled]
  );

  const toolbarControls = useMemo<BudgetTableToolbarControls>(
    () => ({
      searchTerm,
      onSearchChange: handleSearchChange,
      filterType,
      onFilterChange: handleFilterChange,
      collapsedGroups,
      onToggleAllGroups: toggleAllGroups,
      onResetOrder: hideAddCategoryGroup ? undefined : handleResetOrder,
    }),
    [
      collapsedGroups,
      filterType,
      handleFilterChange,
      handleResetOrder,
      handleSearchChange,
      hideAddCategoryGroup,
      searchTerm,
      toggleAllGroups,
    ]
  );

  // Modals are rendered in both the empty state and the populated table below.
  const modals = (
    <BudgetModals
      drawerState={drawerState}
      onDrawerClose={handleDrawerClose}
      currentMonth={effectiveMonth}
      modalState={modalState}
      onEditModalClose={() =>
        setModalState((prev) => ({ ...prev, editModalOpen: false, editingCategory: null }))
      }
      onSaveCategoryEdit={async (name, excludeFromBudgetPace) => {
        if (modalState.editingCategory) {
          await handleSaveCategoryEdit(
            modalState.editingCategory,
            name,
            excludeFromBudgetPace,
            () => {
              setModalState((prev) => ({ ...prev, editModalOpen: false, editingCategory: null }));
            }
          );
        }
      }}
      isSavingEdit={isSavingCategoryEdit}
      onDeleteModalClose={() =>
        setModalState((prev) => ({ ...prev, deleteModalOpen: false, deletingCategory: null }))
      }
      onConfirmCategoryDelete={async (targetCategoryId) => {
        if (modalState.deletingCategory) {
          await handleConfirmCategoryDelete(modalState.deletingCategory, targetCategoryId, () => {
            setModalState((prev) => ({
              ...prev,
              deleteModalOpen: false,
              deletingCategory: null,
            }));
          });
        }
      }}
      isDeletingWithData={isDeletingCategoryWithData}
      data={data}
      formatAmount={(val) => formatMaskedMilli(globalLocalizer, val, privacyMaskNumbers)}
      onConfirmDeleteClose={() =>
        setModalState((prev) => ({ ...prev, confirmDeleteOpen: false, pendingDelete: null }))
      }
      onConfirmDelete={async () => {
        if (modalState.pendingDelete) {
          await handleConfirmDelete(modalState.pendingDelete, () => {
            setModalState((prev) => ({ ...prev, confirmDeleteOpen: false, pendingDelete: null }));
          });
        }
      }}
      isDeletingCategory={isDeletingCategory}
      onAddGroupClose={() => setModalState((prev) => ({ ...prev, addCategoryGroupOpen: false }))}
      onCreateCategoryGroup={(name) => {
        handleCreateCategoryGroup(name, () => {
          setModalState((prev) => ({ ...prev, addCategoryGroupOpen: false }));
        });
      }}
      isCreatingGroup={isCreatingGroup}
      onAddCategoryClose={() =>
        setModalState((prev) => ({ ...prev, addCategoryOpen: false, selectedGroupId: null }))
      }
      onCreateCategory={(name) => {
        if (modalState.selectedGroupId) {
          handleCreateCategory(name, modalState.selectedGroupId, () => {
            setModalState((prev) => ({ ...prev, addCategoryOpen: false, selectedGroupId: null }));
          });
        }
      }}
      isCreatingCategory={isCreatingCategory}
      overspendingWarning={overspendingWarning}
      onOverspendingConfirm={handleOverspendingConfirm}
      onOverspendingCancel={handleOverspendingCancel}
    />
  );

  if (!hasCategories) {
    return (
      <>
        <EmptyStateDisplay type="no-categories" onAddCategoryGroup={handleAddCategoryGroup} />
        {modals}
      </>
    );
  }

  return (
    <div
      className={cn('flex flex-col relative', layoutVariant !== 'desktop-table' && 'select-none')}
    >
      {/* Search and Filter Controls */}
      {renderToolbar ? (
        renderToolbar(toolbarControls)
      ) : (
        <SearchAndFilterControls
          searchTerm={searchTerm}
          onSearchChange={handleSearchChange}
          filterType={filterType}
          onFilterChange={handleFilterChange}
          collapsedGroups={collapsedGroups}
          onToggleAllGroups={toggleAllGroups}
          hideSearch={hideSearch}
          hideCollapseButton={hideCollapseButton}
          hideFilter={hideAddCategoryGroup}
          onResetOrder={handleResetOrder}
          hideResetOrder={hideAddCategoryGroup}
        />
      )}

      {/* Add Category Group Button */}
      {!hideAddCategoryGroup && (
        <Button
          onClick={handleAddCategoryGroup}
          variant="ghost"
          size="sm"
          className="mb-1.5 mt-0.5 h-7 justify-start gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Category Group
        </Button>
      )}

      {/* Budget Table Card Wrapper (swipe to change month) */}
      <div
        {...(enableSwipe ? swipeHandlers : {})}
        style={enableSwipe ? { touchAction: 'pan-y' } : undefined}
        className="flex flex-col gap-3"
      >
        <DraggableBudgetTable
          data={data}
          unfilteredData={transformedRows}
          searchTerm={searchTerm}
          collapsedGroups={collapsedGroups}
          expandedCategories={expandedCategories}
          highlightedCategoryId={highlightedCategoryId}
          onToggleGroup={toggleGroup}
          onToggleCategory={toggleCategory}
          onAddCategory={handleAddCategory}
          onUpdateGroup={handleUpdateCategoryGroup}
          onDeleteGroup={handleDeleteCategoryGroup}
          onEditCategory={handleEditCategory}
          onDeleteCategory={handleDeleteCategory}
          onHideCategory={onHideCategory}
          onUpdateAssignment={handleUpsertAssignment}
          onActivityClick={handleActivityClick}
          onMoveMoney={handleMoveMoney}
          onReorderItems={(items, info) => handleReorderItems(items, info)}
          globalLocalizer={globalLocalizer}
          currentMonth={effectiveMonth}
          disableDrag={disableDragAndReorder}
          selectedBudgetId={selectedBudget?.ID || 0}
          isUpdatingGroup={isUpdatingGroup}
          isDeletingGroup={isDeletingGroup}
          selectedCategoryIds={selectedCategoryIdsSet}
          onCategoryPress={handleRowPressWrapper}
          onCategoryLongPress={longPressEnabled ? handleRowLongPressWrapper : undefined}
          longPressDuration={longPressEnabled ? longPressDuration : undefined}
          layoutVariant={layoutVariant}
          mobileLayout={mobileBudgetLayout}
        />
      </div>

      {/* Modals */}
      {modals}

      {ccActivityState.categoryId !== null && (
        <CCPaymentActivityDialog
          open={ccActivityState.open}
          onOpenChange={(open) => setCcActivityState((prev) => ({ ...prev, open }))}
          ccCategoryId={ccActivityState.categoryId}
          ccCategoryName={ccActivityState.categoryName}
          budgetId={budgetId}
          currentMonth={effectiveMonth}
        />
      )}
    </div>
  );
}
