import { Trans, useLingui } from '@lingui/react/macro';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent } from '@shared/ui/dialog';
import { useUiStore } from '@shared/store/useUiStore';
import { toastError } from '@shared/lib/errors';
import {
  useCreateGoal,
  useUpdateGoal,
  useDeleteGoal,
  useSetGoalFrom,
  useGoalByCategory,
  useGoalTimeframes,
  useCategoryFinancials,
} from '@entities/goal/api/useGoals';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import { Label } from '@shared/ui/label';
import { GoalCard } from '@features/goal-management/ui/GoalCard';
import { GoalForm } from '@features/goal-management/ui/GoalForm';
import type { Goal, MilliUnits } from '@budgero/core/browser';
import {
  dispatchGoalWalkthrough,
  useGoalWalkthroughFormHint,
} from '@features/first-steps/model/goal-walkthrough';
import { GoalPurpose, GoalType, describeGoalTimeframeChange } from '@budgero/core/browser';
import {
  defaultGoalTimeframe,
  goalDeleteKeepsHistory,
  goalSaveAction,
  goalTimeframeRange,
  type GoalTimeframeChoice,
} from '../lib/goal-timeframe';
import { goalMonthLabel, useGoalRangeLabel } from '../lib/goal-timeframe-labels';
import { GoalTimeframeNotices } from './GoalTimeframeFields';
import { GoalConversionPreview } from './GoalConversionPreview';

interface GoalSectionProps {
  categoryId: number;
  categoryName: string;
  budgetId: number;
  finances: {
    available: number;
    assigned: number;
    activity: number;
  };
  currentMonth: string;
  formatter: Intl.NumberFormat;
  compact?: boolean;
  className?: string;
}

/**
 * GoalSection - A complete goal management section
 * Handles display, creation, editing, and deletion of goals
 * Can be embedded in budget tables or used standalone
 */
export function GoalSection({
  categoryId,
  categoryName,
  budgetId,
  finances,
  currentMonth,
  formatter,
  compact = false,
  className,
}: GoalSectionProps) {
  const { t } = useLingui();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const highlightGoalCategoryId = useUiStore((state) => state.highlightGoalCategoryId);
  const setHighlightGoalCategoryId = useUiStore((state) => state.setHighlightGoalCategoryId);
  // The goal of the month on screen; a category can have one per timeframe.
  const { data: goal, isLoading } = useGoalByCategory(categoryId, currentMonth);
  const { data: timeframes = [] } = useGoalTimeframes(categoryId);
  const rangeLabel = useGoalRangeLabel();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteScope, setDeleteScope] = useState<'onwards' | 'all'>('onwards');

  // Fetch complete financials via GoalService — includes historical assignments,
  // historical activity, and planned assignments in one call
  const { data: categoryFinancials } = useCategoryFinancials(categoryId, currentMonth, {
    Available: finances.available,
    Assigned: finances.assigned,
    Activity: finances.activity,
  });

  const shouldHighlightCreate = !goal && highlightGoalCategoryId === categoryId;

  // The first-steps goal walkthrough follows the form: open, saved, or closed.
  const walkthroughHint = useGoalWalkthroughFormHint(categoryId);
  const setFormOpen = (open: boolean) => {
    setIsFormOpen(open);
    if (!goal) dispatchGoalWalkthrough({ type: open ? 'formOpened' : 'formClosed', categoryId });
  };

  const createGoalMutation = useCreateGoal();
  const updateGoalMutation = useUpdateGoal();
  const setGoalFromMutation = useSetGoalFrom();
  const deleteGoalMutation = useDeleteGoal();

  const currencyCode = formatter.resolvedOptions().currency;
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const budgetCurrency = selectedBudget?.DisplayCurrency ?? currencyCode ?? 'USD';
  const numberFormat = selectedBudget?.NumberFormat;
  // Stable per category/budget, so the form doesn't remount its preview on every render.
  const ConversionPreview = useMemo(
    () =>
      function Preview({ target, currency }: { target: MilliUnits; currency: string }) {
        return (
          <GoalConversionPreview
            target={target}
            currency={currency}
            categoryId={categoryId}
            budgetId={budgetId}
            budgetCurrency={budgetCurrency}
            formatter={formatter}
          />
        );
      },
    [categoryId, budgetId, budgetCurrency, formatter]
  );
  const financialsWithCurrency = categoryFinancials
    ? { ...categoryFinancials, currencyCode }
    : { ...finances, currencyCode };

  const handleSave = async (
    goalData: Partial<Goal>,
    timeframe: GoalTimeframeChoice = defaultGoalTimeframe(goal, timeframes, currentMonth)
  ) => {
    const fields = {
      target: goalData.Target ?? 0,
      type: goalData.Type ?? GoalType.MONTHLY_SAVINGS,
      purpose: goalData.Purpose ?? GoalPurpose.SAVINGS,
      targetDate: goalData.TargetDate || new Date().toISOString(),
      recurring: goalData.Recurring,
      cycleMonths: goalData.CycleMonths,
      targetCurrency: goalData.TargetCurrency ?? null,
    };
    const action = goalSaveAction(goal, timeframes, timeframe, currentMonth);
    try {
      if (action.kind === 'update') {
        await updateGoalMutation.mutateAsync({
          ...fields,
          categoryId,
          startDate: goalData.StartDate,
          effectiveFrom: action.effectiveFrom,
          budgetId,
        });
      } else if (action.kind === 'setFrom') {
        await setGoalFromMutation.mutateAsync({
          ...fields,
          categoryId,
          fromMonth: action.from,
          toMonth: action.to,
          startDate: goalData.StartDate ?? `${action.from}-01`,
          budgetId,
        });
      } else {
        await createGoalMutation.mutateAsync({
          ...fields,
          categoryId,
          startDate: goalData.StartDate ?? new Date().toISOString(),
          effectiveFrom: action.effectiveFrom,
          effectiveTo: action.effectiveTo,
          budgetId,
        });
      }
      if (!goal) dispatchGoalWalkthrough({ type: 'goalSaved', categoryId });

      setHighlightGoalCategoryId(null);
      setIsFormOpen(false);
      toast.success(goal ? t`Goal updated` : t`Goal created`, {
        description: goal
          ? t`Your goal has been updated successfully.`
          : t`Your new goal has been created.`,
      });
    } catch (error) {
      toastError('Failed to save goal', error, 'Please try again.');
    }
  };

  const keepsHistory = goalDeleteKeepsHistory(timeframes, currentMonth);
  const scope = keepsHistory ? deleteScope : 'all';
  const deleteNotices = useMemo(
    () =>
      goal ? describeGoalTimeframeChange(timeframes, { kind: 'endFrom', month: currentMonth }) : [],
    [goal, timeframes, currentMonth]
  );

  const requestDelete = async () => {
    if (!goal) return;
    setDeleteScope('onwards');
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!goal) return;

    try {
      await deleteGoalMutation.mutateAsync({
        id: goal.ID,
        categoryId,
        budgetId,
        ...(scope === 'onwards' ? { fromMonth: currentMonth } : {}),
      });

      setDeleteOpen(false);
      setIsFormOpen(false);
      toast.success(t`Goal deleted`, {
        description:
          scope === 'onwards'
            ? t`Months before ${goalMonthLabel(currentMonth)} keep their goal.`
            : t`The goal has been removed from every month.`,
      });
    } catch {
      toast.error(t`Failed to delete goal`, {
        description: t`Please try again.`,
      });
    }
  };

  const range = goal ? goalTimeframeRange(goal, timeframes) : null;
  const timeframeLabel =
    range && (range.from !== null || range.to !== null)
      ? rangeLabel(range.from, range.to)
      : undefined;

  if (isLoading || !categoryFinancials) {
    return (
      <div className={className}>
        <div className="animate-pulse">
          <div className="h-20 bg-muted rounded-md" />
        </div>
      </div>
    );
  }

  return (
    <>
      <GoalCard
        goal={goal || null}
        categoryName={categoryName}
        finances={financialsWithCurrency}
        currentMonth={currentMonth}
        formatter={formatter}
        onEdit={() => setIsFormOpen(true)}
        onCreate={() => {
          setHighlightGoalCategoryId(null);
          setFormOpen(true);
        }}
        onDelete={requestDelete}
        timeframeLabel={timeframeLabel}
        compact={compact}
        className={className}
        highlightCreate={shouldHighlightCreate}
      />

      {/* Goal Form Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setFormOpen}>
        {/* Fixed height budget: the form scrolls inside, Save/Cancel stay pinned. */}
        <DialogContent className="flex max-h-[min(90dvh,calc(100dvh-2rem))] max-w-[22rem] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg md:max-w-xl">
          <GoalForm
            notice={
              walkthroughHint && (
                // First steps: one line inside the form, so it never covers a field.
                <p
                  className="rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary"
                  data-testid="goal-walkthrough-hint"
                  aria-live="polite"
                >
                  <Trans>Pick a type, enter the amount, save.</Trans>
                </p>
              )
            }
            // Remount per goal and month: the form's starting choices depend on both.
            key={`${goal?.ID ?? 'new'}-${currentMonth}`}
            goal={goal}
            timeframes={timeframes}
            categoryId={categoryId}
            categoryName={categoryName}
            budgetId={budgetId}
            currentMonth={currentMonth}
            formatter={formatter}
            budgetCurrency={budgetCurrency}
            numberFormat={numberFormat}
            ConversionPreview={ConversionPreview}
            onSave={handleSave}
            onCancel={() => {
              setFormOpen(false);
              if (!goal) {
                setHighlightGoalCategoryId(categoryId);
              }
            }}
            onDelete={goal ? requestDelete : undefined}
            isSaving={
              createGoalMutation.isPending ||
              updateGoalMutation.isPending ||
              setGoalFromMutation.isPending
            }
            isDeleting={deleteGoalMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t`Delete goal for ${categoryName}?`}
        description={
          keepsHistory
            ? t`Choose which months lose the goal. You can undo this.`
            : t`No earlier month has its own goal, so it is removed from every month. You can undo this.`
        }
        confirmText={t`Delete Goal`}
        cancelText={t`Cancel`}
        loadingText={t`Deleting...`}
        variant="destructive"
        isLoading={deleteGoalMutation.isPending}
        onConfirm={handleDelete}
      >
        {keepsHistory && (
          <div className="space-y-3" data-testid="goal-delete-scope">
            <RadioGroup
              value={deleteScope}
              onValueChange={(value) => setDeleteScope(value as 'onwards' | 'all')}
              className="gap-2"
            >
              <div className="flex items-start gap-2 text-sm">
                <RadioGroupItem id="goal-delete-onwards" value="onwards" className="mt-0.5" />
                <Label htmlFor="goal-delete-onwards" className="block font-normal leading-snug">
                  <Trans>From {goalMonthLabel(currentMonth)} onwards</Trans>
                  <span className="block text-xs text-muted-foreground">
                    <Trans>Earlier months keep the goal they had.</Trans>
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-2 text-sm">
                <RadioGroupItem id="goal-delete-all" value="all" className="mt-0.5" />
                <Label htmlFor="goal-delete-all" className="block font-normal leading-snug">
                  <Trans>Every month</Trans>
                  <span className="block text-xs text-muted-foreground">
                    <Trans>Removes all of this category&apos;s goals, past ones too.</Trans>
                  </span>
                </Label>
              </div>
            </RadioGroup>
            {deleteScope === 'onwards' && (
              <GoalTimeframeNotices notices={deleteNotices} formatter={formatter} />
            )}
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
