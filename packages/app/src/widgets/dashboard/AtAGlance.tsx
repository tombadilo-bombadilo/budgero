import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { useNavigate } from 'react-router-dom';
import { useUiStore } from '@shared/store/useUiStore';
import { useOnBudgetBalance } from '@features/analytics/api/useAnalyticsQueries';
import { useAllAccountsMonthlyTransactions } from '@entities/transaction/api/useTransactions';
import {
  useMonthlyBudget,
  useTotalAssignedForBudgetPace,
  useReadyToAssign,
} from '@entities/budget/api/useMonthlyBudget';
import { useGoals } from '@entities/goal/api/useGoals';
import { format, parseISO, startOfMonth, endOfMonth, differenceInDays } from 'date-fns';
import { Progress } from '@shared/ui/progress';
import { TrendingDown, Target, Calendar, PiggyBank, Info } from 'lucide-react';
import {
  GoalCalculations,
  type CategoryFinancials,
  Goal,
  GetMonthlyBudgetRow,
} from '@budgero/core/browser';
import { Popover, PopoverTrigger, PopoverContent } from '@shared/ui/popover';
import { formatMaskedMilli } from '@shared/lib/privacy/mask-numbers';
import { trendTextClass } from '@shared/lib/amount-color';
import { focusCategoryNavState } from '@shared/hooks/useFocusCategoryFromNavState';

export function AtAGlance() {
  const navigate = useNavigate();
  const selectedBudget = useUiStore((s) => s.selectedBudget);
  const globalLocalizer = useUiStore((s) => s.globalLocalizer);
  const privacyMaskNumbers = useUiStore((s) => s.privacyMaskNumbers);

  const budgetId = selectedBudget?.ID || 0;

  // Always use the real current month for this card
  const today = new Date();
  const currentMonthString = format(today, 'yyyy-MM');

  const { data: monthTx = [] } = useAllAccountsMonthlyTransactions(budgetId, currentMonthString);
  const { data: budgetRows = [] } = useMonthlyBudget(currentMonthString, budgetId);
  const { data: goals = [] } = useGoals(budgetId);
  const { data: assignedForMonth = 0 } = useTotalAssignedForBudgetPace(
    [currentMonthString],
    budgetId
  );
  const { data: readyToAssign = 0 } = useReadyToAssign(budgetId);
  const { data: onBudgetBalance = 0 } = useOnBudgetBalance(budgetId);

  const biggestOutflows = monthTx
    .filter((t) => (t.Outflow || 0) > 0 && !t.TransferID)
    .sort((a, b) => (b.Outflow || 0) - (a.Outflow || 0))
    .slice(0, 5);

  const start = startOfMonth(today);
  const end = endOfMonth(today);
  const now = new Date();
  const effectiveToday = now > end ? end : now < start ? start : now;
  const elapsedPct = Math.min(
    100,
    Math.max(
      0,
      ((differenceInDays(effectiveToday, start) + 1) / (differenceInDays(end, start) + 1)) * 100
    )
  );

  const monthSpent = monthTx.reduce((sum: number, t) => sum + (t.Outflow || 0), 0);
  const spentPct = assignedForMonth ? Math.min(100, (monthSpent / assignedForMonth) * 100) : 0;

  const paceDelta = spentPct - elapsedPct;
  const paceState =
    assignedForMonth === 0 ? 'neutral' : paceDelta <= 5 ? 'good' : paceDelta <= 15 ? 'warn' : 'bad';

  // Use the same calculation as goal management components via GoalCalculations
  const currencyCode = globalLocalizer?.resolvedOptions().currency;
  const goalsWithProgress = goals
    .map((g: Goal) => {
      const row = budgetRows.find((r: GetMonthlyBudgetRow) => r.CategoryID === g.CategoryID);
      if (!row) return null;
      const finances: CategoryFinancials = {
        available: Number(row?.Available || 0),
        assigned: Number(row?.Assigned || 0),
        activity: Number(row?.Activity || 0),
        currencyCode,
      };
      const progress = GoalCalculations.calculateProgress(g ?? null, finances, currentMonthString);
      return {
        id: g.ID,
        name: row?.Category || 'Goal',
        categoryId: g.CategoryID,
        percentage: progress.percentage,
        amountSaved: progress.amountSaved,
        monthlyTarget: progress.monthlyTarget,
      };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null)
    .sort((a, b) => a.percentage - b.percentage)
    .slice(0, 5);

  // MTD on-budget income/outflow excluding transfers
  const totalIncome = monthTx.reduce(
    (sum: number, t) => sum + (t.TransferID ? 0 : t.Inflow || 0),
    0
  );
  const totalOutflow = monthTx.reduce(
    (sum: number, t) => sum + (t.TransferID ? 0 : t.Outflow || 0),
    0
  );
  const savingsRate = totalIncome > 0 ? ((totalIncome - totalOutflow) / totalIncome) * 100 : 0;
  const daysElapsed = differenceInDays(effectiveToday, start) + 1;
  const mtdAvgDailySpend = daysElapsed > 0 ? totalOutflow / daysElapsed : 0;
  const minDenominator = 1000; // milliunits (1 currency unit); threshold to avoid wild swings

  const monthsCoverage =
    totalOutflow >= minDenominator
      ? onBudgetBalance / totalOutflow
      : mtdAvgDailySpend > 0
        ? onBudgetBalance / (mtdAvgDailySpend * 30)
        : 0;
  const runwayDays = mtdAvgDailySpend > 0 ? Math.floor(readyToAssign / mtdAvgDailySpend) : 0;

  const navigateToCategory = (categoryId: number) => {
    void navigate('/budgeting', { state: focusCategoryNavState(categoryId) });
  };

  const monthLabel = format(today, 'MMMM yyyy');

  return (
    <Card className="relative overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg sm:text-xl font-semibold flex items-center gap-2">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          {monthLabel} At a Glance
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Top Row: Biggest Transactions, Goals Progress, Budget Pacing, Financial Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Biggest Transactions */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground pb-2 border-b border-border/30">
              <TrendingDown className="h-4 w-4" />
              Biggest Transactions
            </div>
            <div className="space-y-2">
              {biggestOutflows.length === 0 ? (
                <div className="text-sm text-muted-foreground py-2 text-center rounded-lg bg-muted/30">
                  No outflows
                </div>
              ) : (
                biggestOutflows.slice(0, 4).map((t, i) => (
                  <div
                    key={i}
                    className="p-2 rounded-lg bg-muted/20 hover:bg-muted/40 transition-all duration-200"
                  >
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="truncate" title={t.Category || 'Uncategorized'}>
                        {format(parseISO(t.Date), 'MMM d')} • {t.Category || 'Uncategorized'}
                      </span>
                      <span className="ml-3 font-semibold text-red-600 whitespace-nowrap">
                        {formatMaskedMilli(globalLocalizer, t.Outflow || 0, privacyMaskNumbers)}
                      </span>
                    </div>
                    <div
                      className="mt-1 block text-[11px] sm:text-sm text-foreground/90 truncate"
                      title={t.Memo || 'No memo'}
                    >
                      {t.Memo || 'No memo'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Goals Progress */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground pb-2 border-b border-border/30">
              <Target className="h-4 w-4" />
              Goals Progress
            </div>
            <div className="space-y-2">
              {goalsWithProgress.length === 0 ? (
                <div className="text-sm text-muted-foreground py-2 text-center rounded-lg bg-muted/30">
                  No goals yet
                </div>
              ) : (
                goalsWithProgress.slice(0, 4).map((g) => (
                  <button
                    key={g.id}
                    onClick={() => navigateToCategory(g.categoryId)}
                    className="w-full flex items-center gap-2 p-2 rounded-lg bg-muted/20 hover:bg-muted/40 transition-all duration-200 cursor-pointer"
                  >
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-muted-foreground truncate">{g.name}</span>
                        <span>{Math.round(g.percentage)}%</span>
                      </div>
                      <Progress value={g.percentage} className="h-1.5" />
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Budget Pacing */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground pb-2 border-b border-border/30">
              <Target className="h-4 w-4" />
              Budget Pacing
            </div>
            <div className="space-y-2 p-2.5 rounded-lg bg-muted/20">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Time elapsed</span>
                  <span>{Math.round(elapsedPct)}%</span>
                </div>
                <Progress value={elapsedPct} className="h-2" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Budget spent</span>
                  <span>{Math.round(spentPct)}%</span>
                </div>
                <Progress
                  value={spentPct}
                  className={`h-2 ${
                    paceState === 'good'
                      ? '[&>[data-slot=progress-indicator]]:bg-green-500'
                      : paceState === 'warn'
                        ? '[&>[data-slot=progress-indicator]]:bg-yellow-500'
                        : paceState === 'bad'
                          ? '[&>[data-slot=progress-indicator]]:bg-red-500'
                          : ''
                  }`}
                />
              </div>
              <div className="flex items-center gap-2">
                {paceState === 'good' && <div className="h-1.5 w-1.5 rounded-full bg-green-500" />}
                {paceState === 'warn' && <div className="h-1.5 w-1.5 rounded-full bg-yellow-500" />}
                {paceState === 'bad' && <div className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                <span
                  className={`text-xs ${
                    paceState === 'good'
                      ? 'text-green-600'
                      : paceState === 'warn'
                        ? 'text-yellow-600'
                        : paceState === 'bad'
                          ? 'text-red-600'
                          : 'text-muted-foreground'
                  }`}
                >
                  {assignedForMonth === 0
                    ? 'No budget assigned'
                    : paceState === 'good'
                      ? 'On track'
                      : paceState === 'warn'
                        ? 'Ahead of pace'
                        : 'Over pace'}
                </span>
              </div>
            </div>
          </div>

          {/* Financial Stats */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground pb-2 border-b border-border/30">
              <PiggyBank className="h-4 w-4" />
              Financial Stats
            </div>
            <div className="grid grid-cols-1 gap-2">
              <div className="p-2 rounded-lg bg-gradient-to-br from-muted/30 to-muted/50 border">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  Savings Rate
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="text-muted-foreground hover:text-foreground">
                        <Info className="h-3 w-3" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 text-xs" modal>
                      Percentage of on-budget income not spent this month: (Income -
                      Outflows)/Income.
                    </PopoverContent>
                  </Popover>
                </div>
                <div className={`text-sm font-bold ${trendTextClass(savingsRate)}`}>
                  {Math.round(savingsRate)}%
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 rounded-lg bg-gradient-to-br from-muted/30 to-muted/50 border">
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    Coverage
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="text-muted-foreground hover:text-foreground">
                          <Info className="h-3 w-3" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 text-xs" modal>
                        Months your on-budget balance could cover at current spend rate.
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="text-sm font-bold">{monthsCoverage.toFixed(1)}mo</div>
                </div>
                <div className="p-2 rounded-lg bg-gradient-to-br from-muted/30 to-muted/50 border">
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    Runway
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="text-muted-foreground hover:text-foreground">
                          <Info className="h-3 w-3" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 text-xs" modal>
                        Days your Ready to Assign can fund based on average daily spend.
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="text-sm font-bold">{runwayDays}d</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
