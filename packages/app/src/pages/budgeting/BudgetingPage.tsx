import { BudgetingPageMobile } from '@pages/budgeting/BudgetingPage.mobile';
import { BudgetingPageDesktop } from '@pages/budgeting/BudgetingPage.desktop';
import { useIsMobile } from '@shared/hooks/useIsMobile';

export function BudgetingPage() {
  const isBelowDesktopBreakpoint = useIsMobile(1020);
  return isBelowDesktopBreakpoint ? <BudgetingPageMobile /> : <BudgetingPageDesktop />;
}
