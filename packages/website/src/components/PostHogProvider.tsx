'use client';

import { Suspense, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { initPostHogBrowser, posthog } from '@/lib/posthog';
import { useKlaroConsent } from '@/components/KlaroProvider';

function PageviewTracker({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!enabled) return;
    if (!pathname) return;
    const query = searchParams?.toString();
    const path = query ? `${pathname}?${query}` : pathname;
    const url = typeof window !== 'undefined' ? window.location.origin + path : path;
    posthog.capture('$pageview', { $current_url: url });
  }, [enabled, pathname, searchParams]);

  return null;
}

/**
 * Initializes PostHog only after the visitor has accepted the `posthog`
 * service in Klaro. Until then, the SDK is dormant — no cookies, no requests.
 *
 * We never tear PostHog down on consent revocation in this session; the user
 * will see `posthog.opt_out_capturing()` worth of behavior on their next page
 * load when Klaro reads the new consent state. Good enough for a marketing
 * site (no in-session toggle UI here).
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const consented = useKlaroConsent('posthog');
  const initedRef = useRef(false);

  useEffect(() => {
    if (!consented) return;
    if (initedRef.current) return;
    initedRef.current = true;
    initPostHogBrowser();
  }, [consented]);

  return (
    <>
      <Suspense fallback={null}>
        <PageviewTracker enabled={consented} />
      </Suspense>
      {children}
    </>
  );
}
