import { useState } from 'react';
import { useUiStore } from '@shared/store/useUiStore';
import { useReportPeriod } from './useReportPeriod';

export function useSpendingFilters() {
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[]>([]);

  const { budgetId, startDate, endDate } = useReportPeriod();
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);

  const categoryFilterIds = selectedCategoryIds.length ? selectedCategoryIds : undefined;
  const accountFilterIds = selectedAccountIds.length ? selectedAccountIds : undefined;

  return {
    selectedCategoryIds,
    setSelectedCategoryIds,
    selectedAccountIds,
    setSelectedAccountIds,
    categoryFilterIds,
    accountFilterIds,
    startDate,
    endDate,
    budgetId,
    globalLocalizer,
    privacyMaskNumbers,
  };
}
