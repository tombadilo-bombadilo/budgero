/**
 * Category Selection Hook
 *
 * Handles category selection logic including single, multi, and range selection.
 */

import { useCallback, useEffect, useMemo, useRef, type MouseEvent } from 'react';
import type { Category as CategoryType } from '@budgero/core/browser';
import type { BudgetRow } from '../../lib/budget-transforms';
import type { SelectionEventLike } from './types';

interface UseCategorySelectionProps {
  orderedData: BudgetRow[];
  selectedCategories: CategoryType[];
  setSelectedCategories: (categories: CategoryType[]) => void;
  lastSelectedCategoryId: number | null;
  setLastSelectedCategoryId: (id: number | null) => void;
  highlightedCategoryId: number | null;
  disableSelection: boolean;
  budgetId: number;
  selectedBudgetId: number;
  onSelectionChange?: (selectedIds: number[]) => void;
}

export function useCategorySelection({
  orderedData,
  selectedCategories,
  setSelectedCategories,
  lastSelectedCategoryId,
  setLastSelectedCategoryId,
  highlightedCategoryId,
  disableSelection,
  budgetId,
  selectedBudgetId,
  onSelectionChange,
}: UseCategorySelectionProps) {
  const selectedCategoryIdsSet = useMemo(() => {
    const effectiveSelectedCategories = disableSelection ? [] : selectedCategories;
    return new Set(effectiveSelectedCategories.map((category) => category.ID));
  }, [disableSelection, selectedCategories]);

  const visibleCategoryIds = useMemo(() => {
    return orderedData.filter((row) => !row.isGroup).map((row) => row.categoryId);
  }, [orderedData]);

  const rowsByCategoryId = useMemo(() => {
    const map = new Map<number, BudgetRow>();
    orderedData.forEach((row) => {
      if (!row.isGroup) {
        map.set(row.categoryId, row);
      }
    });
    return map;
  }, [orderedData]);

  const buildCategoryForSelection = useCallback(
    (categoryId: number): CategoryType | null => {
      const fallbackRow = rowsByCategoryId.get(categoryId);
      if (!fallbackRow) {
        return null;
      }
      return {
        ID: categoryId,
        Name: fallbackRow.name,
        Note: '',
        CategoryGroupID: fallbackRow.categoryGroupId ?? 0,
        BudgetID: selectedBudgetId || budgetId,
        Position: 0,
      };
    },
    [budgetId, rowsByCategoryId, selectedBudgetId]
  );

  const handleCategorySelect = useCallback(
    (event: SelectionEventLike, row: BudgetRow) => {
      if (disableSelection || row.isGroup || row.categoryId <= 0) {
        return;
      }

      const { categoryId } = row;
      const isRangeSelection = !!event.shiftKey && lastSelectedCategoryId !== null;
      const isMultiToggle = !!event.metaKey || !!event.ctrlKey;
      const isAlreadySelected = selectedCategories.some((existing) => existing.ID === categoryId);
      let nextSelection: CategoryType[] = [];

      if (isRangeSelection && lastSelectedCategoryId !== null) {
        const lastIndex = visibleCategoryIds.indexOf(lastSelectedCategoryId);
        const currentIndex = visibleCategoryIds.indexOf(categoryId);
        if (lastIndex === -1 || currentIndex === -1) {
          const single = buildCategoryForSelection(categoryId);
          nextSelection = single ? [single] : [];
        } else {
          const [start, end] =
            lastIndex < currentIndex ? [lastIndex, currentIndex] : [currentIndex, lastIndex];
          const idsInRange = visibleCategoryIds.slice(start, end + 1);
          const categoriesInRange: CategoryType[] = [];
          idsInRange.forEach((id) => {
            const categoryRecord = buildCategoryForSelection(id);
            if (
              categoryRecord &&
              !categoriesInRange.some((existing) => existing.ID === categoryRecord.ID)
            ) {
              categoriesInRange.push(categoryRecord);
            }
          });
          nextSelection = categoriesInRange;
        }
      } else if (isMultiToggle) {
        if (isAlreadySelected) {
          nextSelection = selectedCategories.filter((category) => category.ID !== categoryId);
        } else {
          const categoryRecord = buildCategoryForSelection(categoryId);
          nextSelection = categoryRecord
            ? [...selectedCategories, categoryRecord]
            : [...selectedCategories];
        }
      } else if (isAlreadySelected && selectedCategories.length <= 1) {
        nextSelection = [];
      } else {
        const categoryRecord = buildCategoryForSelection(categoryId);
        nextSelection = categoryRecord ? [categoryRecord] : [];
      }

      setSelectedCategories(nextSelection);
      setLastSelectedCategoryId(nextSelection.length > 0 ? categoryId : null);
      onSelectionChange?.(nextSelection.map((category) => category.ID));
    },
    [
      buildCategoryForSelection,
      disableSelection,
      lastSelectedCategoryId,
      selectedCategories,
      setLastSelectedCategoryId,
      setSelectedCategories,
      visibleCategoryIds,
      onSelectionChange,
    ]
  );

  // Auto-select highlighted category — but only ONCE per highlight. Without this
  // guard, deselecting the category while it is still highlighted (the ~2s window
  // after a focus navigation) would immediately re-select it, fighting the user.
  const autoSelectedHighlightRef = useRef<number | null>(null);
  useEffect(() => {
    if (disableSelection || !highlightedCategoryId) {
      autoSelectedHighlightRef.current = null;
      return;
    }
    if (autoSelectedHighlightRef.current === highlightedCategoryId) return;
    if (selectedCategoryIdsSet.has(highlightedCategoryId)) return;

    const row = rowsByCategoryId.get(highlightedCategoryId);
    if (!row || row.isGroup || row.categoryId <= 0) return;
    const categoryRecord = buildCategoryForSelection(highlightedCategoryId);
    if (!categoryRecord) return;

    autoSelectedHighlightRef.current = highlightedCategoryId;
    setSelectedCategories([categoryRecord]);
    setLastSelectedCategoryId(highlightedCategoryId);
    onSelectionChange?.([categoryRecord.ID]);
  }, [
    highlightedCategoryId,
    disableSelection,
    rowsByCategoryId,
    buildCategoryForSelection,
    setSelectedCategories,
    setLastSelectedCategoryId,
    onSelectionChange,
    selectedCategoryIdsSet,
  ]);

  const handleRowPress = useCallback(
    (
      event: MouseEvent<HTMLDivElement>,
      row: BudgetRow,
      longPressEnabled: boolean,
      onCategoryPress?: (row: BudgetRow) => void
    ) => {
      if (disableSelection) {
        return;
      }
      if (longPressEnabled && onCategoryPress) {
        onCategoryPress(row);
        return;
      }
      handleCategorySelect(
        { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey },
        row
      );
    },
    [disableSelection, handleCategorySelect]
  );

  const triggerHapticFeedback = useCallback(() => {
    try {
      if (typeof window !== 'undefined' && 'navigator' in window && 'vibrate' in navigator) {
        navigator.vibrate?.(15);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleRowLongPress = useCallback(
    (row: BudgetRow, longPressEnabled: boolean) => {
      if (disableSelection) {
        return;
      }
      if (longPressEnabled) {
        triggerHapticFeedback();
      }
      handleCategorySelect({ ctrlKey: true }, row);
    },
    [disableSelection, handleCategorySelect, triggerHapticFeedback]
  );

  return {
    selectedCategoryIdsSet,
    rowsByCategoryId,
    handleCategorySelect,
    handleRowPress,
    handleRowLongPress,
  };
}
