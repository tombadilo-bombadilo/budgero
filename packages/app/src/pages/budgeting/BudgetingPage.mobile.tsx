import { useCallback, useMemo, useState } from 'react';
import { Card, CardContent } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import MonthPickerPopover from '@shared/ui/MonthPickerPopover';
import { useUiStore } from '@shared/store/useUiStore';
import { useMonthlyBudget, useReadyToAssign } from '@entities/budget/api/useMonthlyBudget';
import { useGoals } from '@entities/goal/api/useGoals';
import { BudgetTable } from '@features/budget-planning/ui/BudgetTable';
import { BudgetToolbar } from '@features/budgeting/ui/BudgetToolbar';
import { BudgetContextPanel } from '@features/budgeting/ui/BudgetContextPanel';
import { transformBudgetRows } from '@features/budget-planning/lib/budget-transforms';
import { useHideCategory } from '@features/category-management/api/useHideCategory';
import { ChevronLeft, ChevronRight, BarChart3 } from 'lucide-react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@shared/ui/drawer';
import { cn } from '@shared/lib/utils';
import { useFocusCategoryFromNavState } from '@shared/hooks/useFocusCategoryFromNavState';
import { useClearCategorySelectionOnMount } from '@shared/hooks/useClearCategorySelectionOnMount';
import { useNavigateMonth } from '@shared/hooks/useNavigateMonth';

export function BudgetingPageMobile() {
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  const currentMonth = useUiStore((state) => state.currentMonth);
  const setCurrentMonth = useUiStore((state) => state.setCurrentMonth);
  const selectedCategories = useUiStore((state) => state.selectedCategories);
  const compactMobileLayout = useUiStore((state) => state.compactMobileLayout);
  const showHiddenCategories = useUiStore((state) => state.showHiddenCategories);
  const setShowHiddenCategories = useUiStore((state) => state.setShowHiddenCategories);

  const [contextOpen, setContextOpen] = useState(false);

  const focusCategoryId = useFocusCategoryFromNavState();

  useClearCategorySelectionOnMount();

  const budgetId = selectedBudget?.ID ?? 0;
  const { data: budgetData = [] } = useMonthlyBudget(currentMonth, budgetId);
  const { data: goalsData = [] } = useGoals(budgetId);
  const { data: readyToAssign = 0 } = useReadyToAssign(budgetId);
  const { hideCategory, hasHiddenCategories } = useHideCategory(budgetId);

  const transformedRows = useMemo(
    () => transformBudgetRows(budgetData || [], goalsData || [], currentMonth),
    [budgetData, goalsData, currentMonth]
  );

  const handleSelectionChange = useCallback((ids: number[]) => {
    if (ids.length === 0) {
      setContextOpen(false);
    }
  }, []);

  const navigateMonth = useNavigateMonth();

  if (!selectedBudget) {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Select a budget to get started.
          </CardContent>
        </Card>
      </div>
    );
  }

  const contextButtonLabel =
    selectedCategories.length > 0 ? `Context (${selectedCategories.length})` : 'View context';

  return (
    <div className="flex h-[calc(100dvh-6rem)] flex-col p-4">
      <Card className="flex-1 min-h-0 overflow-hidden">
        <CardContent className="h-full px-0 overflow-hidden">
          <div className="h-full overflow-y-auto pb-24">
            <BudgetTable
              rawRows={budgetData || []}
              goals={goalsData || []}
              globalLocalizer={globalLocalizer}
              budgetId={budgetId}
              enableLongPressSelection
              onSelectionChange={handleSelectionChange}
              focusCategoryId={focusCategoryId}
              onHideCategory={(item) => hideCategory(item.categoryId)}
              showHiddenCategories={showHiddenCategories}
              renderToolbar={(controls) => (
                <div className="sticky top-0 z-30">
                  <BudgetToolbar
                    readyToAssign={readyToAssign}
                    globalLocalizer={globalLocalizer}
                    currentMonth={currentMonth}
                    budgetId={budgetId}
                    budgetRows={budgetData || []}
                    goals={goalsData || []}
                    controls={controls}
                    hideCollapseButton={false}
                    showFilter
                    hideResetOrder
                    compact={compactMobileLayout}
                    stackedHeader={!compactMobileLayout}
                    showHiddenCategories={showHiddenCategories}
                    onToggleHiddenCategories={() => setShowHiddenCategories(!showHiddenCategories)}
                    hasHiddenCategories={hasHiddenCategories}
                    extraContent={
                      <div
                        className={cn(
                          'flex items-center',
                          !compactMobileLayout && 'w-full justify-between'
                        )}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn('h-8 w-8 shrink-0', compactMobileLayout && 'h-6 w-6')}
                          onClick={() => navigateMonth('prev')}
                        >
                          <ChevronLeft
                            className={cn('h-4 w-4', compactMobileLayout && 'h-3.5 w-3.5')}
                          />
                        </Button>
                        <MonthPickerPopover
                          value={currentMonth}
                          onChange={setCurrentMonth}
                          labelFormat="MMM yyyy"
                          triggerClassName={cn(
                            compactMobileLayout ? 'text-xs px-0.5' : 'justify-center text-sm'
                          )}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn('h-8 w-8 shrink-0', compactMobileLayout && 'h-6 w-6')}
                          onClick={() => navigateMonth('next')}
                        >
                          <ChevronRight
                            className={cn('h-4 w-4', compactMobileLayout && 'h-3.5 w-3.5')}
                          />
                        </Button>
                      </div>
                    }
                  />
                </div>
              )}
            />
          </div>
        </CardContent>
      </Card>

      <Button
        variant="default"
        size="lg"
        className={cn(
          'fixed left-1/2 z-40 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-full shadow-lg',
          contextOpen && 'pointer-events-none opacity-0'
        )}
        style={{ bottom: 'calc(var(--mobile-bottom-nav-height, 96px) + 0.5rem)' }}
        onClick={() => setContextOpen(true)}
      >
        <BarChart3 className="mr-2 h-4 w-4" />
        {contextButtonLabel}
      </Button>

      <Drawer open={contextOpen} onOpenChange={setContextOpen}>
        <DrawerContent className="h-[85vh] data-[vaul-drawer-direction=bottom]:max-h-[85vh] max-w-full px-0 pb-6">
          <DrawerHeader className="px-6 pt-2">
            <DrawerTitle>Budget Context</DrawerTitle>
          </DrawerHeader>
          <div className="h-full overflow-y-auto px-6 pt-2">
            <BudgetContextPanel
              budgetId={budgetId}
              currentMonth={currentMonth}
              globalLocalizer={globalLocalizer}
              selectedCategoryIds={selectedCategories.map((category) => category.ID)}
              transformedRows={transformedRows}
              monthsBack={4}
            />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
