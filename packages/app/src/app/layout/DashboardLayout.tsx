import { MobileBottomNav } from '@widgets/navigation/MobileBottomNav';
import { MobileTopBar } from '@widgets/navigation/MobileTopBar';
import { Outlet } from 'react-router-dom';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { DesktopShell } from '@/app/layout/desktop-shell';
import EarlyAccessBanner from '@features/subscription/ui/GlobalEarlyAccessBanner';
import { TrialEndingBanner } from '@features/subscription/ui/TrialEndingBanner';
import { UpdateAvailableBanner } from '@features/app-update/ui/UpdateAvailableBanner';
import { cn } from '@shared/lib/utils';
import { CommandPalette } from '@widgets/command-palette/CommandPalette';
import OnboardingInviteShareDialog from '@features/budget-sharing/ui/OnboardingInviteShareDialog';

export default function DashboardLayout() {
  const isMobile = useIsMobile();

  return (
    <div className="flex min-h-screen flex-col relative">
      {/* Show early access banner at the very top */}
      <EarlyAccessBanner variant="top" dismissible />

      {/* Trial-ending banner — shows in the last 2 days of the trial */}
      <TrialEndingBanner />

      {/* Self-host only: newer release available on the server's update check */}
      <UpdateAvailableBanner />

      {/* Global Command Palette */}
      <CommandPalette />

      {/* Surfaces invite links generated during onboarding once the user
          has actually landed on the dashboard. Reads sessionStorage and
          self-clears on close. */}
      <OnboardingInviteShareDialog />

      {isMobile && <MobileTopBar />}
      <main className={cn('flex-1 bg-background', isMobile && 'overflow-auto')}>
        {isMobile ? (
          <Outlet />
        ) : (
          <DesktopShell>
            <Outlet />
          </DesktopShell>
        )}
      </main>
      {isMobile ? <MobileBottomNav /> : null}
    </div>
  );
}
