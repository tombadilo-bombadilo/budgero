import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useState } from 'react';
import { toDecimal, ZERO_MILLI } from '@budgero/core/browser';
import { Button } from '@shared/ui/button';
import { Label } from '@shared/ui/label';
import { CardContent, CardHeader, CardTitle, CardDescription } from '@shared/ui/card';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { MonthYearCalendar } from '@shared/ui/MonthYearCalendar';
import {
  Target,
  Calendar as CalendarIcon,
  AlertCircle,
  Save,
  Wallet,
  ArrowUpFromLine,
  CalendarClock,
  PiggyBank,
  ChevronRight,
  Repeat,
  RefreshCw,
  Flag,
} from 'lucide-react';
import { Input } from '@shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { format } from 'date-fns';
import {
  type Goal,
  GoalCalculations,
  GoalType,
  GoalPurpose,
  getCycleMonths,
  isValidCycleMonths,
  MIN_GOAL_CYCLE_MONTHS,
  MAX_GOAL_CYCLE_MONTHS,
  GOAL_CYCLE_MONTHS_ERROR,
} from '@budgero/core/browser';
import { cn } from '@shared/lib/utils';
import { describeLocalizedGoalCycle } from '../lib/goal-cycle-label';

interface GoalFormProps {
  goal?: Goal | null;
  categoryId: number;
  categoryName: string;
  budgetId: number;
  currentMonth: string;
  formatter: Intl.NumberFormat;
  onSave: (goalData: Partial<Goal>) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
  isSaving?: boolean;
  isDeleting?: boolean;
  asCard?: boolean;
}

/**
 * Each "goal preset" maps a user-friendly concept to the internal GoalType + GoalPurpose.
 *
 * 1. monthly-available  → MONTHLY    + SPENDING  — "Have X available each month"
 * 2. monthly-allocation → MONTHLY_SAVINGS + SAVINGS — "Assign X each month"
 * 3. yearly-allocation  → TARGET_DATE + SAVINGS  — "Allocate X total by date"
 * 4. yearly-available   → YEARLY     + SPENDING  — "Have X available by date"
 * 5. target-balance     → TARGET_BALANCE + SAVINGS — "Have X available", no date or repeat
 */
type GoalPreset =
  | 'monthly-available'
  | 'monthly-allocation'
  | 'yearly-allocation'
  | 'yearly-available'
  | 'periodic-allocation'
  | 'periodic-available'
  | 'target-balance';

function presetFromGoal(goal: Goal): GoalPreset {
  if (goal.Type === GoalType.MONTHLY) return 'monthly-available';
  if (goal.Type === GoalType.MONTHLY_SAVINGS) return 'monthly-allocation';
  if (goal.Type === GoalType.TARGET_BALANCE) return 'target-balance';
  const cycle = getCycleMonths(goal);
  const periodic = cycle !== null && cycle !== 12;
  if (goal.Type === GoalType.TARGET_DATE)
    return periodic ? 'periodic-allocation' : 'yearly-allocation';
  if (goal.Type === GoalType.YEARLY) return periodic ? 'periodic-available' : 'yearly-available';
  return 'monthly-available';
}

/** Cadence for periodic presets: quarterly | every 6 months | custom N. */
type PeriodMode = '3' | '6' | 'custom';
const PERIOD_PRESETS = [3, 6];

function parseGoalDate(value: string | undefined): Date | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Last day of the month that is `months - 1` months after `start`'s month. */
function endOfPeriod(start: Date, months: number): Date {
  return new Date(start.getFullYear(), start.getMonth() + months, 0);
}

export function GoalForm({
  goal,
  categoryId,
  categoryName,
  budgetId,
  currentMonth,
  formatter,
  onSave,
  onCancel: _onCancel,
  onDelete,
  isSaving = false,
  isDeleting = false,
  asCard = true,
}: GoalFormProps) {
  const { t } = useLingui();

  const GOAL_PRESETS: {
    key: GoalPreset;
    type: GoalType;
    purpose: GoalPurpose;
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    buildExample: (amount: string, date: string) => string;
    /** Yearly presets: pick a target date (optionally repeating every year). */
    needsDate: boolean;
    /** Periodic presets: pick a start date + cadence; the target date is derived. */
    periodic?: boolean;
  }[] = [
    {
      key: 'monthly-available',
      type: GoalType.MONTHLY,
      purpose: GoalPurpose.SPENDING,
      icon: <Wallet className="h-5 w-5" />,
      title: t`Monthly Available Target`,
      subtitle: t`Start each month with a certain amount available`,
      buildExample: (amount) => t`e.g. Groceries — start each month with ${amount}`,
      needsDate: false,
    },
    {
      key: 'monthly-allocation',
      type: GoalType.MONTHLY_SAVINGS,
      purpose: GoalPurpose.SAVINGS,
      icon: <ArrowUpFromLine className="h-5 w-5" />,
      title: t`Monthly Allocation Target`,
      subtitle: t`Assign a fixed amount every month, regardless of spending`,
      buildExample: (amount) => t`e.g. Savings — put aside ${amount} each month`,
      needsDate: false,
    },
    {
      key: 'yearly-allocation',
      type: GoalType.TARGET_DATE,
      purpose: GoalPurpose.SAVINGS,
      icon: <CalendarClock className="h-5 w-5" />,
      title: t`Yearly Allocation Target`,
      subtitle: t`Allocate a total amount over a period by a target date`,
      buildExample: (amount, date) => t`e.g. Vacation — allocate ${amount} total by ${date}`,
      needsDate: true,
    },
    {
      key: 'yearly-available',
      type: GoalType.YEARLY,
      purpose: GoalPurpose.SPENDING,
      icon: <PiggyBank className="h-5 w-5" />,
      title: t`Yearly Available Target`,
      subtitle: t`Have a specific amount available by a target date`,
      buildExample: (amount, date) => t`e.g. Car registration — need ${amount} ready by ${date}`,
      needsDate: true,
    },
    {
      key: 'periodic-allocation',
      type: GoalType.TARGET_DATE,
      purpose: GoalPurpose.SAVINGS,
      icon: <Repeat className="h-5 w-5" />,
      title: t`Periodic Allocation Target`,
      subtitle: t`Allocate a total amount every few months, cycle after cycle`,
      buildExample: (amount) => t`e.g. Quarterly tax — allocate ${amount} every 3 months`,
      needsDate: false,
      periodic: true,
    },
    {
      key: 'periodic-available',
      type: GoalType.YEARLY,
      purpose: GoalPurpose.SPENDING,
      icon: <RefreshCw className="h-5 w-5" />,
      title: t`Periodic Available Target`,
      subtitle: t`Have an amount available at the end of every period`,
      buildExample: (amount) => t`e.g. Insurance — have ${amount} ready every 6 months`,
      needsDate: false,
      periodic: true,
    },
    {
      key: 'target-balance',
      type: GoalType.TARGET_BALANCE,
      purpose: GoalPurpose.SAVINGS,
      icon: <Flag className="h-5 w-5" />,
      title: t`Target Balance`,
      subtitle: t`Build up to an amount available, with no date and no repeat`,
      buildExample: (amount) => t`e.g. Emergency fund — build up to ${amount}`,
      needsDate: false,
    },
  ];

  const isEditing = !!goal;

  const [selectedPreset, setSelectedPreset] = useState<GoalPreset>(
    goal ? presetFromGoal(goal) : 'monthly-available'
  );
  const [target, setTarget] = useState(goal?.Target ?? ZERO_MILLI);
  const [targetDate, setTargetDate] = useState<Date>(() => {
    if (goal?.TargetDate) return new Date(goal.TargetDate);
    const date = new Date();
    date.setMonth(date.getMonth() + 6);
    return date;
  });
  const [dateOpen, setDateOpen] = useState(false);
  const initialCycle = goal ? getCycleMonths(goal) : null;
  // Yearly presets: repeat every year or not at all.
  const [repeatsYearly, setRepeatsYearly] = useState(initialCycle === 12);
  // Periodic presets: start date + cadence (quarterly | 6 months | custom N).
  const [periodStart, setPeriodStart] = useState<Date>(
    () => parseGoalDate(goal?.StartDate) ?? new Date()
  );
  const [periodStartOpen, setPeriodStartOpen] = useState(false);
  const [periodMode, setPeriodMode] = useState<PeriodMode>(() => {
    if (initialCycle === null || initialCycle === 12) return '3';
    return PERIOD_PRESETS.includes(initialCycle) ? (String(initialCycle) as PeriodMode) : 'custom';
  });
  const [customCycleMonths, setCustomCycleMonths] = useState<string>(() =>
    initialCycle !== null && initialCycle !== 12 && !PERIOD_PRESETS.includes(initialCycle)
      ? String(initialCycle)
      : ''
  );
  const [errors, setErrors] = useState<string[]>([]);

  const activePreset = GOAL_PRESETS.find((p) => p.key === selectedPreset) ?? GOAL_PRESETS[0];
  const isPeriodic = !!activePreset.periodic;

  // Effective recurring/cadence for the active preset.
  const recurring = isPeriodic || (activePreset.needsDate && repeatsYearly);
  const cycleMonths: number | null = !recurring
    ? null
    : isPeriodic
      ? periodMode === 'custom'
        ? Number(customCycleMonths)
        : Number(periodMode)
      : 12;
  const cycleMonthsValid = !recurring || isValidCycleMonths(cycleMonths);
  // Periodic goals: the target date is the end of the first cycle.
  const derivedTargetDate = useMemo(
    () => (isPeriodic && cycleMonthsValid ? endOfPeriod(periodStart, cycleMonths ?? 3) : null),
    [isPeriodic, cycleMonthsValid, periodStart, cycleMonths]
  );
  const effectiveTargetDate = isPeriodic ? (derivedTargetDate ?? targetDate) : targetDate;
  const effectiveStartDate = isPeriodic
    ? format(periodStart, 'yyyy-MM-dd')
    : goal?.StartDate || `${currentMonth}-01`;

  // Live preview of the cycle the progress maths will use, from the same core
  // function, so the editor and the card can never disagree.
  const cyclePreview = useMemo(() => {
    if (!recurring || !cycleMonthsValid) return null;
    const c = GoalCalculations.computeCycle(
      {
        ID: goal?.ID ?? 0,
        Type: GoalType.TARGET_DATE,
        Purpose: GoalPurpose.SAVINGS,
        CategoryID: categoryId,
        Target: ZERO_MILLI,
        StartDate: effectiveStartDate,
        TargetDate: effectiveTargetDate.toISOString(),
        Recurring: true,
        CycleMonths: cycleMonths,
      },
      currentMonth
    );
    const label = (m: string) =>
      format(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1), 'MMM yyyy');
    return {
      rangeLabel: `${label(c.cycleStart)} – ${label(c.cycleEnd)}`,
      targetDate: c.cycleTargetDate,
    };
  }, [
    recurring,
    cycleMonthsValid,
    cycleMonths,
    effectiveTargetDate,
    effectiveStartDate,
    currentMonth,
    goal,
    categoryId,
  ]);

  const handlePresetChange = (key: GoalPreset) => {
    setSelectedPreset(key);
    setErrors([]);
  };

  const validateForm = (): boolean => {
    const validationResult = GoalCalculations.validateGoal({
      Type: activePreset.type,
      Purpose: activePreset.purpose,
      Target: target,
      CategoryID: categoryId,
      StartDate: effectiveStartDate,
      TargetDate:
        activePreset.needsDate || isPeriodic ? effectiveTargetDate.toISOString() : undefined,
      Recurring: recurring,
      CycleMonths: recurring ? cycleMonths : null,
    });
    const allErrors = [...validationResult.errors];
    if (recurring && !cycleMonthsValid && !allErrors.includes(GOAL_CYCLE_MONTHS_ERROR)) {
      allErrors.push(GOAL_CYCLE_MONTHS_ERROR);
    }
    setErrors(allErrors);
    return allErrors.length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    const preset = activePreset;
    const goalData: Partial<Goal> = {
      Type: preset.type,
      Purpose: preset.purpose,
      CategoryID: categoryId,
      Target: target,
      StartDate: effectiveStartDate,
      BudgetID: budgetId,
    };

    if (preset.needsDate || isPeriodic) {
      goalData.TargetDate = effectiveTargetDate.toISOString();
      goalData.Recurring = recurring;
      goalData.CycleMonths = recurring ? cycleMonths : null;
    } else {
      // Monthly presets never repeat: clear any cadence left over from a
      // previous dated preset so the stored row doesn't keep Recurring=1.
      goalData.Recurring = false;
      goalData.CycleMonths = null;
    }

    await onSave(goalData);
  };

  return (
    <div className="w-full">
      <CardHeader className={asCard ? undefined : 'px-0 sm:px-6'}>
        <CardTitle className="flex items-center gap-2">
          <Trans>
            <Target className="h-5 w-5" />
            {isEditing ? t`Edit Goal` : t`Create Goal`} for {categoryName}
          </Trans>
        </CardTitle>
        <CardDescription>
          <Trans>Choose how you want to track this category.</Trans>
        </CardDescription>
      </CardHeader>

      <CardContent className={asCard ? undefined : 'px-0 sm:px-6'}>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* ── Goal Type Selection ── */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              <Trans>Goal Type</Trans>
            </Label>
            <div className="grid gap-2">
              {GOAL_PRESETS.map((preset) => {
                const isActive = selectedPreset === preset.key;
                return (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => handlePresetChange(preset.key)}
                    className={cn(
                      'group relative w-full rounded-lg border px-3.5 py-3 text-left transition-all',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isActive
                        ? 'border-primary bg-primary/[0.04] dark:bg-primary/10 ring-1 ring-primary/20'
                        : 'border-border/60 hover:border-border hover:bg-muted/30'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground group-hover:bg-muted/80'
                        )}
                      >
                        {preset.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              'text-sm font-semibold leading-tight',
                              isActive ? 'text-primary' : 'text-foreground'
                            )}
                          >
                            {preset.title}
                          </span>
                          <ChevronRight
                            className={cn(
                              'h-4 w-4 shrink-0 transition-transform',
                              isActive ? 'text-primary rotate-90' : 'text-muted-foreground/40'
                            )}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground leading-snug mt-0.5">
                          {preset.subtitle}
                        </p>
                        <p className="text-[11px] text-muted-foreground/60 italic mt-1">
                          {preset.buildExample(
                            target > 0 ? formatter.format(toDecimal(target)) : 'X',
                            format(targetDate, 'MMM d, yyyy')
                          )}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Target Amount ── */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              <Trans>Target Amount</Trans>
            </Label>
            <CalculatorCell
              value={target}
              onCommit={setTarget}
              formatter={formatter.format}
              localizer={formatter}
              inputAlign="center"
              placeholder={t`Enter amount`}
              zeroAsEmpty
              useFormatterForDisplay
              displayClassName="text-sm font-medium border-2 rounded-md px-3 py-2 h-10 flex items-center justify-center bg-background hover:border-primary/40 transition-colors"
              inputClassName="text-sm h-10"
            />
            <p className="text-xs text-muted-foreground">
              {selectedPreset === 'monthly-available' &&
                t`The available balance you want in this category each month.`}
              {selectedPreset === 'monthly-allocation' &&
                t`How much you want to assign to this category every month.`}
              {selectedPreset === 'yearly-allocation' &&
                t`The total amount to allocate across the period. Monthly target is calculated automatically.`}
              {selectedPreset === 'yearly-available' &&
                t`The amount you need available in this category by the target date.`}
              {selectedPreset === 'periodic-allocation' &&
                t`The total to allocate in each cycle. Monthly target is calculated automatically.`}
              {selectedPreset === 'periodic-available' &&
                t`The amount you need available by the end of each cycle.`}
              {selectedPreset === 'target-balance' &&
                t`The balance you want to build up in this category. Spending lowers it again.`}
            </p>
          </div>

          {/* ── Target Date (yearly goals only) ── */}
          {activePreset.needsDate && (
            <div className="space-y-3">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                <Trans>Target Date</Trans>
              </Label>
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(targetDate, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 max-h-[70vh] overflow-y-auto" modal>
                  <MonthYearCalendar
                    selected={targetDate}
                    onSelect={(date) => {
                      if (date) {
                        setTargetDate(date);
                        setDateOpen(false);
                      }
                    }}
                  />
                </PopoverContent>
              </Popover>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  <Trans>Repeats</Trans>
                </Label>
                <Select
                  value={repeatsYearly ? '12' : 'never'}
                  onValueChange={(value) => setRepeatsYearly(value === '12')}
                >
                  <SelectTrigger
                    className="w-full min-w-0 sm:w-56"
                    data-testid="goal-repeat-select"
                  >
                    <SelectValue placeholder={t`Never`} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">
                      <Trans>Never</Trans>
                    </SelectItem>
                    <SelectItem value="12">
                      <Trans>Every year</Trans>
                    </SelectItem>
                  </SelectContent>
                </Select>
                {repeatsYearly && cyclePreview && (
                  <p className="text-xs text-muted-foreground" data-testid="goal-cycle-preview">
                    <Trans>
                      Repeats yearly. Current cycle: {cyclePreview.rangeLabel} · this cycle&apos;s
                      target {format(cyclePreview.targetDate, 'PPP')}. Cycles are counted from the
                      target date; the goal amount applies to each cycle.
                    </Trans>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── Periodic goals: start date + cadence ── */}
          {isPeriodic && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    <Trans>Repeats every</Trans>
                  </Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={periodMode}
                      onValueChange={(value) => setPeriodMode(value as PeriodMode)}
                    >
                      <SelectTrigger className="w-full min-w-0" data-testid="goal-period-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="3">
                          <Trans>Quarter (3 months)</Trans>
                        </SelectItem>
                        <SelectItem value="6">
                          <Trans>6 months</Trans>
                        </SelectItem>
                        <SelectItem value="custom">
                          <Trans>N months…</Trans>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {periodMode === 'custom' && (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={MIN_GOAL_CYCLE_MONTHS}
                          max={MAX_GOAL_CYCLE_MONTHS}
                          step={1}
                          required
                          value={customCycleMonths}
                          onChange={(e) => setCustomCycleMonths(e.target.value)}
                          className="w-20"
                          aria-label={t`Repeat every N months`}
                          data-testid="goal-repeat-custom-input"
                        />
                        <span className="text-sm text-muted-foreground">
                          <Trans>months</Trans>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    <Trans>Starting</Trans>
                  </Label>
                  <Popover open={periodStartOpen} onOpenChange={setPeriodStartOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full justify-start text-left font-normal"
                        data-testid="goal-period-start"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {format(periodStart, 'PPP')}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 max-h-[70vh] overflow-y-auto" modal>
                      <MonthYearCalendar
                        selected={periodStart}
                        onSelect={(date) => {
                          if (date) {
                            setPeriodStart(date);
                            setPeriodStartOpen(false);
                          }
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              {cycleMonthsValid && cyclePreview && (
                <p className="text-xs text-muted-foreground" data-testid="goal-cycle-preview">
                  <Trans>
                    Repeats {describeLocalizedGoalCycle(cycleMonths as number)} from{' '}
                    {format(periodStart, 'MMM yyyy')}. Current cycle: {cyclePreview.rangeLabel} ·
                    this cycle&apos;s target {format(cyclePreview.targetDate, 'PPP')}. The goal
                    amount applies to each cycle.
                  </Trans>
                </p>
              )}
            </div>
          )}

          {/* ── Validation Errors ── */}
          {errors.length > 0 && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <ul className="list-disc list-inside">
                  {errors.map((error, idx) => (
                    <li key={idx}>{error}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* ── Actions ── */}
          <div className="flex items-center justify-between pt-4 border-t">
            <div>
              {isEditing && onDelete && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={onDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? t`Deleting...` : t`Delete Goal`}
                </Button>
              )}
            </div>
            <Button type="submit" disabled={isSaving || isDeleting}>
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? t`Saving...` : isEditing ? t`Update Goal` : t`Create Goal`}
            </Button>
          </div>
        </form>
      </CardContent>
    </div>
  );
}
