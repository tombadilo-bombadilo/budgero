import { useIsMobile } from '@shared/hooks/useIsMobile';
import { useUiStore } from '@shared/store/useUiStore';
import { DashboardPeriodProvider } from '@widgets/dashboard/builtin/DashboardPeriod';
import { HomeDashboard } from './HomeDashboard';

export function DashboardPage() {
  const isMobile = useIsMobile();
  const platform = isMobile ? 'mobile' : 'desktop';
  // Edit mode, dialogs and the editor start over in another budget or space.
  const budgetKey = useUiStore(
    (state) => `${state.selectedBudget?.SpaceID ?? ''}:${state.selectedBudget?.ID ?? 0}`
  );

  // A fresh period per platform, as the separate desktop and phone pages had.
  return (
    <DashboardPeriodProvider key={platform} platform={platform}>
      <HomeDashboard key={budgetKey} isMobile={isMobile} />
    </DashboardPeriodProvider>
  );
}
