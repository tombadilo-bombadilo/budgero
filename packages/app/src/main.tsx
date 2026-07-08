import { createRoot } from 'react-dom/client';
import '@/fonts';
import '@/index.css';
import App from '@/App';
import { ClerkProvider } from '@clerk/clerk-react';
import { shadcn } from '@clerk/themes';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { HelmetProvider } from 'react-helmet-async';
import { initAnalytics } from '@shared/lib/analytics/analytics';
import { setupKlaro } from '@shared/lib/analytics/klaro';
import { writePendingSpaceInvite } from '@features/budget-sharing/lib/pending-space-invite';

// Capture workspace-invite secrets from the URL fragment before React mounts.
// /join#code=… can land here unauthenticated, which means StartupController
// would queue a redirect to /auth during its first render and we'd lose the
// fragment before any route component had a chance to read it. Doing this at
// module load (before createRoot) gets ahead of every render. The fragment
// stays client-side either way: never sent to the server, never logged.
//
// We mirror the secret to BOTH sessionStorage (preferred — clears on tab
// close) AND localStorage (fallback). localStorage matters for the Clerk
// email-verification path: that link opens in a new tab, where sessionStorage
// is empty, so without localStorage a brand new invitee falls through to
// standard onboarding. The redeem flow clears both on success.
(function captureJoinHashOnBoot() {
  if (typeof window === 'undefined') return;
  if (!window.location.pathname.startsWith('/join')) return;
  const raw = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!raw) return;
  const code = new URLSearchParams(raw).get('code');
  if (!code || code.trim().length === 0) return;
  writePendingSpaceInvite(code.trim());
  try {
    window.history.replaceState(null, '', window.location.pathname);
  } catch {
    /* no-op */
  }
})();

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const USES_CLERK = !IS_SELF_HOSTABLE_BUILD;

if (!PUBLISHABLE_KEY && USES_CLERK) {
  throw new Error('Missing Clerk Publishable Key');
}

function renderAppBody() {
  // Wrap storage operations in try-catch to prevent crashes on corrupted storage
  // (can happen on mobile PWA when storage is in a bad state)
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('masterPassword');
      sessionStorage.removeItem('master_password_session');
    }
  } catch {
    /* no-op: storage access failed */
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('master_password_hash');
      localStorage.removeItem('master_password_expiry');
      localStorage.removeItem('master_password_cache');
      localStorage.removeItem('master_password_cache_key');
      localStorage.removeItem('CACHE_ENCRYPTION_KEY');
    }
  } catch {
    /* no-op: storage access failed */
  }
  // Mount Klaro asynchronously. setupKlaro() applies any prior confirmed
  // consent to the local opt-out + initializes PostHog if the user has
  // already accepted. For brand-new visitors with no confirmed choice yet,
  // PostHog stays uninitialized until they click Accept on the banner.
  // Self-host returns null and skips analytics entirely.
  void setupKlaro().then((api) => {
    if (api) return; // Klaro will handle init via its consent watcher.
    // Self-host or window-undefined paths fall back to legacy init —
    // analytics.ts itself short-circuits on IS_SELF_HOSTABLE_BUILD.
    initAnalytics();
  });
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <HelmetProvider>
    {!USES_CLERK ? (
      renderAppBody()
    ) : (
      <ClerkProvider
        publishableKey={PUBLISHABLE_KEY ?? ''}
        afterSignOutUrl="/"
        signInUrl="/auth"
        signUpUrl="/auth?mode=signup"
        appearance={{ cssLayerName: 'clerk', baseTheme: [shadcn] }}
      >
        {renderAppBody()}
      </ClerkProvider>
    )}
  </HelmetProvider>
);
