import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const posthog = {
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
};
vi.mock('posthog-js', () => ({ default: posthog }));
vi.mock('@shared/lib/env', () => ({ IS_SELF_HOSTABLE_BUILD: false }));

async function loadTrack() {
  vi.resetModules();
  vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
  return import('./track');
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  for (const fn of Object.values(posthog)) fn.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('PostHog identity bootstrap', () => {
  it('starts with the known user id instead of a fresh anonymous id', async () => {
    const a = await loadTrack();
    a.setAnalyticsSubject({ kind: 'user', id: 'user_1', optedOut: false });
    await settle();
    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.init.mock.calls[0][1]).toMatchObject({
      bootstrap: { distinctID: 'user_1', isIdentifiedID: true },
      persistence: 'memory',
    });
    // identify() still runs, but with the id PostHog already has: nothing to merge.
    for (const [id] of posthog.identify.mock.calls) expect(id).toBe('user_1');
  });

  it('starts anonymous before login, then identifies once', async () => {
    const a = await loadTrack();
    a.setAnalyticsSubject({ kind: 'anonymous' });
    await settle();
    expect(posthog.init.mock.calls[0][1]).not.toHaveProperty('bootstrap');
    a.setAnalyticsSubject({ kind: 'user', id: 'user_2', optedOut: false });
    await settle();
    expect(posthog.identify).toHaveBeenCalledTimes(1);
    expect(posthog.identify).toHaveBeenCalledWith('user_2');
  });

  it('never loads PostHog for an opted-out user', async () => {
    const a = await loadTrack();
    a.setAnalyticsSubject({ kind: 'user', id: 'user_3', optedOut: true });
    await settle();
    expect(posthog.init).not.toHaveBeenCalled();
  });
});
