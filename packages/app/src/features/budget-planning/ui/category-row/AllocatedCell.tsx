/**
 * Allocated Cell Component
 *
 * The "Allocated" CalculatorCell shared by the category-row layout forks.
 * Layout-specific styling (sizes, alignment, highlight ring) comes in via
 * className props computed at the call site.
 *
 * The desktop table's DesktopBudgetCategoryRow keeps its own version — it
 * toggles the assignment-highlight store from onEditingChange.
 */

import { CalculatorCell } from '@shared/ui/calculator-cell';
import type { BudgetRow } from '@features/budget-planning/lib/budget-transforms';

export interface AllocatedCellProps {
  item: BudgetRow;
  globalLocalizer: Intl.NumberFormat;
  onUpdateAssignment: (categoryId: number, value: number) => Promise<void>;
  onEditingChange?: (editing: boolean) => void;
  inputAlign: 'right' | 'center';
  placeholder: string;
  /** Full class string for the display state (including highlight classes). */
  displayClassName: string;
  /** Full class string for the input state (including highlight classes). */
  inputClassName: string;
}

export function AllocatedCell({
  item,
  globalLocalizer,
  onUpdateAssignment,
  onEditingChange,
  inputAlign,
  placeholder,
  displayClassName,
  inputClassName,
}: AllocatedCellProps) {
  return (
    <CalculatorCell
      value={item.assigned}
      onCommit={(value) => onUpdateAssignment(item.categoryId, value)}
      formatter={globalLocalizer.format}
      displayFormatter={globalLocalizer.format}
      localizer={globalLocalizer}
      inputAlign={inputAlign}
      placeholder={placeholder}
      useFormatterForDisplay
      onEditingChange={onEditingChange}
      displayClassName={displayClassName}
      inputClassName={inputClassName}
    />
  );
}
