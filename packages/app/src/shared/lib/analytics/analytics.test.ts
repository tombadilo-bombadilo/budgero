import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureResult } from 'posthog-js';
import { ONBOARDING_STEPS } from '@pages/onboarding/onboarding-data';
import { SUPPORTED_LOCALES } from '@shared/runtime/locale-preference';
import {
  countBucket,
  durationBucket,
  EVENT_SCHEMA,
  ONBOARDING_STEP_IDS,
  sanitizeEvent,
  SETTING_VALUES,
} from './events';

const posthog = {
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
};
vi.mock('posthog-js', () => ({ default: posthog }));

const envState = { selfHost: false };
vi.mock('@shared/lib/env', () => ({
  get IS_SELF_HOSTABLE_BUILD() {
    return envState.selfHost;
  },
}));

type TrackModule = typeof import('./track');

async function loadTrack(): Promise<TrackModule> {
  vi.resetModules();
  vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
  return import('./track');
}

/** Let the dynamic posthog import and the flush settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  envState.selfHost = false;
  for (const fn of Object.values(posthog)) fn.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('event registry', () => {
  it('rejects unknown events', () => {
    expect(sanitizeEvent('Payee Renamed', {})).toBeNull();
    expect(sanitizeEvent('__proto__', {})).toBeNull();
  });

  it('forwards only schema keys, never extra props', () => {
    const out = sanitizeEvent('goal_created', {
      type: 'monthly',
      name: 'Holiday in Rome',
      amount: 1200,
    });
    expect(out).toEqual({ type: 'monthly' });
  });

  it('drops an event whose value is outside its list', () => {
    expect(sanitizeEvent('goal_created', { type: 'Holiday in Rome' })).toBeNull();
    expect(sanitizeEvent('import_started', { source: 'csv' })).toBeNull(); // missing context
  });

  it('turns an unlisted error_code into unknown instead of forwarding text', () => {
    const out = sanitizeEvent('ai_message_sent', {
      outcome: 'error',
      error_code: 'Request failed: invalid API key sk-123',
    });
    expect(out).toEqual({ outcome: 'error', error_code: 'unknown' });
  });

  it('checks setting_changed values against that setting', () => {
    expect(sanitizeEvent('setting_changed', { setting: 'theme', value: 'paper' })).toEqual({
      setting: 'theme',
      value: 'paper',
    });
    expect(sanitizeEvent('setting_changed', { setting: 'theme', value: 'monday' })).toBeNull();
  });

  it('keeps cancel reasons to the fixed options', () => {
    expect(sanitizeEvent('Subscription Canceled', { reason: 'other' })).toEqual({
      reason: 'other',
    });
    expect(sanitizeEvent('Subscription Canceled', { reason: 'my bank is slow' })).toBeNull();
  });

  it('only allows enum strings as values', () => {
    for (const [name, props] of Object.entries(EVENT_SCHEMA)) {
      for (const values of Object.values(props as Record<string, readonly string[]>)) {
        expect(
          values.every((v) => typeof v === 'string' && v.length < 40),
          name
        ).toBe(true);
      }
    }
  });

  it('matches the real onboarding steps and locales', () => {
    expect([...ONBOARDING_STEP_IDS].sort()).toEqual(ONBOARDING_STEPS.map((s) => s.id).sort());
    expect([...SETTING_VALUES.language].sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it('buckets counts and durations', () => {
    expect([0, 1, 10, 11, 1000, 10001].map(countBucket)).toEqual([
      '0',
      '1-10',
      '1-10',
      '10-100',
      '100-1k',
      '10k+',
    ]);
    expect([5_000, 30_000, 120_000, 600_000, 3_600_000].map(durationBucket)).toEqual([
      '<10s',
      '10-60s',
      '1-5m',
      '5-15m',
      '15m+',
    ]);
  });

  it('rejects unknown events and props at compile time', async () => {
    const { track } = await loadTrack();
    const typeChecks = () => {
      // @ts-expect-error unknown event
      track('Payee Renamed');
      // @ts-expect-error unknown prop
      track('goal_created', { type: 'monthly', name: 'Rome' });
      // @ts-expect-error value outside the list
      track('goal_created', { type: 'Rome' });
      // @ts-expect-error props on a name-only event
      track('workspace_switched', { id: '1' });
    };
    expect(typeChecks).toBeTypeOf('function');
  });
});

// ---------------------------------------------------------------------------
// Opt-out paths
// ---------------------------------------------------------------------------

describe('sending', () => {
  it('self-host sends and initializes nothing', async () => {
    envState.selfHost = true;
    const a = await loadTrack();
    a.setAnalyticsSubject({ kind: 'user', id: 'user_1', optedOut: false });
    a.track('workspace_switched');
    a.trackPageView('/budgeting');
    await settle();
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('sends nothing without a PostHog key', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_POSTHOG_KEY', '');
    const a = await import('./track');
    a.setAnalyticsSubject({ kind: 'anonymous' });
    a.track('workspace_switched');
    await settle();
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it('holds events until the user is known, then sends them identified', async () => {
    const a = await loadTrack();
    a.track('workspace_switched');
    await settle();
    expect(posthog.init).not.toHaveBeenCalled();

    a.setAnalyticsSubject({ kind: 'user', id: 'user_1', optedOut: false });
    await settle();
    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.identify).toHaveBeenCalledWith('user_1');
    expect(posthog.capture).toHaveBeenCalledWith(
      'workspace_switched',
      expect.objectContaining({ platform: 'web', app_version: expect.any(String) })
    );
  });

  it('initializes cookieless with everything automatic off', async () => {
    const a = await loadTrack();
    a.setAnalyticsSubject({ kind: 'anonymous' });
    await settle();
    const config = posthog.init.mock.calls[0][1];
    expect(config).toMatchObject({
      persistence: 'memory',
      autocapture: false,
      capture_pageview: false,
      capture_exceptions: false,
      disable_session_recording: true,
      disable_surveys: true,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      advanced_disable_flags: true,
    });
    expect(posthog.identify).not.toHaveBeenCalled();
  });

  it('an opted-out user sends nothing, including what was queued', async () => {
    const a = await loadTrack();
    a.track('workspace_switched');
    a.setAnalyticsSubject({ kind: 'user', id: 'user_1', optedOut: true });
    a.track('account_closed');
    await settle();
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(a.isAnalyticsDisabled()).toBe(true);
  });

  it('honours a server opt-out that arrives mid-session', async () => {
    const a = await loadTrack();
    a.setAnalyticsSubject({ kind: 'user', id: 'user_1', optedOut: false });
    a.track('workspace_switched');
    await settle();
    expect(posthog.capture).toHaveBeenCalledTimes(1);

    a.setAnalyticsOptOut(true);
    a.track('account_closed');
    a.trackPageView('/budgeting');
    await settle();
    expect(posthog.capture).toHaveBeenCalledTimes(1);
    expect(posthog.reset).toHaveBeenCalled();
  });

  it('keeps an old local opt-out until the server holds it', async () => {
    localStorage.setItem('budgero:analytics_consent', 'denied');
    const a = await loadTrack();
    a.setAnalyticsSubject({ kind: 'user', id: 'user_1', optedOut: false });
    a.track('workspace_switched');
    await settle();
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(a.hasLegacyLocalOptOut()).toBe(true);
    a.clearLegacyConsent();
    expect(a.hasLegacyLocalOptOut()).toBe(false);
  });

  it('boot cleanup removes old PostHog and Klaro storage', async () => {
    localStorage.setItem('ph_phc_test_posthog', '{"distinct_id":"x"}');
    localStorage.setItem('klaro', '{"posthog":true}');
    localStorage.setItem('budgero:analytics_consent', 'granted');
    const a = await loadTrack();
    a.initAnalytics();
    expect(localStorage.getItem('ph_phc_test_posthog')).toBeNull();
    expect(localStorage.getItem('klaro')).toBeNull();
    expect(localStorage.getItem('budgero:analytics_consent')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// before_send scrubbing
// ---------------------------------------------------------------------------

describe('scrubOutgoing', () => {
  it('drops events outside the registry', async () => {
    const { scrubOutgoing } = await loadTrack();
    expect(scrubOutgoing({ event: '$autocapture', properties: {} } as CaptureResult)).toBeNull();
    expect(scrubOutgoing({ event: '$rageclick', properties: {} } as CaptureResult)).toBeNull();
  });

  it('strips person props, referrers and raw URLs', async () => {
    const { scrubOutgoing } = await loadTrack();
    window.history.replaceState(null, '', '/accounts/42?q=rent#x');
    const out = scrubOutgoing({
      event: 'workspace_switched',
      properties: {
        $current_url: 'https://my.budgero.app/accounts/42?q=rent',
        $referrer: 'https://mail.example.com/inbox/123',
        $initial_referring_domain: 'mail.example.com',
        utm_source: 'newsletter',
        title: 'Rent — Budgero',
        $set: { email: 'a@b.c' },
        $set_once: { $initial_current_url: 'x' },
        platform: 'web',
      },
      $set: { email: 'a@b.c' },
    } as unknown as CaptureResult) as unknown as Record<string, Record<string, unknown>>;
    const json = JSON.stringify(out);
    expect(json).not.toContain('42');
    expect(json).not.toContain('q=rent');
    expect(json).not.toContain('example.com');
    expect(json).not.toContain('a@b.c');
    expect(out.properties.$pathname).toBe('/accounts/:accountId');
    expect(out.properties.platform).toBe('web');
    expect(out.$set).toBeUndefined();

    const pageview = scrubOutgoing({
      event: '$pageview',
      properties: { $pathname: '/reports/dashboards/:dashboardId', $current_url: 'x?y=1' },
    } as unknown as CaptureResult) as unknown as Record<string, Record<string, unknown>>;
    expect(pageview.properties.$pathname).toBe('/reports/dashboards/:dashboardId');
    window.history.replaceState(null, '', '/');
  });
});
