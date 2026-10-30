import { MobileBottomNav } from '@widgets/navigation/MobileBottomNav';
import { MobileTopBar } from '@widgets/navigation/MobileTopBar';
import { Outlet, useLocation } from 'react-router-dom';
import { AppErrorBoundary } from '@app/system/AppErrorBoundary';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { DesktopShell } from '@/app/layout/desktop-shell';
import { TrialEndingBanner } from '@features/subscription/ui/TrialEndingBanner';
import { UpdateAvailableBanner } from '@features/app-update/ui/UpdateAvailableBanner';
import { cn } from '@shared/lib/utils';
import { CommandPalette } from '@widgets/command-palette/CommandPalette';
import OnboardingInviteShareDialog from '@features/budget-sharing/ui/OnboardingInviteShareDialog';
import { BankAutoSync } from '@features/bank-sync';
import { SchedulingGuideDialog } from '@features/transactions/ui/SchedulingGuideDialog';

export default function DashboardLayout() {
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  const page = (
    <AppErrorBoundary name="route" variant="section" resetKey={pathname}>
      <Outlet />
    </AppErrorBoundary>
  );

  return (
    <div className="flex min-h-screen flex-col relative">
      {/* Show early access banner at the very top */}

      {/* Trial-ending banner — shows in the last 2 days of the trial */}
      <TrialEndingBanner />

      {/* Self-host only: newer release available on the server's update check */}
      <UpdateAvailableBanner />

      {/* Global Command Palette */}
      <AppErrorBoundary name="command_palette" variant="hidden">
        <CommandPalette />
      </AppErrorBoundary>

      {/* Surfaces invite links generated during onboarding once the user
          has actually landed on the dashboard. Reads sessionStorage and
          self-clears on close. */}
      <OnboardingInviteShareDialog />
      <BankAutoSync />
      <SchedulingGuideDialog />

      {isMobile && <MobileTopBar />}
      <main className={cn('flex-1 bg-background', isMobile && 'overflow-auto')}>
        {isMobile ? page : <DesktopShell>{page}</DesktopShell>}
      </main>
      {isMobile ? <MobileBottomNav /> : null}
    </div>
  );
}
