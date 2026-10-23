'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { initPostHogBrowser, posthog } from '@/lib/posthog';

function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    // Init lazily (idempotent) so the first pageview isn't dropped.
    initPostHogBrowser();
    if (!posthog.__loaded || !pathname) return;
    const query = searchParams?.toString();
    const path = query ? `${pathname}?${query}` : pathname;
    const url = typeof window !== 'undefined' ? window.location.origin + path : path;
    posthog.capture('$pageview', { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

/**
 * Initializes cookieless PostHog (see lib/posthog.ts) and fires manual
 * pageviews on App Router navigation.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <PageviewTracker />
      </Suspense>
      {children}
    </>
  );
}
