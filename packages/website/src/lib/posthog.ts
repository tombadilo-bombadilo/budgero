'use client';

import posthog from 'posthog-js';

let inited = false;

/**
 * Initialize PostHog on the marketing site. Always-on (no opt-out UI here —
 * the marketing site has no notion of a logged-in user; the privacy policy
 * discloses this).
 *
 * Paranoid flag set: NO session recording, NO autocapture, NO heatmaps,
 * NO surveys. PostHog is used purely as an event pipe.
 */
export function initPostHogBrowser(): void {
  if (typeof window === 'undefined') return;
  if (inited) return;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;

  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://s.budgero.app',
    ui_host: 'https://eu.posthog.com',
    defaults: '2026-05-30',
    capture_pageview: false, // fired manually on App Router pathname change
    capture_pageleave: true,
    // Materialize a person for every visitor so pre-signup activity is
    // attributable. Combined with the apex `.budgero.app` cookie that
    // posthog-js sets by default (cross_subdomain_cookie: true), the same
    // anonymous distinct_id flows into my.budgero.app and gets folded into
    // the Clerk user once identify() runs in StartupController.
    person_profiles: 'always',
    disable_session_recording: true,
    autocapture: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    disable_surveys: true,
    advanced_disable_toolbar_metrics: true,
    persistence: 'localStorage+cookie',
  });

  inited = true;
}

export { posthog };
