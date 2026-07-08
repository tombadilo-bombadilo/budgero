import { Button } from '@shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@shared/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import type { GetMonthlyBudgetRow, Goal } from '@budgero/core/browser';
import { asMilli, formatMilli } from '@shared/lib/currency/milli';
import { useAllowOverAssignment } from '@shared/hooks/useUserPreferences';
import { useMaskedLocalizer } from '@shared/lib/privacy/useMaskedLocalizer';
import { useAssignDropdownState } from './useAssignDropdownState';
import { AssignQuickActions } from './AssignQuickActions';

export interface AssignDropdownProps {
  /** Ready-to-assign amount in integer milliunits. */
  readyToAssign: number;
  currentMonth: string;
  budgetId: number;
  budgetData: GetMonthlyBudgetRow[];
  goals: Goal[];
  globalLocalizer: Intl.NumberFormat;
  variant?: 'default' | 'small';
  fullWidth?: boolean;
}

export function AssignDropdown({
  readyToAssign,
  currentMonth,
  budgetId,
  budgetData,
  goals,
  globalLocalizer,
  variant = 'default',
  fullWidth = false,
}: AssignDropdownProps) {
  const { data: allowOverAssignment = false } = useAllowOverAssignment();
  // Mask amounts in the dropdown and its action toasts while privacy mode is on.
  const maskedLocalizer = useMaskedLocalizer(globalLocalizer);
  const {
    isAssigning,
    underfundedGoals,
    overspentCategories,
    overfundedCategories,
    totalUnderfunded,
    totalOverspent,
    totalSafeReduction,
    showReduceOnly,
    handleAutoAssignUnderfunded,
    handleCoverOverspending,
    handleReduceOverfunding,
    handleResetAvailable,
    handleResetAssigned,
  } = useAssignDropdownState({
    readyToAssign,
    currentMonth,
    budgetId,
    budgetData,
    goals,
    globalLocalizer: maskedLocalizer,
    allowOverAssignment,
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size={variant === 'small' ? 'sm' : 'default'}
          variant="outline"
          disabled={isAssigning && !showReduceOnly}
          className={`flex items-center gap-1 ${fullWidth ? 'w-full justify-center' : ''}`}
        >
          {isAssigning ? 'Processing...' : showReduceOnly ? 'Manage' : 'Assign'}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Available: {formatMilli(maskedLocalizer, asMilli(readyToAssign))}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <AssignQuickActions
          readyToAssign={readyToAssign}
          isAssigning={isAssigning}
          underfundedGoals={underfundedGoals}
          overspentCategories={overspentCategories}
          overfundedCategories={overfundedCategories}
          totalUnderfunded={totalUnderfunded}
          totalOverspent={totalOverspent}
          totalSafeReduction={totalSafeReduction}
          budgetData={budgetData}
          globalLocalizer={maskedLocalizer}
          allowOverAssignment={allowOverAssignment}
          onAutoAssignUnderfunded={handleAutoAssignUnderfunded}
          onCoverOverspending={handleCoverOverspending}
          onReduceOverfunding={handleReduceOverfunding}
          onResetAvailable={handleResetAvailable}
          onResetAssigned={handleResetAssigned}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
