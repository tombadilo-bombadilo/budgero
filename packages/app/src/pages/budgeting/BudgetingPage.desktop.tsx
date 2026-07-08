import { useMemo, useState, useCallback } from 'react';
import { Card, CardContent } from '@shared/ui/card';
import { ScrollArea } from '@shared/ui/scroll-area';
import { BudgetTable } from '@features/budget-planning/ui/BudgetTable';
import { BudgetToolbar } from '@features/budgeting/ui/BudgetToolbar';
import { BudgetContextPanel } from '@features/budgeting/ui/BudgetContextPanel';
import { useUiStore } from '@shared/store/useUiStore';
import { useMonthlyBudget, useReadyToAssign } from '@entities/budget/api/useMonthlyBudget';
import { useGoals } from '@entities/goal/api/useGoals';
import { transformBudgetRows } from '@features/budget-planning/lib/budget-transforms';
import { useHideCategory } from '@features/category-management/api/useHideCategory';
import { format, addMonths, parse } from 'date-fns';
import { Button } from '@shared/ui/button';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Search } from 'lucide-react';
import { Drawer, DrawerContent } from '@shared/ui/drawer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Input } from '@shared/ui/input';
import { ReadyToAssignHelpPopover } from '@features/budgeting/ui/ReadyToAssignHelpPopover';
import { useFormatMaskedAmount } from '@shared/lib/privacy/useMaskedLocalizer';
import { AnimatedNumber } from '@shared/ui/animated-number';
import MonthPickerPopover from '@shared/ui/MonthPickerPopover';
import { useFocusCategoryFromNavState } from '@shared/hooks/useFocusCategoryFromNavState';
import { useClearCategorySelectionOnMount } from '@shared/hooks/useClearCategorySelectionOnMount';
import { useNavigateMonth } from '@shared/hooks/useNavigateMonth';

export function BudgetingPageDesktop() {
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);
  const currentMonth = useUiStore((state) => state.currentMonth);
  const setCurrentMonth = useUiStore((state) => state.setCurrentMonth);
  const selectedCategories = useUiStore((state) => state.selectedCategories);
  const desktopBudgetLayout = useUiStore((state) => state.desktopBudgetLayout);
  const showHiddenCategories = useUiStore((state) => state.showHiddenCategories);
  const setShowHiddenCategories = useUiStore((state) => state.setShowHiddenCategories);

  const focusCategoryId = useFocusCategoryFromNavState();

  useClearCategorySelectionOnMount();

  const budgetId = selectedBudget?.ID ?? 0;
  const { data: budgetData = [] } = useMonthlyBudget(currentMonth, budgetId);
  const { data: goalsData = [] } = useGoals(budgetId);
  const { data: readyToAssign = 0 } = useReadyToAssign(budgetId);
  const { hideCategory, hasHiddenCategories } = useHideCategory(budgetId);

  const [multiMonthOpen, setMultiMonthOpen] = useState(false);
  const [multiMonthSearchTerm, setMultiMonthSearchTerm] = useState('');
  const [globalCollapsed, setGlobalCollapsed] = useState(false);
  const [monthCount, setMonthCount] = useState<number>(3);
  const [multiMonthAnchorOverride, setMultiMonthAnchorOverride] = useState<string | null>(null);
  const [sharedCollapsedGroups, setSharedCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [sharedExpandedCategories, setSharedExpandedCategories] = useState<Set<string>>(
    () => new Set()
  );

  // Derive the effective anchor - use override only when multiMonthOpen, otherwise use currentMonth
  const multiMonthAnchor =
    multiMonthOpen && multiMonthAnchorOverride ? multiMonthAnchorOverride : currentMonth;

  const multiMonthSeries = useMemo(() => {
    const fallback = currentMonth || format(new Date(), 'yyyy-MM');
    const anchor = multiMonthAnchor || fallback;
    const baseDate = parse(`${anchor}-01`, 'yyyy-MM-dd', new Date());
    return Array.from({ length: 6 }, (_, idx) => format(addMonths(baseDate, idx), 'yyyy-MM'));
  }, [currentMonth, multiMonthAnchor]);

  const [month1, month2, month3, month4, month5, month6] = multiMonthSeries;

  const { data: budgetData1 } = useMonthlyBudget(month1, budgetId);
  const { data: budgetData2 } = useMonthlyBudget(month2, budgetId);
  const { data: budgetData3 } = useMonthlyBudget(month3, budgetId);
  const { data: budgetData4 } = useMonthlyBudget(month4, budgetId);
  const { data: budgetData5 } = useMonthlyBudget(month5, budgetId);
  const { data: budgetData6 } = useMonthlyBudget(month6, budgetId);

  const allBudgetData = useMemo(
    () =>
      [
        { month: month1, data: budgetData1 },
        { month: month2, data: budgetData2 },
        { month: month3, data: budgetData3 },
        { month: month4, data: budgetData4 },
        { month: month5, data: budgetData5 },
        { month: month6, data: budgetData6 },
      ].slice(0, monthCount),
    [
      budgetData1,
      budgetData2,
      budgetData3,
      budgetData4,
      budgetData5,
      budgetData6,
      month1,
      month2,
      month3,
      month4,
      month5,
      month6,
      monthCount,
    ]
  );

  const transformedRows = useMemo(
    () => transformBudgetRows(budgetData || [], goalsData || [], currentMonth),
    [budgetData, goalsData, currentMonth]
  );
  const formatAmount = useFormatMaskedAmount(globalLocalizer);
  // Ready to Assign is stored milliunits; AnimatedNumber interpolates the raw
  // value, so the formatter converts to decimal each frame.
  const formatMilliAmount = useMemo(() => (m: number) => formatAmount(m / 1000), [formatAmount]);

  const selectedCategoryIds = useMemo(
    () => selectedCategories.map((category) => category.ID),
    [selectedCategories]
  );

  const navigateMonth = useNavigateMonth();

  const monthGridClass = useMemo(() => {
    switch (monthCount) {
      case 2:
        return 'min-[1440px]:grid-cols-2';
      case 4:
        return 'min-[1440px]:grid-cols-4';
      case 5:
        return 'min-[1440px]:grid-cols-5';
      case 6:
        return 'min-[1440px]:grid-cols-6';
      default:
        return 'min-[1440px]:grid-cols-3';
    }
  }, [monthCount]);

  const navigateMultiMonthAnchor = (direction: 'prev' | 'next') => {
    const currentDate = parse(`${multiMonthAnchor}-01`, 'yyyy-MM-dd', new Date());
    const updated = addMonths(currentDate, direction === 'prev' ? -1 : 1);
    setMultiMonthAnchorOverride(format(updated, 'yyyy-MM'));
  };

  const monthSwitcher = (
    <div className="flex h-8 min-w-0 items-center rounded-lg border border-border/70 bg-card/50 shadow-sm">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-7 rounded-l-lg rounded-r-none text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        onClick={() => navigateMonth('prev')}
        aria-label="Previous month"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="h-4 w-px bg-border/70" />
      <MonthPickerPopover
        value={currentMonth}
        onChange={setCurrentMonth}
        triggerClassName="h-8 rounded-none px-2 text-sm font-medium hover:bg-muted/60 hover:text-foreground max-w-[clamp(92px,16vw,160px)]"
      />
      <div className="h-4 w-px bg-border/70" />
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-7 rounded-r-lg rounded-l-none text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        onClick={() => navigateMonth('next')}
        aria-label="Next month"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );

  const toolbarExtra = (
    <div className="flex min-w-0 items-center justify-end gap-1.5">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setMultiMonthOpen(true)}
        className="hidden h-8 items-center gap-1.5 rounded-lg border-border/70 bg-card/50 px-2.5 text-xs font-medium text-muted-foreground shadow-none hover:bg-muted/60 hover:text-foreground min-[1440px]:inline-flex"
      >
        <Calendar className="h-3.5 w-3.5" />
        Multi-Month
      </Button>
      {monthSwitcher}
    </div>
  );

  const handleToggleGlobalCollapsed = () => {
    setGlobalCollapsed((prev) => {
      const next = !prev;
      if (!prev) {
        const collapsed = new Set<string>();
        allBudgetData.forEach((md) => {
          if (!md?.data) return;
          const rows = transformBudgetRows(md.data, goalsData || [], md.month);
          rows.filter((row) => row.isGroup).forEach((row) => collapsed.add(row.id));
        });
        setSharedCollapsedGroups(collapsed);
        setSharedExpandedCategories(new Set());
      } else {
        setSharedCollapsedGroups(new Set());
        setSharedExpandedCategories(new Set());
      }
      return next;
    });
  };

  const handleSharedCollapsedGroupsChange = useCallback((next: Set<string>) => {
    setSharedCollapsedGroups(new Set(next));
  }, []);

  const handleSharedExpandedCategoriesChange = useCallback((next: Set<string>) => {
    setSharedExpandedCategories(new Set(next));
  }, []);

  if (!selectedBudget) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Select a budget to manage allocations.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="grid gap-4 min-[1020px]:grid-cols-[1fr_340px] min-[1020px]:items-stretch min-[1020px]:h-[calc(100dvh-var(--app-topbar-height,6.5rem))]">
        <Card className="min-w-0 flex flex-col min-h-0 h-full overflow-hidden">
          <CardContent className="px-0 flex-1 min-h-0 h-full overflow-hidden">
            <ScrollArea className="h-full">
              <BudgetTable
                rawRows={budgetData || []}
                goals={goalsData || []}
                globalLocalizer={globalLocalizer}
                budgetId={budgetId}
                layoutVariant={
                  desktopBudgetLayout === 'cards'
                    ? 'default'
                    : desktopBudgetLayout === 'compact'
                      ? 'desktop-compact'
                      : 'desktop-table'
                }
                focusCategoryId={focusCategoryId}
                onHideCategory={(item) => hideCategory(item.categoryId)}
                showHiddenCategories={showHiddenCategories}
                renderToolbar={(controls) => (
                  <BudgetToolbar
                    readyToAssign={readyToAssign}
                    globalLocalizer={globalLocalizer}
                    currentMonth={currentMonth}
                    budgetId={budgetId}
                    budgetRows={budgetData || []}
                    goals={goalsData || []}
                    controls={controls}
                    extraContent={toolbarExtra}
                    hideResetOrder
                    showHiddenCategories={showHiddenCategories}
                    onToggleHiddenCategories={() => setShowHiddenCategories(!showHiddenCategories)}
                    hasHiddenCategories={hasHiddenCategories}
                  />
                )}
              />
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="min-w-0 flex flex-col min-h-0 h-full overflow-hidden">
          <ScrollArea className="h-full">
            <div className="px-1 pb-4">
              <BudgetContextPanel
                budgetId={budgetId}
                currentMonth={currentMonth}
                globalLocalizer={globalLocalizer}
                selectedCategoryIds={selectedCategoryIds}
                transformedRows={transformedRows}
              />
            </div>
          </ScrollArea>
        </div>
      </div>

      <Drawer open={multiMonthOpen} onOpenChange={setMultiMonthOpen}>
        <DrawerContent className="h-[90vh] w-screen max-w-none data-[vaul-drawer-direction=bottom]:max-h-[100vh] data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:rounded-t-none p-0">
          <div className="h-full overflow-y-auto p-6">
            <div className="mb-6 space-y-4">
              <div className="text-center">
                <h2 className="text-xl font-semibold">Multi-Month Budget View</h2>
              </div>
              <div className="flex flex-col items-center justify-center gap-4 lg:flex-row">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Show:</span>
                  <Select
                    value={monthCount.toString()}
                    onValueChange={(value) => setMonthCount(parseInt(value, 10))}
                  >
                    <SelectTrigger className="w-16">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2">2</SelectItem>
                      <SelectItem value="3">3</SelectItem>
                      <SelectItem value="4">4</SelectItem>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="6">6</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-muted-foreground">months starting from:</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => navigateMultiMonthAnchor('prev')}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="min-w-[140px] text-center text-sm font-medium">
                    {format(parse(`${multiMonthAnchor}-01`, 'yyyy-MM-dd', new Date()), 'MMMM yyyy')}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => navigateMultiMonthAnchor('next')}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center gap-4 lg:flex-row">
                <div className="rounded-lg border border-primary/20 bg-primary/10 px-4 py-2">
                  <div className="flex items-center gap-1">
                    <p className="text-xs text-muted-foreground">Ready to Assign</p>
                    <ReadyToAssignHelpPopover
                      triggerClassName="h-5 w-5 text-muted-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      side="top"
                      align="center"
                    />
                  </div>
                  <AnimatedNumber
                    value={readyToAssign}
                    formatter={formatMilliAmount}
                    className="text-lg font-semibold tabular-nums"
                  />
                </div>

                <div className="relative w-full max-w-md">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search categories across all months..."
                    value={multiMonthSearchTerm}
                    onChange={(event) => setMultiMonthSearchTerm(event.target.value)}
                    className="w-full pl-8"
                  />
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-1.5"
                  onClick={handleToggleGlobalCollapsed}
                >
                  {globalCollapsed ? (
                    <>
                      <ChevronDown className="h-3.5 w-3.5" />
                      Expand All
                    </>
                  ) : (
                    <>
                      <ChevronUp className="h-3.5 w-3.5" />
                      Collapse All
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="my-4 border-t border-border/50" />

            <div className="-mx-6 overflow-x-auto pb-4">
              <div
                className={`relative flex gap-4 px-6 min-w-max min-[1440px]:min-w-0 min-[1440px]:grid ${monthGridClass}`}
              >
                {allBudgetData.map((monthData, index) => {
                  const isFirst = index === 0;
                  const label = format(
                    parse(`${monthData.month}-01`, 'yyyy-MM-dd', new Date()),
                    'MMMM yyyy'
                  );
                  const isLoadingMonth = monthData.data === undefined;

                  return (
                    <div
                      key={monthData.month}
                      className="relative flex-none min-w-[320px] space-y-4 min-[1440px]:min-w-0"
                    >
                      {!isFirst && (
                        <div className="absolute -ml-3 bottom-0 left-0 top-0 w-px bg-border/30" />
                      )}
                      <div className="rounded-lg border border-border/30 bg-muted/30 p-4">
                        <h3 className="text-center text-lg font-medium">{label}</h3>
                      </div>
                      {isLoadingMonth ? (
                        <div className="flex items-center justify-center py-10">
                          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
                        </div>
                      ) : (
                        <BudgetTable
                          rawRows={monthData.data || []}
                          goals={goalsData || []}
                          globalLocalizer={globalLocalizer}
                          budgetId={budgetId}
                          monthOverride={monthData.month}
                          disableDragAndReorder
                          externalSearchTerm={multiMonthSearchTerm}
                          hideSearch
                          globalCollapsed={globalCollapsed}
                          hideCollapseButton
                          hideAddCategoryGroup
                          sharedCollapsedGroups={sharedCollapsedGroups}
                          onSharedCollapsedGroupsChange={handleSharedCollapsedGroupsChange}
                          sharedExpandedCategories={sharedExpandedCategories}
                          onSharedExpandedCategoriesChange={handleSharedExpandedCategoriesChange}
                          disableSelection
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
