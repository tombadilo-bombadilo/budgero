'use client';

import { posthog } from '@/lib/posthog';

declare global {
  interface Window {
    umami?: {
      track: (event: string, data?: Record<string, unknown>) => void;
    };
  }
}

/**
 * Dual-fire an event to both analytics layers:
 *
 * - PostHog: consent-gated behind Klaro; a no-op until the visitor accepts
 *   (capture before init is dropped by posthog-js).
 * - Umami: cookieless and always on — no device storage, so no consent needed.
 *   `window.umami` is set by the proxied tracker script in the root layout;
 *   optional-chained so a blocked/unloaded script never breaks a click.
 */
export function track(event: string, data?: Record<string, unknown>): void {
  posthog.capture(event, data);
  if (typeof window !== 'undefined') {
    window.umami?.track(event, data);
  }
}
