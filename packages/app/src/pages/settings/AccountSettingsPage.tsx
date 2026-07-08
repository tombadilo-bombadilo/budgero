import { UserProfile } from '@clerk/clerk-react';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { useConnectivity } from '@shared/hooks/useConnectivity';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { WifiOff } from 'lucide-react';

export default function AccountSettingsPage() {
  const isMobile = useIsMobile();
  const connectivity = useConnectivity();
  const isConnectivityReady = connectivity.lastChecked > 0;
  const requiresOnline =
    isConnectivityReady && (!connectivity.apiReachable || !connectivity.clerkToken);
  if (requiresOnline) {
    return (
      <div className={`container max-w-4xl mx-auto p-4 sm:p-6 ${isMobile ? 'pb-1' : 'pb-6'}`}>
        <Alert variant="default" className="border border-dashed">
          <WifiOff className="h-4 w-4" />
          <AlertTitle>Internet connection required</AlertTitle>
          <AlertDescription>
            Account settings need a live connection to Clerk. Please reconnect to the internet and
            try again.
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  return (
    <div className={`container max-w-4xl mx-auto p-4 sm:p-6 ${isMobile ? 'pb-1' : 'pb-6'}`}>
      <UserProfile
        routing="hash"
        appearance={{
          // Provider already sets baseTheme, no need to override here
          elements: {
            rootBox: 'w-full max-w-full min-w-0',
            card: 'w-full max-w-full min-w-0 bg-transparent shadow-none border-0 p-0',
            main: 'w-full max-w-full',
            content: 'w-full max-w-full overflow-hidden',
            page: 'w-full max-w-full',
            pageScrollBox: 'overflow-auto',
            // Hide Clerk sidebar on small screens to prevent off-canvas overflow
            navbar: 'hidden md:block bg-transparent border-0',
          },
        }}
      />
    </div>
  );
}
