import { Eye, EyeOff, ChevronUp, ChevronDown } from 'lucide-react';
import { AssignDropdown } from '@features/budget-planning/ui/assign-dropdown';
import { SearchAndFilterControls } from '@features/budget-planning/ui/SearchAndFilterControls';
import type { BudgetTableToolbarControls } from '@features/budget-planning/ui/BudgetTable';
import type { Goal, GetMonthlyBudgetRow } from '@budgero/core/browser';
import { ReadyToAssignHelpPopover } from '@features/budgeting/ui/ReadyToAssignHelpPopover';
import { Button } from '@shared/ui/button';
import { cn } from '@shared/lib/utils';
import type { ReactNode } from 'react';
import { useFormatMaskedMilli } from '@features/budget-planning/lib/useFormatMaskedMilli';
import { AnimatedNumber } from '@shared/ui/animated-number';

interface BudgetToolbarProps {
  readyToAssign: number;
  globalLocalizer: Intl.NumberFormat;
  currentMonth: string;
  budgetId: number;
  budgetRows: GetMonthlyBudgetRow[];
  goals: Goal[];
  controls: BudgetTableToolbarControls;
  className?: string;
  stickyOffset?: string;
  assignDropdownVariant?: 'small' | 'default';
  hideSearch?: boolean;
  hideCollapseButton?: boolean;
  showFilter?: boolean;
  extraContent?: ReactNode;
  hideResetOrder?: boolean;
  compact?: boolean;
  /**
   * Stack the Ready-to-Assign hero and the period controls as two full-width
   * rows instead of placing them side by side. Used on mobile (non-compact)
   * where the side-by-side layout leaves the period controls floating.
   */
  stackedHeader?: boolean;
  showHiddenCategories?: boolean;
  onToggleHiddenCategories?: () => void;
  hasHiddenCategories?: boolean;
}

export function BudgetToolbar({
  readyToAssign,
  globalLocalizer,
  currentMonth,
  budgetId,
  budgetRows,
  goals,
  controls,
  className,
  stickyOffset = '0px',
  assignDropdownVariant = 'small',
  hideSearch = false,
  hideCollapseButton = false,
  showFilter = true,
  extraContent,
  hideResetOrder = false,
  compact = false,
  stackedHeader = false,
  showHiddenCategories = false,
  onToggleHiddenCategories,
  hasHiddenCategories = false,
}: BudgetToolbarProps) {
  // readyToAssign is stored milliunits; AnimatedNumber interpolates the raw
  // value, so the formatter converts to decimal each frame.
  const formatAmount = useFormatMaskedMilli(globalLocalizer);

  // Tone the Ready-to-Assign pill by state: money to assign (green),
  // over-budgeted (red), or fully assigned (neutral).
  const rtaTone =
    readyToAssign > 0
      ? {
          box: 'border-emerald-500/30 bg-emerald-500/10',
          value: 'text-emerald-600 dark:text-emerald-400',
          divider: 'border-emerald-500/25',
          dot: 'bg-emerald-500',
        }
      : readyToAssign < 0
        ? {
            box: 'border-red-500/30 bg-red-500/10',
            value: 'text-red-600 dark:text-red-400',
            divider: 'border-red-500/25',
            dot: 'bg-red-500',
          }
        : {
            box: 'border-border/70 bg-muted/40',
            value: 'text-foreground',
            divider: 'border-border/70',
            dot: 'bg-muted-foreground/40',
          };

  if (compact) {
    return (
      <div
        className={cn('sticky z-30', className)}
        style={{ top: stickyOffset }}
        data-budget-toolbar
      >
        <div className="bg-background/60 py-1 backdrop-blur-md supports-[backdrop-filter]:bg-background/50">
          <div
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-md border mx-1 px-2 py-0.5 text-xs shadow-sm',
              rtaTone.box
            )}
          >
            <span className="text-muted-foreground shrink-0">RTA</span>
            <AnimatedNumber
              value={readyToAssign}
              formatter={formatAmount}
              className={cn('font-semibold shrink-0 tabular-nums', rtaTone.value)}
              data-testid="ready-to-assign-value"
            />
            <div>
              <AssignDropdown
                readyToAssign={readyToAssign}
                currentMonth={currentMonth}
                budgetId={budgetId}
                budgetData={budgetRows}
                goals={goals}
                globalLocalizer={globalLocalizer}
                variant="small"
                fullWidth
              />
            </div>
          </div>
          {extraContent && <div className="flex justify-center pt-1">{extraContent}</div>}
          {(!hideCollapseButton || (hasHiddenCategories && onToggleHiddenCategories)) && (
            <div className="flex items-center justify-between gap-1 px-2 pt-1">
              {!hideCollapseButton && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={controls.onToggleAllGroups}
                  className="h-6 px-2 text-xs gap-1"
                >
                  {controls.collapsedGroups.size === 0 ? (
                    <>
                      <ChevronUp className="h-3 w-3" />
                      Collapse
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3" />
                      Expand
                    </>
                  )}
                </Button>
              )}
              {hasHiddenCategories && onToggleHiddenCategories && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onToggleHiddenCategories}
                  className="h-6 px-2 text-xs gap-1"
                >
                  {showHiddenCategories ? (
                    <>
                      <EyeOff className="h-3 w-3" />
                      Hide hidden
                    </>
                  ) : (
                    <>
                      <Eye className="h-3 w-3" />
                      Show hidden
                    </>
                  )}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('sticky z-30', className)} style={{ top: stickyOffset }} data-budget-toolbar>
      <div className="bg-background/70 px-3 py-2 backdrop-blur-md supports-[backdrop-filter]:bg-background/55 sm:px-4 lg:px-5">
        <div className="flex flex-col gap-2">
          {/* Top zone — Ready to Assign hero + period controls */}
          <div
            className={cn(
              stackedHeader ? 'flex flex-col gap-2' : 'flex flex-wrap items-center gap-x-3 gap-y-2'
            )}
          >
            <div
              className={cn(
                'flex items-stretch overflow-hidden rounded-lg border shadow-sm transition-colors',
                rtaTone.box,
                stackedHeader && 'w-full'
              )}
            >
              <div
                className={cn(
                  'flex flex-col justify-center py-1 pl-2.5 pr-3',
                  stackedHeader && 'min-w-0 flex-1'
                )}
              >
                <div className="flex items-center gap-1">
                  <span className={cn('h-1.5 w-1.5 rounded-full', rtaTone.dot)} />
                  <span className="text-[10px] font-medium uppercase tracking-[0.08em] leading-none text-muted-foreground">
                    Ready to assign
                  </span>
                  <ReadyToAssignHelpPopover triggerClassName="h-3.5 w-3.5 text-muted-foreground/60" />
                </div>
                <AnimatedNumber
                  value={readyToAssign}
                  formatter={formatAmount}
                  className={cn(
                    'mt-1 block text-sm font-semibold leading-none tabular-nums sm:text-base',
                    rtaTone.value
                  )}
                  data-testid="ready-to-assign-value"
                />
              </div>
              <div className={cn('flex items-center border-l pl-1.5 pr-1', rtaTone.divider)}>
                <AssignDropdown
                  readyToAssign={readyToAssign}
                  currentMonth={currentMonth}
                  budgetId={budgetId}
                  budgetData={budgetRows}
                  goals={goals}
                  globalLocalizer={globalLocalizer}
                  variant={assignDropdownVariant}
                />
              </div>
            </div>

            {extraContent ? (
              <div
                className={cn(
                  stackedHeader
                    ? 'w-full'
                    : 'ml-auto flex shrink-0 items-center justify-end gap-1.5'
                )}
              >
                {extraContent}
              </div>
            ) : null}
          </div>

          {/* Bottom zone — search + view controls */}
          <SearchAndFilterControls
            searchTerm={controls.searchTerm}
            onSearchChange={controls.onSearchChange}
            filterType={controls.filterType}
            onFilterChange={controls.onFilterChange}
            collapsedGroups={controls.collapsedGroups}
            onToggleAllGroups={controls.onToggleAllGroups}
            hideSearch={hideSearch}
            hideCollapseButton={hideCollapseButton}
            hideFilter={!showFilter}
            onResetOrder={controls.onResetOrder}
            hideResetOrder={hideResetOrder || !controls.onResetOrder}
            disableSticky
            inlineFilterOnDesktop
            extraButtons={
              hasHiddenCategories && onToggleHiddenCategories ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onToggleHiddenCategories}
                  className="h-8 shrink-0 gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground"
                  title={showHiddenCategories ? 'Hide hidden categories' : 'Show hidden categories'}
                >
                  {showHiddenCategories ? (
                    <>
                      <EyeOff className="h-3.5 w-3.5" />
                      <span className="hidden xl:inline">Hide hidden</span>
                    </>
                  ) : (
                    <>
                      <Eye className="h-3.5 w-3.5" />
                      <span className="hidden xl:inline">Show hidden</span>
                    </>
                  )}
                </Button>
              ) : null
            }
          />
        </div>
      </div>
    </div>
  );
}
