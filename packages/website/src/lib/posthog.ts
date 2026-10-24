'use client';

import posthog from 'posthog-js';

let inited = false;

/**
 * True when the browser asks not to be tracked (Global Privacy Control or Do
 * Not Track). The marketing site has no account to save an opt-out to, so the
 * browser signal is the visitor's way to object (privacy policy §3.6).
 */
export function browserObjectsToTracking(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1';
}

/**
 * Initialize PostHog on the marketing site in cookieless server hash mode:
 * nothing is written to cookies, localStorage or sessionStorage, and PostHog
 * derives the visitor id on its servers from a hash of the IP, user agent and
 * hostname with a salt that changes (and is deleted) daily. A visitor counts
 * once per day, cannot be followed across days, and is never identified.
 * Requires "Cookieless server hash mode" in the PostHog project settings
 * (Web analytics), otherwise PostHog discards these events. No GeoIP or bot
 * filtering on these events (Umami covers visit geography). Nothing on the
 * device needs consent, so there is no banner (privacy policy §3.6, §8).
 *
 * Paranoid flag set: NO session recording, NO autocapture, NO heatmaps,
 * NO surveys. PostHog is used purely as an event pipe.
 */
export function initPostHogBrowser(): void {
  if (typeof window === 'undefined') return;
  if (inited) return;
  if (browserObjectsToTracking()) return;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;

  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://s.budgero.app',
    ui_host: 'https://eu.posthog.com',
    defaults: '2026-05-30',
    capture_pageview: false, // fired manually on App Router pathname change
    capture_pageleave: true,
    // Server-side daily hash instead of a device id; nobody is ever identified.
    cookieless_mode: 'always',
    person_profiles: 'never',
    disable_session_recording: true,
    autocapture: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    disable_surveys: true,
    advanced_disable_toolbar_metrics: true,
  });

  inited = true;
}

export { posthog };
