import { BudgetingPageMobile } from '@pages/budgeting/BudgetingPage.mobile';
import { BudgetingPageDesktop } from '@pages/budgeting/BudgetingPage.desktop';
import { PLANNING_DESKTOP_BREAKPOINT } from '@features/budget-planning/lib/layout-breakpoint';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { usePlanningNumberAnimations } from '@shared/hooks/useUserPreferences';
import { PlanningNumberAnimationProvider } from '@features/budget-planning/ui/PlanningNumberAnimation';

export function BudgetingPage() {
  const isBelowDesktopBreakpoint = useIsMobile(PLANNING_DESKTOP_BREAKPOINT);
  const { data: planningNumberAnimations = false } = usePlanningNumberAnimations();

  return (
    <PlanningNumberAnimationProvider enabled={planningNumberAnimations}>
      {isBelowDesktopBreakpoint ? <BudgetingPageMobile /> : <BudgetingPageDesktop />}
    </PlanningNumberAnimationProvider>
  );
}
