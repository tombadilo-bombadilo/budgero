import { useState } from 'react';
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
} from 'lucide-react';
import { Checkbox } from '@shared/ui/checkbox';
import { format } from 'date-fns';
import { type Goal, GoalCalculations, GoalType, GoalPurpose } from '@budgero/core/browser';
import { cn } from '@shared/lib/utils';

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
 */
type GoalPreset =
  | 'monthly-available'
  | 'monthly-allocation'
  | 'yearly-allocation'
  | 'yearly-available';

const GOAL_PRESETS: {
  key: GoalPreset;
  type: GoalType;
  purpose: GoalPurpose;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  buildExample: (amount: string, date: string) => string;
  needsDate: boolean;
}[] = [
  {
    key: 'monthly-available',
    type: GoalType.MONTHLY,
    purpose: GoalPurpose.SPENDING,
    icon: <Wallet className="h-5 w-5" />,
    title: 'Monthly Available Target',
    subtitle: 'Start each month with a certain amount available',
    buildExample: (amount) => `e.g. Groceries — start each month with ${amount}`,
    needsDate: false,
  },
  {
    key: 'monthly-allocation',
    type: GoalType.MONTHLY_SAVINGS,
    purpose: GoalPurpose.SAVINGS,
    icon: <ArrowUpFromLine className="h-5 w-5" />,
    title: 'Monthly Allocation Target',
    subtitle: 'Assign a fixed amount every month, regardless of spending',
    buildExample: (amount) => `e.g. Savings — put aside ${amount} each month`,
    needsDate: false,
  },
  {
    key: 'yearly-allocation',
    type: GoalType.TARGET_DATE,
    purpose: GoalPurpose.SAVINGS,
    icon: <CalendarClock className="h-5 w-5" />,
    title: 'Yearly Allocation Target',
    subtitle: 'Allocate a total amount over a period by a target date',
    buildExample: (amount, date) => `e.g. Vacation — allocate ${amount} total by ${date}`,
    needsDate: true,
  },
  {
    key: 'yearly-available',
    type: GoalType.YEARLY,
    purpose: GoalPurpose.SPENDING,
    icon: <PiggyBank className="h-5 w-5" />,
    title: 'Yearly Available Target',
    subtitle: 'Have a specific amount available by a target date',
    buildExample: (amount, date) => `e.g. Car registration — need ${amount} ready by ${date}`,
    needsDate: true,
  },
];

function presetFromGoal(goal: Goal): GoalPreset {
  if (goal.Type === GoalType.MONTHLY) return 'monthly-available';
  if (goal.Type === GoalType.MONTHLY_SAVINGS) return 'monthly-allocation';
  if (goal.Type === GoalType.TARGET_DATE) return 'yearly-allocation';
  if (goal.Type === GoalType.YEARLY) return 'yearly-available';
  return 'monthly-available';
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
  const [recurring, setRecurring] = useState(!!goal?.Recurring);
  const [errors, setErrors] = useState<string[]>([]);

  const activePreset = GOAL_PRESETS.find((p) => p.key === selectedPreset) ?? GOAL_PRESETS[0];

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
      StartDate: `${currentMonth}-01`,
      TargetDate: activePreset.needsDate ? targetDate.toISOString() : undefined,
    });
    setErrors(validationResult.errors);
    return validationResult.valid;
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
      StartDate: goal?.StartDate || `${currentMonth}-01`,
      BudgetID: budgetId,
    };

    if (preset.needsDate) {
      goalData.TargetDate = targetDate.toISOString();
      goalData.Recurring = recurring;
    }

    await onSave(goalData);
  };

  return (
    <div className="w-full">
      <CardHeader className={asCard ? undefined : 'px-0 sm:px-6'}>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          {isEditing ? 'Edit Goal' : 'Create Goal'} for {categoryName}
        </CardTitle>
        <CardDescription>Choose how you want to track this category.</CardDescription>
      </CardHeader>

      <CardContent className={asCard ? undefined : 'px-0 sm:px-6'}>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* ── Goal Type Selection ── */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Goal Type
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
              Target Amount
            </Label>
            <CalculatorCell
              value={target}
              onCommit={setTarget}
              formatter={formatter.format}
              localizer={formatter}
              inputAlign="center"
              placeholder="Enter amount"
              zeroAsEmpty
              useFormatterForDisplay
              displayClassName="text-sm font-medium border-2 rounded-md px-3 py-2 h-10 flex items-center justify-center bg-background hover:border-primary/40 transition-colors"
              inputClassName="text-sm h-10"
            />
            <p className="text-xs text-muted-foreground">
              {selectedPreset === 'monthly-available' &&
                'The available balance you want in this category each month.'}
              {selectedPreset === 'monthly-allocation' &&
                'How much you want to assign to this category every month.'}
              {selectedPreset === 'yearly-allocation' &&
                'The total amount to allocate across the period. Monthly target is calculated automatically.'}
              {selectedPreset === 'yearly-available' &&
                'The amount you need available in this category by the target date.'}
            </p>
          </div>

          {/* ── Target Date (yearly goals only) ── */}
          {activePreset.needsDate && (
            <div className="space-y-3">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Target Date
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

              <Label className="cursor-pointer font-normal">
                <Checkbox
                  checked={recurring}
                  onCheckedChange={(checked) => setRecurring(checked === true)}
                />
                <span className="text-sm">Recurring annually</span>
              </Label>
              {recurring && (
                <p className="text-xs text-muted-foreground">
                  Goal resets each year after the target date. A new cycle starts automatically.
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
                  {isDeleting ? 'Deleting...' : 'Delete Goal'}
                </Button>
              )}
            </div>
            <Button type="submit" disabled={isSaving || isDeleting}>
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? 'Saving...' : isEditing ? 'Update Goal' : 'Create Goal'}
            </Button>
          </div>
        </form>
      </CardContent>
    </div>
  );
}
