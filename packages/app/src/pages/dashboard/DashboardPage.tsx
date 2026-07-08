import { DashboardPageMobile } from '@pages/dashboard/DashboardPage.mobile';
import { DashboardPageDesktop } from '@pages/dashboard/DashboardPage.desktop';
import { useIsMobile } from '@shared/hooks/useIsMobile';

export function DashboardPage() {
  const isMobile = useIsMobile();

  return isMobile ? <DashboardPageMobile /> : <DashboardPageDesktop />;
}
