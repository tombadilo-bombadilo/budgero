/**
 * Budgero analytics facade — PostHog Cloud EU.
 *
 * HARD PRIVACY RULES (do not relax without product sign-off):
 *
 * 1. NO session recording, NO heatmaps, NO autocapture, NO surveys.
 *    These flags are explicitly disabled in `posthog.init` below.
 *
 * 2. EVENT NAMES ONLY for every mutation. We do not capture amounts,
 *    payee names, account IDs, category names, or any other property —
 *    only the event name. The private `captureStrict` helper is the
 *    enforcement boundary: it takes a name and nothing else, and its
 *    type system forbids the prop-bearing event names.
 *
 * 3. The ONLY events allowed to carry properties are commercial-funnel
 *    events (`Checkout Started`, `Purchase`, `Subscription Canceled`)
 *    and `$pageview`. Each is exposed via a dedicated function with a
 *    strict prop type; unknown keys are unreachable by destructuring.
 *
 *    `$pageview` props are limited to a normalized `$pathname` /
 *    `$current_url` — dynamic segments that could carry secrets or
 *    user-scoped IDs (invite codes, account IDs, dashboard IDs) are
 *    rewritten to placeholders before the event fires. PostHog's
 *    automatic pageview capture is OFF (`capture_pageview: false`,
 *    `capture_pageleave: false`) so the un-sanitized URL never reaches
 *    the wire.
 *
 * 4. Self-host builds (`IS_SELF_HOSTABLE_BUILD`) NEVER initialize PostHog
 *    and NEVER call `capture`. Zero tracking code runs.
 *
 * 5. Analytics is OPT-IN. The persisted consent
 *    (`localStorage[budgero:analytics_consent]`) is tri-state:
 *    'granted' | 'denied' | absent (undecided). Anything other than an
 *    explicit 'granted' means DISABLED — no `posthog.init`, no cookies,
 *    no localStorage entries written. Consent is honored at init time AND
 *    at every capture call. The pre-opt-in `budgero:analytics_disabled`
 *    opt-out key is migrated to 'denied' on first read.
 */

import posthog from 'posthog-js';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';

const CONSENT_KEY = 'budgero:analytics_consent';
/** Pre-opt-in key (opt-out model). Migrated to CONSENT_KEY='denied' on read. */
const LEGACY_OPT_OUT_KEY = 'budgero:analytics_disabled';
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://s.budgero.app';

/** Events whose payload is strictly the event name only. */
type NameOnlyEvent =
  | 'Transaction Logged'
  | 'Transaction Edited'
  | 'Transaction Deleted'
  | 'Account Added'
  | 'Assignment Upserted'
  | 'Category Added'
  | 'Category Edited'
  | 'Category Deleted'
  | 'Category Group Added'
  | 'Category Group Edited'
  | 'Category Group Deleted'
  | 'Budget Created'
  | 'Imported from YNAB'
  | 'Imported CSV/PDF'
  | 'Shared Budget'
  | 'Trial Started';

let initialized = false;

/**
 * Whether analytics is currently disabled. Opt-in model: true unless the
 * user explicitly granted consent (Settings toggle or cookie banner).
 */
export function isAnalyticsDisabled(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    // Migrate the legacy opt-out key: an explicit old opt-out becomes an
    // explicit 'denied' so it survives as a deliberate choice.
    if (localStorage.getItem(LEGACY_OPT_OUT_KEY) === '1') {
      localStorage.setItem(CONSENT_KEY, 'denied');
      localStorage.removeItem(LEGACY_OPT_OUT_KEY);
    }
    return localStorage.getItem(CONSENT_KEY) !== 'granted';
  } catch {
    return true;
  }
}

/**
 * Initialize PostHog if (and only if) we're in a SaaS build, have a key,
 * and the user has not opted out. Idempotent.
 */
export function initAnalytics(): void {
  if (typeof window === 'undefined') return;
  if (IS_SELF_HOSTABLE_BUILD) return;
  if (!POSTHOG_KEY) return;
  if (isAnalyticsDisabled()) return;
  if (initialized) return;

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    ui_host: 'https://eu.posthog.com',
    defaults: '2026-05-30',
    // Pageviews are fired manually via `trackPageView` so we can normalize
    // dynamic path segments (invite codes, account IDs, dashboard IDs) before
    // the URL touches the wire. Auto-capture would send `window.location.href`
    // verbatim. See file header rule #3.
    capture_pageview: false,
    capture_pageleave: false,
    // Always materialize a person profile so pre-identify pageviews and UTM
    // capture attach to the user once identify() runs, instead of being
    // orphaned under an anonymous id (posthog-js default is `identified_only`).
    person_profiles: 'always',
    // PARANOIA FLAGS — see file header. Do not relax.
    disable_session_recording: true,
    autocapture: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    disable_surveys: true,
    advanced_disable_toolbar_metrics: true,
    persistence: 'localStorage+cookie',
    loaded: (ph) => {
      if (isAnalyticsDisabled()) ph.opt_out_capturing();
    },
  });

  initialized = true;
}

/** Grant consent: persists opt-in, initializes if needed, opts back in. */
export function enableAnalytics(): void {
  try {
    localStorage.setItem(CONSENT_KEY, 'granted');
    localStorage.removeItem(LEGACY_OPT_OUT_KEY);
  } catch {
    /* no-op */
  }
  if (IS_SELF_HOSTABLE_BUILD || !POSTHOG_KEY) return;
  if (!initialized) {
    initAnalytics();
  } else {
    try {
      posthog.opt_in_capturing();
    } catch {
      /* no-op */
    }
  }
}

/** Deny consent: persists the explicit opt-out and stops further captures. */
export function disableAnalytics(): void {
  try {
    localStorage.setItem(CONSENT_KEY, 'denied');
    localStorage.removeItem(LEGACY_OPT_OUT_KEY);
  } catch {
    /* no-op */
  }
  if (initialized) {
    try {
      posthog.opt_out_capturing();
    } catch {
      /* no-op */
    }
  }
}

/** Tie all subsequent events to the given Clerk user id. */
export function identifyUser(clerkUserId: string): void {
  if (IS_SELF_HOSTABLE_BUILD) return;
  if (!initialized || isAnalyticsDisabled()) return;
  try {
    // distinct_id only — no $set props, no email, no metadata.
    posthog.identify(clerkUserId);
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[analytics] identify failed', err);
  }
}

/** De-identify the current session (call on sign-out). */
export function resetAnalytics(): void {
  if (!initialized) return;
  try {
    posthog.reset();
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[analytics] reset failed', err);
  }
}

// ---------------------------------------------------------------------------
// Enforcement core — name-only capture path. NOT exported.
// ---------------------------------------------------------------------------

function captureStrict(name: NameOnlyEvent): void {
  if (IS_SELF_HOSTABLE_BUILD) return;
  if (!initialized || isAnalyticsDisabled()) return;
  try {
    // No second argument. Ever. Do not add one.
    posthog.capture(name);
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[analytics] capture failed', name, err);
  }
}

// ---------------------------------------------------------------------------
// Public name-only helpers (signatures match the old umami.ts 1:1)
// ---------------------------------------------------------------------------

export const trackTransactionLogged = (): void => captureStrict('Transaction Logged');
export const trackTransactionEdited = (): void => captureStrict('Transaction Edited');
export const trackTransactionDeleted = (): void => captureStrict('Transaction Deleted');
export const trackAccountAdded = (): void => captureStrict('Account Added');
export const trackAssignmentUpserted = (): void => captureStrict('Assignment Upserted');
export const trackCategoryAdded = (): void => captureStrict('Category Added');
export const trackCategoryEdited = (): void => captureStrict('Category Edited');
export const trackCategoryDeleted = (): void => captureStrict('Category Deleted');
export const trackCategoryGroupAdded = (): void => captureStrict('Category Group Added');
export const trackCategoryGroupEdited = (): void => captureStrict('Category Group Edited');
export const trackCategoryGroupDeleted = (): void => captureStrict('Category Group Deleted');
export const trackBudgetCreated = (): void => captureStrict('Budget Created');
export const trackImportedFromYnab = (): void => captureStrict('Imported from YNAB');
export const trackImportedCsvPdf = (): void => captureStrict('Imported CSV/PDF');
export const trackSharedBudget = (): void => captureStrict('Shared Budget');
export const trackTrialStarted = (): void => captureStrict('Trial Started');

// ---------------------------------------------------------------------------
// Commercial funnel events — strictly typed prop allowlists.
// ---------------------------------------------------------------------------

export interface CommercePlanProps {
  plan: 'monthly' | 'yearly';
  amount: number; // cents
  currency: string; // ISO code, e.g. 'USD'
}

/** Fire on the post-checkout success page once payment is confirmed. */
export function trackPurchase(props: CommercePlanProps): void {
  if (IS_SELF_HOSTABLE_BUILD) return;
  if (!initialized || isAnalyticsDisabled()) return;
  const { plan, amount, currency } = props;
  try {
    posthog.capture('Purchase', { plan, amount, currency });
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[analytics] capture failed', 'Purchase', err);
  }
}

export interface SubscriptionCanceledProps {
  reason: string;
}

/** Fire after a successful cancellation; reason is the only allowed key. */
export function trackSubscriptionCanceled(props: SubscriptionCanceledProps): void {
  if (IS_SELF_HOSTABLE_BUILD) return;
  if (!initialized || isAnalyticsDisabled()) return;
  const { reason } = props;
  try {
    posthog.capture('Subscription Canceled', { reason });
  } catch (err) {
    if (import.meta.env.DEV)
      console.warn('[analytics] capture failed', 'Subscription Canceled', err);
  }
}

// ---------------------------------------------------------------------------
// Pageview tracking — manual, with path normalization.
// ---------------------------------------------------------------------------

// Rewrites dynamic path segments to placeholders so secrets / user-scoped
// IDs never reach PostHog. Order matters; first match wins.
const PAGEVIEW_NORMALIZERS: readonly (readonly [RegExp, string])[] = [
  [/^\/invite\/.+/, '/invite/:code'],
  [/^\/accounts\/(?!all(?:$|\/))[^/]+(\/.*)?$/, '/accounts/:accountId$1'],
  [/^\/reports\/dashboards\/[^/]+(\/.*)?$/, '/reports/dashboards/:dashboardId$1'],
];

function normalizePagePath(pathname: string): string {
  for (const [re, replacement] of PAGEVIEW_NORMALIZERS) {
    if (re.test(pathname)) return pathname.replace(re, replacement);
  }
  return pathname;
}

/**
 * Fire a `$pageview` with a normalized path. Pass `window.location.pathname`
 * (no search, no hash) — the helper strips dynamic ID/secret segments.
 */
export function trackPageView(pathname: string): void {
  if (IS_SELF_HOSTABLE_BUILD) return;
  if (!initialized || isAnalyticsDisabled()) return;
  const normalized = normalizePagePath(pathname);
  try {
    posthog.capture('$pageview', {
      // Override PostHog's auto-attached `$current_url` (which would otherwise
      // come from window.location.href and include un-sanitized segments).
      $current_url: `${window.location.origin}${normalized}`,
      $pathname: normalized,
    });
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[analytics] capture failed', '$pageview', err);
  }
}
