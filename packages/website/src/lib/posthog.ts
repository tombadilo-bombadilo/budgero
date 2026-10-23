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
 * Initialize PostHog on the marketing site, cookieless: identifiers live in
 * memory only, so nothing is written to cookies, localStorage or
 * sessionStorage and every page load gets a fresh anonymous id. Nothing on the
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
    // Anonymous visitors never get a person profile.
    person_profiles: 'identified_only',
    persistence: 'memory',
    disable_persistence: true,
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
