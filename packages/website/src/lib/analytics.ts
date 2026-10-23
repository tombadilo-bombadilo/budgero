'use client';

import { posthog } from './posthog.ts';

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
 * - PostHog: cookieless (memory persistence, see posthog.ts); events are
 *   dropped by posthog-js when it isn't initialized (no key, or GPC / DNT).
 * - Umami: cookieless and always on — no device storage, so no consent needed.
 *   `window.umami` is set by the proxied tracker script in the root layout;
 *   a blocked or unloaded tracker never interrupts navigation.
 */
export function track(event: string, data?: Record<string, unknown>): void {
  if (typeof window === 'undefined' || window.location.hostname !== 'budgero.app') return;
  try {
    posthog.capture(event, data);
  } catch {
    /* Analytics is best effort and must not interrupt a CTA. */
  }
  if (window.umami) {
    try {
      window.umami.track(event, data);
    } catch {
      /* An unavailable provider must not interrupt navigation. */
    }
  } else if (pendingEvents.length < 20) {
    pendingEvents.push({ event, data });
  }
}

// The homepage mounts before the afterInteractive tracker can finish loading.
// Keep a small memory-only queue so its first view does not disappear.
const pendingEvents: Array<{ event: string; data?: Record<string, unknown> }> = [];

export function flushUmamiEvents(): void {
  if (typeof window === 'undefined' || !window.umami) return;
  for (const { event, data } of pendingEvents.splice(0)) {
    try {
      window.umami.track(event, data);
    } catch {
      /* A failed event must not prevent the remaining queue from flushing. */
    }
  }
}
