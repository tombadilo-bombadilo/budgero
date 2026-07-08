/**
 * Klaro lifecycle for the app shell.
 *
 * Self-host builds skip Klaro entirely — there's no third-party tracking to
 * gate. SaaS builds load it dynamically (so the bundle isn't paid for on
 * self-host) and bridge consent state into the existing
 * `enable/disableAnalytics` helpers, which already mirror to localStorage and
 * to the `posthog.opt_in/out_capturing` runtime flag.
 */

import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { klaroConfig, type KlaroApi, type KlaroManager } from '@shared/lib/analytics/klaro-config';
import {
  disableAnalytics,
  enableAnalytics,
  initAnalytics,
  isAnalyticsDisabled,
} from '@shared/lib/analytics/analytics';

declare global {
  interface Window {
    klaro?: KlaroApi;
    klaroConfig?: typeof klaroConfig;
  }
}

let loadPromise: Promise<KlaroApi | null> | null = null;
let manager: KlaroManager | null = null;
let watchersAttached = false;

/**
 * Load Klaro (once), mount it against our config, and bridge its consent
 * state into the local analytics consent flag. Returns null on self-host.
 */
export async function setupKlaro(): Promise<KlaroApi | null> {
  if (IS_SELF_HOSTABLE_BUILD) return null;
  if (typeof window === 'undefined') return null;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // Pick a domain-appropriate storage strategy. On `*.budgero.app` use a
    // cookie scoped to the apex so consent flows between budgero.app and
    // my.budgero.app. On localhost / preview deploys the browser drops a
    // cookie whose Domain attribute isn't an ancestor of the current host —
    // fall back to localStorage so consent still persists across reloads.
    const isBudgeroApex = window.location.hostname.endsWith('budgero.app');
    if (isBudgeroApex) {
      klaroConfig.storageMethod = 'cookie';
      klaroConfig.cookieDomain = '.budgero.app';
    } else {
      klaroConfig.storageMethod = 'localStorage';
      delete klaroConfig.cookieDomain;
    }

    window.klaroConfig = klaroConfig;
    await import('klaro/dist/klaro.css');
    await import('@shared/lib/analytics/klaro-theme.css');
    const mod = await import('klaro');
    const api = (mod as unknown as { default?: KlaroApi }).default ?? (mod as unknown as KlaroApi);
    api.setup(klaroConfig);
    window.klaro = api;
    manager = api.getManager();

    // Analytics is opt-in, so an undecided user reads as disabled. Pre-seed
    // Klaro to "rejected and confirmed" for anyone without granted consent:
    // no banner nag, PostHog stays dormant, and the Settings toggle (or
    // "Manage cookies") is the explicit opt-in path. Users whose Klaro
    // cookie already holds confirmed acceptance skip this and re-enable via
    // applyConsentSnapshot below.
    if (!manager.confirmed && isAnalyticsDisabled()) {
      manager.updateConsent('posthog', false);
      manager.saveAndApplyConsents('rejected');
    }

    bridgeConsentToLocalToggle();

    // Initial sync — if Klaro already has confirmed consent (returning user)
    // apply it now so PostHog inits / stays opted out as appropriate.
    applyConsentSnapshot();

    return api;
  })();

  return loadPromise;
}

/**
 * Wires Klaro's consent watcher to flip the local analytics consent flag.
 * Idempotent. Safe to call multiple times.
 */
function bridgeConsentToLocalToggle(): void {
  if (!manager || watchersAttached) return;
  watchersAttached = true;
  manager.watch({
    update(_m, name) {
      if (name !== 'consents' && name !== 'applyConsents' && name !== 'saveConsents') return;
      applyConsentSnapshot();
    },
  });
}

/**
 * Mirror Klaro's `posthog` consent into the local `isAnalyticsDisabled()`
 * flag (which analytics.ts already checks at every entry point).
 *
 * Behavior:
 *   - posthog consent = on  → ensure local opt-out is cleared and PostHog
 *     is initialized for this session
 *   - posthog consent = off AND user confirmed a choice → flip local opt-out
 *     to disabled (call disableAnalytics so posthog.opt_out_capturing runs)
 *   - posthog consent = off AND user has NOT yet confirmed → do nothing,
 *     keep PostHog dormant and let the banner drive the decision
 */
function applyConsentSnapshot(): void {
  if (!manager) return;
  const posthogOk = manager.getConsent('posthog');

  if (posthogOk) {
    if (isAnalyticsDisabled()) {
      enableAnalytics();
    } else {
      initAnalytics();
    }
    return;
  }

  if (manager.confirmed && !isAnalyticsDisabled()) {
    disableAnalytics();
  }
}

/** Programmatically open the Klaro modal (used by Settings → Manage cookies). */
export function showKlaro(): void {
  if (typeof window === 'undefined') return;
  if (window.klaro) {
    window.klaro.show(undefined, true);
  }
}

/**
 * Programmatic consent toggle from the Settings page. Flips Klaro's posthog
 * consent and persists it (Klaro saves to its cookie). The internal watcher
 * fires `applyConsentSnapshot` which mirrors into the local isAnalyticsDisabled
 * flag and inits/resets PostHog accordingly. No-op on self-host (Klaro never
 * loads there).
 */
export function setPostHogConsent(consent: boolean): void {
  if (!manager) return;
  manager.updateConsent('posthog', consent);
  manager.saveAndApplyConsents('change');
}
