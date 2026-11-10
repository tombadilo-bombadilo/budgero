import { useIsMobile } from '@shared/hooks/useIsMobile';
import { DashboardPeriodProvider } from '@widgets/dashboard/builtin/DashboardPeriod';
import { HomeDashboard } from './HomeDashboard';

export function DashboardPage() {
  const isMobile = useIsMobile();
  const platform = isMobile ? 'mobile' : 'desktop';

  // A fresh period per platform, as the separate desktop and phone pages had.
  return (
    <DashboardPeriodProvider key={platform} platform={platform}>
      <HomeDashboard isMobile={isMobile} />
    </DashboardPeriodProvider>
  );
}
