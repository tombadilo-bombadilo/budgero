import { createRoot } from 'react-dom/client';
import { AppErrorBoundary } from '@app/system/AppErrorBoundary';
import '@/fonts';
import '@/index.css';
import App from '@/App';
import { I18nProvider } from '@lingui/react';
import { i18n, initI18n } from '@shared/i18n';
import { ClerkProvider } from '@clerk/clerk-react';
import { shadcn } from '@clerk/themes';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { HelmetProvider } from 'react-helmet-async';
import { initAnalytics } from '@shared/lib/analytics/analytics';
import { installErrorCapture } from '@shared/lib/analytics/error-capture';
import { writePendingSpaceInvite } from '@features/budget-sharing/lib/pending-space-invite';
import { relayBankCallbackFromPopup } from '@features/bank-sync/model/bank-auth-popup';

// Capture workspace-invite secrets from the URL fragment before React mounts.
// /join#code=… can land here unauthenticated, which means StartupController
// would queue a redirect to /auth during its first render and we'd lose the
// fragment before any route component had a chance to read it. Doing this at
// module load (before createRoot) gets ahead of every render. The fragment
// stays client-side either way: never sent to the server, never logged.
//
// The handoff helper immediately creates a bounded same-tab fallback, then
// persists an AES-GCM-encrypted cross-tab record for Clerk email verification.
// The redeem flow destroys both the ciphertext and its non-extractable key.
(function captureJoinHashOnBoot() {
  if (typeof window === 'undefined') return;
  if (!window.location.pathname.startsWith('/join')) return;
  const raw = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!raw) return;
  const code = new URLSearchParams(raw).get('code');
  if (!code || code.trim().length === 0) return;
  void writePendingSpaceInvite(code.trim());
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
  // Cloud analytics is cookieless and on by default; PostHog itself loads once
  // AnalyticsGate knows whether the user opted out. Self-host: both no-ops.
  if (!IS_SELF_HOSTABLE_BUILD) {
    initAnalytics();
    installErrorCapture();
  }
  return (
    <AppErrorBoundary name="root" variant="page">
      <App />
    </AppErrorBoundary>
  );
}

// Catalogs load before mount so no screen renders in the wrong language first.
void initI18n().then(() => {
  // The bank login popup returns here; it hands the answer to the Budgero
  // window that opened it and closes without starting the app.
  if (relayBankCallbackFromPopup()) return;
  createRoot(document.getElementById('root')!).render(
    <I18nProvider i18n={i18n}>
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
    </I18nProvider>
  );
});
