/**
 * Budgero product analytics: PostHog Cloud EU, cloud builds only.
 *
 * RULES (do not relax without product sign-off):
 *
 * 1. Self-host builds send nothing and initialize nothing: posthog-js is
 *    loaded with a dynamic import that self-host never reaches.
 *
 * 2. On by default for cloud (legitimate interest), with an opt-out saved on
 *    the server (`users.is_analytics_disabled`, Settings → Security). Nothing is
 *    sent until we know who is using the app: signed out (anonymous), or
 *    signed in with the profile loaded and not opted out. Events raised before
 *    that are held in a small in-memory queue.
 *
 * 3. Cookieless: `persistence: 'memory'`. PostHog writes no cookies and no
 *    local/session storage. The anonymous id lives in memory only; after
 *    sign-in distinct_id is the backend user id and nothing else is set.
 *
 * 4. Every event and prop comes from the typed registry (events.ts): unknown
 *    events or props do not compile, and values are re-checked at runtime.
 *    `before_send` drops anything else and strips URL/referrer/person props.
 *
 * 5. Off: session replay, autocapture, heatmaps, dead clicks, surveys,
 *    toolbar, feature flags, web experiments, automatic pageviews. Pageviews
 *    are manual, with ID segments rewritten. Errors are captured by our own
 *    handlers (error-capture.ts) without message text.
 */
import { i18n } from '@lingui/core';
import type { PostHog, CaptureResult } from 'posthog-js';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import {
  EVENT_SCHEMA,
  sanitizeEvent,
  SETTING_VALUES,
  type AnalyticsEventArgs,
  type AnalyticsEventName,
  type SettingKey,
  type SettingValue,
  type TransactionEntry,
} from './events';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://s.budgero.app';

/** Old opt-in consent keys. An explicit 'denied' is migrated to the server once. */
export const LEGACY_CONSENT_KEY = 'budgero:analytics_consent';
export const LEGACY_OPT_OUT_KEY = 'budgero:analytics_disabled';

const QUEUE_LIMIT = 100;
/** Per event name, so a bulk import can't flood the project. */
const RATE_LIMIT_PER_MINUTE = 30;

export type AnalyticsSubject =
  { kind: 'pending' } | { kind: 'anonymous' } | { kind: 'user'; id: string; optedOut: boolean };

interface QueuedEvent {
  name: string;
  props: Record<string, unknown>;
}

let subject: AnalyticsSubject = { kind: 'pending' };
let client: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;
let identifiedId: string | null = null;
let queue: QueuedEvent[] = [];
let rtaMode: 'cumulative' | 'monthly' | null = null;
const rateWindows = new Map<string, { start: number; count: number }>();

function isCloudBuild(): boolean {
  // Two checks: the env var lets the bundler drop the code, the flag covers
  // runtime self-host (desktop shell).
  if (import.meta.env.VITE_SELF_HOSTABLE === 'true') return false;
  if (IS_SELF_HOSTABLE_BUILD) return false;
  return Boolean(POSTHOG_KEY) && typeof window !== 'undefined';
}

// ---------------------------------------------------------------------------
// Opt-out state
// ---------------------------------------------------------------------------

/** Whether this session must not send anything. */
export function isAnalyticsDisabled(): boolean {
  if (!isCloudBuild()) return true;
  return subject.kind === 'user' && subject.optedOut;
}

function canSendNow(): boolean {
  if (!isCloudBuild()) return false;
  if (subject.kind === 'pending') return false;
  return !isAnalyticsDisabled();
}

/**
 * Tell analytics who is using the app. Called by AnalyticsGate on every auth
 * or profile change; idempotent.
 */
export function setAnalyticsSubject(next: AnalyticsSubject): void {
  if (!isCloudBuild()) return;
  const prev = subject;
  subject = next;

  if (next.kind === 'pending') return;

  if (isAnalyticsDisabled()) {
    queue = [];
    if (client) {
      try {
        client.reset();
      } catch {
        /* no-op */
      }
      identifiedId = null;
    }
    return;
  }

  // Signed out after being signed in: start a fresh anonymous id.
  if (next.kind === 'anonymous' && prev.kind === 'user' && client) {
    try {
      client.reset();
    } catch {
      /* no-op */
    }
    identifiedId = null;
  }

  void ensureClient().then((ph) => {
    if (!ph || !canSendNow()) return;
    const current = subject;
    if (current.kind === 'user' && identifiedId !== current.id) {
      try {
        // distinct_id only: no $set, no email, no metadata.
        ph.identify(current.id);
        identifiedId = current.id;
      } catch {
        /* no-op */
      }
    }
    flushQueue(ph);
  });
}

/** Apply a Settings toggle right away (the server copy is saved separately). */
export function setAnalyticsOptOut(disabled: boolean): void {
  if (subject.kind !== 'user') return;
  setAnalyticsSubject({ ...subject, optedOut: disabled });
}

/** De-identify on sign-out. */
export function resetAnalytics(): void {
  queue = [];
  identifiedId = null;
  if (!client) return;
  try {
    client.reset();
  } catch {
    /* no-op */
  }
}

/** Budget context for the rta_mode super prop (null when no budget is open). */
export function setAnalyticsBudgetContext(mode: string | null | undefined): void {
  rtaMode = mode === 'monthly' ? 'monthly' : mode === 'cumulative' ? 'cumulative' : null;
}

// ---------------------------------------------------------------------------
// PostHog client
// ---------------------------------------------------------------------------

const DROP_PROP =
  /url|referr|pathname|title|search|utm_|gclid|fbclid|msclkid|[gw]braid|dclid|clid|_kx|mc_cid|igshid/i;
const ALLOWED_SYSTEM_EVENTS = new Set(['$pageview', '$identify', '$exception', 'Purchase']);

/** Last line of defence: only registry events, no URL/referrer/person props. */
export function scrubOutgoing(event: CaptureResult | null): CaptureResult | null {
  if (!event) return null;
  if (!ALLOWED_SYSTEM_EVENTS.has(event.event) && !Object.keys(EVENT_SCHEMA).includes(event.event))
    return null;
  const props = { ...(event.properties ?? {}) } as Record<string, unknown>;
  // A manual pageview names its own (already normalized) path; keep it.
  const ownPath =
    event.event === '$pageview' && typeof props.$pathname === 'string' ? props.$pathname : null;
  for (const key of Object.keys(props)) {
    if (DROP_PROP.test(key)) delete props[key];
  }
  delete props.$set;
  delete props.$set_once;
  const path = normalizePagePath(
    ownPath ?? (typeof window !== 'undefined' ? window.location.pathname : '/')
  );
  props.$pathname = path;
  props.$current_url = `${typeof window !== 'undefined' ? window.location.origin : ''}${path}`;
  const out = { ...event, properties: props } as CaptureResult & Record<string, unknown>;
  delete out.$set;
  delete out.$set_once;
  return out;
}

function ensureClient(): Promise<PostHog | null> {
  if (client) return Promise.resolve(client);
  if (!isCloudBuild()) return Promise.resolve(null);
  if (loading) return loading;
  loading = import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(POSTHOG_KEY as string, {
        api_host: POSTHOG_HOST,
        ui_host: 'https://eu.posthog.com',
        defaults: '2026-05-30',
        // Cookieless: identity lives in memory only.
        persistence: 'memory',
        person_profiles: 'identified_only',
        save_referrer: false,
        capture_pageview: false,
        capture_pageleave: false,
        autocapture: false,
        capture_heatmaps: false,
        capture_dead_clicks: false,
        rageclick: false,
        capture_exceptions: false,
        capture_performance: false,
        disable_session_recording: true,
        disable_surveys: true,
        disable_web_experiments: true,
        disable_product_tours: true,
        disable_conversations: true,
        disable_external_dependency_loading: true,
        disable_scroll_properties: true,
        advanced_disable_flags: true,
        advanced_disable_toolbar_metrics: true,
        before_send: scrubOutgoing,
      });
      client = posthog;
      return posthog;
    })
    .catch(() => {
      loading = null;
      return null;
    });
  return loading;
}

function flushQueue(ph: PostHog): void {
  const pending = queue;
  queue = [];
  for (const item of pending) send(ph, item.name, item.props);
}

function appVersion(): string {
  const raw = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
  return raw.split('+')[0];
}

function platform(): 'web' | 'pwa' {
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return 'pwa';
    if ((navigator as Navigator & { standalone?: boolean }).standalone) return 'pwa';
  } catch {
    /* no-op */
  }
  return 'web';
}

function superProps(): Record<string, string> {
  const props: Record<string, string> = {
    app_version: appVersion(),
    platform: platform(),
    locale: (SETTING_VALUES.language as readonly string[]).includes(i18n.locale)
      ? i18n.locale
      : 'other',
  };
  if (rtaMode) props.rta_mode = rtaMode;
  return props;
}

function underRateLimit(name: string): boolean {
  const now = Date.now();
  const window = rateWindows.get(name);
  if (!window || now - window.start >= 60_000) {
    rateWindows.set(name, { start: now, count: 1 });
    return true;
  }
  window.count += 1;
  return window.count <= RATE_LIMIT_PER_MINUTE;
}

function send(ph: PostHog, name: string, props: Record<string, unknown>): void {
  if (!canSendNow()) return;
  if (!underRateLimit(name)) return;
  try {
    ph.capture(name, { ...props, ...superProps() });
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[analytics] capture failed', name, err);
  }
}

/** Route one already-sanitized event: queue while pending, else send. */
function dispatch(name: string, props: Record<string, unknown>): void {
  if (!isCloudBuild() || isAnalyticsDisabled()) return;
  if (subject.kind === 'pending' || !client) {
    if (queue.length >= QUEUE_LIMIT) queue.shift();
    queue.push({ name, props });
    if (subject.kind !== 'pending') {
      void ensureClient().then((ph) => ph && flushQueue(ph));
    }
    return;
  }
  send(client, name, props);
}

// ---------------------------------------------------------------------------
// Public capture API
// ---------------------------------------------------------------------------

/**
 * Capture a registry event. The props type is exact per event; values are
 * re-validated, and only schema keys are forwarded.
 */
export function track<E extends AnalyticsEventName>(name: E, ...args: AnalyticsEventArgs<E>): void {
  if (!isCloudBuild()) return;
  const clean = sanitizeEvent(name, args[0]);
  if (!clean) {
    if (import.meta.env.DEV) console.warn('[analytics] dropped invalid event', name);
    return;
  }
  dispatch(name, clean);
}

/** setting_changed with the value list of that setting. */
export function trackSettingChanged<S extends SettingKey>(
  setting: S,
  value: SettingValue<S>
): void {
  track('setting_changed', { setting, value } as never);
}

/** Internal: the error capture module sends a pre-scrubbed $exception. */
export function captureScrubbedException(props: Record<string, unknown>): void {
  if (!isCloudBuild()) return;
  dispatch('$exception', props);
}

// Name-only helpers kept for existing call sites.
export const trackTransactionLogged = (entry: TransactionEntry): void =>
  track('Transaction Logged', { entry });
export const trackTransactionEdited = (): void => track('Transaction Edited');
export const trackTransactionDeleted = (): void => track('Transaction Deleted');
export const trackAssignmentUpserted = (): void => track('Assignment Upserted');
export const trackCategoryAdded = (): void => track('Category Added');
export const trackCategoryEdited = (): void => track('Category Edited');
export const trackCategoryDeleted = (): void => track('Category Deleted');
export const trackCategoryGroupAdded = (): void => track('Category Group Added');
export const trackCategoryGroupEdited = (): void => track('Category Group Edited');
export const trackCategoryGroupDeleted = (): void => track('Category Group Deleted');
export const trackBudgetCreated = (): void => track('Budget Created');
export const trackImportedFromYnab = (): void => track('Imported from YNAB');
export const trackImportedCsvPdf = (): void => track('Imported CSV/PDF');
export const trackSharedBudget = (): void => track('Shared Budget');
export const trackTrialStarted = (): void => track('Trial Started');
export const trackSignupViewed = (): void => track('Signup Viewed');

// ---------------------------------------------------------------------------
// Commerce
// ---------------------------------------------------------------------------

export interface CommercePlanProps {
  plan: 'monthly' | 'yearly';
  amount: number; // plan price in cents
  currency: string; // ISO code, e.g. 'USD'
}

/** Fire on the post-checkout success page once payment is confirmed. */
export function trackPurchase(props: CommercePlanProps): void {
  const { plan, amount, currency } = props;
  if (plan !== 'monthly' && plan !== 'yearly') return;
  if (!Number.isFinite(amount) || !/^[A-Z]{3}$/.test(currency)) return;
  dispatch('Purchase', { plan, amount: Math.round(amount), currency });
}

export type CancelReason = AnalyticsEventArgs<'Subscription Canceled'>[0]['reason'];

/** Fire after a successful cancellation; only the reason option, never notes. */
export function trackSubscriptionCanceled(reason: CancelReason): void {
  track('Subscription Canceled', { reason });
}

// ---------------------------------------------------------------------------
// Pageviews — manual, with path normalization
// ---------------------------------------------------------------------------

// Rewrites dynamic path segments to placeholders so secrets / user-scoped
// IDs never reach PostHog. Order matters; first match wins.
const PAGEVIEW_NORMALIZERS: readonly (readonly [RegExp, string])[] = [
  [/^\/invite\/.+/, '/invite/:code'],
  [/^\/accounts\/(?!all(?:$|\/))[^/]+(\/.*)?$/, '/accounts/:accountId$1'],
  [/^\/reports\/dashboards\/[^/]+(\/.*)?$/, '/reports/dashboards/:dashboardId$1'],
];

export function normalizePagePath(pathname: string): string {
  for (const [re, replacement] of PAGEVIEW_NORMALIZERS) {
    if (re.test(pathname)) return pathname.replace(re, replacement);
  }
  return pathname;
}

/** Fire a `$pageview` for `window.location.pathname` (no search, no hash). */
export function trackPageView(pathname: string): void {
  if (!isCloudBuild()) return;
  const normalized = normalizePagePath(pathname);
  dispatch('$pageview', {
    $current_url: `${window.location.origin}${normalized}`,
    $pathname: normalized,
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/**
 * Boot hook (main.tsx). Clears what the old cookie-based setup left on this
 * device: PostHog's localStorage/cookie and Klaro's consent record. PostHog
 * itself loads once AnalyticsGate knows who is using the app.
 */
export function initAnalytics(): void {
  if (typeof window === 'undefined') return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (
        key &&
        (/^ph_.*_posthog$/.test(key) || key.startsWith('__ph_opt_in_out_') || key === 'klaro')
      ) {
        localStorage.removeItem(key);
      }
    }
    localStorage.removeItem(LEGACY_CONSENT_KEY);
    localStorage.removeItem(LEGACY_OPT_OUT_KEY);
  } catch {
    /* no-op */
  }
  try {
    const host = window.location.hostname;
    const domains = ['', host, host.endsWith('budgero.app') ? '.budgero.app' : ''].filter(
      (d, i, all) => all.indexOf(d) === i
    );
    for (const part of document.cookie.split(';')) {
      const name = part.split('=')[0]?.trim();
      if (!name || !(/^ph_.*_posthog$/.test(name) || name === 'klaro')) continue;
      for (const domain of domains) {
        document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`;
      }
    }
  } catch {
    /* no-op */
  }
}

/** Test-only: reset module state. */
export function __resetAnalyticsForTests(): void {
  subject = { kind: 'pending' };
  client = null;
  loading = null;
  identifiedId = null;
  queue = [];
  rtaMode = null;
  rateWindows.clear();
}
