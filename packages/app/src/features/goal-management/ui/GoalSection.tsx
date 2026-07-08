import { useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent } from '@shared/ui/dialog';
import { useUiStore } from '@shared/store/useUiStore';
import { toastError } from '@shared/lib/errors';
import {
  useCreateGoal,
  useUpdateGoal,
  useDeleteGoal,
  useGoalByCategory,
  useCategoryFinancials,
} from '@entities/goal/api/useGoals';
import { GoalCard } from '@features/goal-management/ui/GoalCard';
import { GoalForm } from '@features/goal-management/ui/GoalForm';
import type { Goal } from '@budgero/core/browser';
import { GoalPurpose, GoalType } from '@budgero/core/browser';

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
  const [isFormOpen, setIsFormOpen] = useState(false);
  const highlightGoalCategoryId = useUiStore((state) => state.highlightGoalCategoryId);
  const setHighlightGoalCategoryId = useUiStore((state) => state.setHighlightGoalCategoryId);
  const { data: goal, isLoading } = useGoalByCategory(categoryId);

  // Fetch complete financials via GoalService — includes historical assignments,
  // historical activity, and planned assignments in one call
  const { data: categoryFinancials } = useCategoryFinancials(categoryId, currentMonth, {
    Available: finances.available,
    Assigned: finances.assigned,
    Activity: finances.activity,
  });

  const shouldHighlightCreate = !goal && highlightGoalCategoryId === categoryId;

  const createGoalMutation = useCreateGoal();
  const updateGoalMutation = useUpdateGoal();
  const deleteGoalMutation = useDeleteGoal();

  const currencyCode = formatter.resolvedOptions().currency;
  const financialsWithCurrency = categoryFinancials
    ? { ...categoryFinancials, currencyCode }
    : { ...finances, currencyCode };

  const handleSave = async (goalData: Partial<Goal>) => {
    try {
      if (goal) {
        await updateGoalMutation.mutateAsync({
          categoryId,
          target: goalData.Target ?? 0,
          type: goalData.Type ?? GoalType.MONTHLY_SAVINGS,
          purpose: goalData.Purpose ?? GoalPurpose.SAVINGS,
          targetDate: goalData.TargetDate || new Date().toISOString(),
          recurring: goalData.Recurring,
          budgetId,
        });
      } else {
        await createGoalMutation.mutateAsync({
          type: goalData.Type ?? GoalType.MONTHLY_SAVINGS,
          purpose: goalData.Purpose ?? GoalPurpose.SAVINGS,
          categoryId,
          target: goalData.Target ?? 0,
          startDate: goalData.StartDate ?? new Date().toISOString(),
          targetDate: goalData.TargetDate || new Date().toISOString(),
          recurring: goalData.Recurring,
          budgetId,
        });
      }

      setHighlightGoalCategoryId(null);
      setIsFormOpen(false);
      toast.success(goal ? 'Goal updated' : 'Goal created', {
        description: goal
          ? 'Your goal has been updated successfully.'
          : 'Your new goal has been created.',
      });
    } catch (error) {
      toastError('Failed to save goal', error, 'Please try again.');
    }
  };

  const handleDelete = async () => {
    if (!goal) return;

    try {
      await deleteGoalMutation.mutateAsync({
        id: goal.ID,
        categoryId,
        budgetId,
      });

      setIsFormOpen(false);
      toast.success('Goal deleted', {
        description: 'The goal has been permanently removed.',
      });
    } catch {
      toast.error('Failed to delete goal', {
        description: 'Please try again.',
      });
    }
  };

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
          setIsFormOpen(true);
        }}
        onDelete={handleDelete}
        compact={compact}
        className={className}
        highlightCreate={shouldHighlightCreate}
      />

      {/* Goal Form Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="p-3 sm:p-6 max-w-[22rem] sm:max-w-lg md:max-w-xl max-h-[90dvh] overflow-y-auto">
          <GoalForm
            goal={goal}
            categoryId={categoryId}
            categoryName={categoryName}
            budgetId={budgetId}
            currentMonth={currentMonth}
            formatter={formatter}
            onSave={handleSave}
            onCancel={() => {
              setIsFormOpen(false);
              if (!goal) {
                setHighlightGoalCategoryId(categoryId);
              }
            }}
            onDelete={goal ? handleDelete : undefined}
            isSaving={createGoalMutation.isPending || updateGoalMutation.isPending}
            isDeleting={deleteGoalMutation.isPending}
            asCard={false}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
