import {
  useSpendingByDatesByCategories,
  useSpendingByCategoriesInGroup,
} from '@features/analytics/api/useAnalyticsQueries';
import { useUiStore } from '@shared/store/useUiStore';
import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@shared/ui/button';
import { ArrowLeft } from 'lucide-react';
import { ChartEmptyState } from '@shared/ui/ChartEmptyState';
import { asMilli, toDecimal } from '@shared/lib/currency/milli';
import { SpendingDonutChart, SpendingDonutDatum } from './SpendingDonutChart';

interface BreakdownDatum extends SpendingDonutDatum {
  id: number;
}

export function SpendingBreakdownContent() {
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const dateRange = useUiStore((state) => state.dateRange);

  const [selectedCategoryGroup, setSelectedCategoryGroup] = useState<{
    id: number;
    name: string;
  } | null>(null);

  const budgetId = selectedBudget?.ID || 0;

  const { data: breakdownData, isLoading: isLoadingBreakdown } = useSpendingByDatesByCategories(
    dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '',
    dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : '',
    budgetId
  );

  const { data: categoryData, isLoading: isLoadingCategories } = useSpendingByCategoriesInGroup(
    dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '',
    dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : '',
    budgetId,
    selectedCategoryGroup?.id || 0
  );

  // Aggregate data by category groups or individual categories.
  // Donut values are decimal currency units, converted from milliunits at
  // this mapping (SpendingDonutChart formats decimals).
  const aggregatedData = useMemo<BreakdownDatum[]>(() => {
    if (selectedCategoryGroup && categoryData) {
      // Drill-down view: show individual categories
      return categoryData
        .filter((item) => item.Spending > 0)
        .map((item) => ({
          name: item.CategoryName,
          value: toDecimal(item.Spending),
          id: item.CategoryID,
        }))
        .sort((a, b) => b.value - a.value);
    }
    if (breakdownData) {
      // Top-level view: show category groups (summed in exact milliunits)
      const categoryTotals: Record<string, { value: number; id: number }> = {};

      breakdownData.forEach((item) => {
        const groupName = item.CategoryGroupName || 'Uncategorized';
        if (!categoryTotals[groupName]) {
          categoryTotals[groupName] = { value: 0, id: item.CategoryGroupID };
        }
        categoryTotals[groupName].value += item.Spending;
      });

      // Filter out categories with no spending and format for pie chart
      return Object.entries(categoryTotals)
        .filter(([, data]) => data.value > 0)
        .map(([name, data]) => ({ name, value: toDecimal(asMilli(data.value)), id: data.id }))
        .sort((a, b) => b.value - a.value);
    }
    return [];
  }, [breakdownData, categoryData, selectedCategoryGroup]);

  const isLoading = isLoadingBreakdown || (selectedCategoryGroup && isLoadingCategories);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[300px]">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (aggregatedData.length === 0) {
    return <ChartEmptyState hint="No transactions found for the selected period" />;
  }

  return (
    <div className="space-y-3">
      {selectedCategoryGroup && (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedCategoryGroup(null)}
            className="h-8 px-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <span className="text-sm font-medium">{selectedCategoryGroup.name}</span>
        </div>
      )}

      <SpendingDonutChart
        data={aggregatedData}
        // Drill-down is only available at the top level; suppress clicks on the
        // leaf (individual-category) level.
        onSliceClick={
          selectedCategoryGroup
            ? undefined
            : (datum) => {
                if (datum.id) {
                  setSelectedCategoryGroup({ id: datum.id, name: datum.name });
                }
              }
        }
      />
    </div>
  );
}
