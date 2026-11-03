import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const posthog = {
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
};
vi.mock('posthog-js', () => ({ default: posthog }));
vi.mock('@shared/lib/env', () => ({ IS_SELF_HOSTABLE_BUILD: false }));

type Modules = {
  track: typeof import('./track');
  fm: typeof import('./first-month');
};

let current: Modules | null = null;

async function load(): Promise<Modules> {
  current?.fm.resetFirstMonthForTests();
  vi.resetModules();
  vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
  const track = await import('./track');
  const fm = await import('./first-month');
  current = { track, fm };
  return current;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const DAY = 86_400_000;

function captured(name: string) {
  return posthog.capture.mock.calls
    .filter(([n]) => n === name)
    .map(([, props, opts]) => ({
      props: props as Record<string, string>,
      opts,
    }));
}

async function signIn(m: Modules, createdAt: Date, optedOut = false) {
  m.track.setAnalyticsSubject({ kind: 'user', id: 'user_1', optedOut });
  if (!optedOut) m.fm.setFirstMonthUser('user_1', createdAt.toISOString());
  await settle();
}

beforeEach(() => {
  for (const fn of Object.values(posthog)) fn.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('first-month analytics', () => {
  it('reports app_opened once per day with days since signup', async () => {
    const m = await load();
    await signIn(m, new Date(Date.now() - 2 * DAY));
    m.fm.setFirstMonthUser('user_1', new Date(Date.now() - 2 * DAY).toISOString());
    await settle();
    expect(captured('app_opened').map((c) => c.props.day)).toEqual(['2']);
  });

  it('sends nothing after the first month', async () => {
    const m = await load();
    await signIn(m, new Date(Date.now() - 40 * DAY));
    m.track.track('Assignment Upserted');
    window.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(captured('app_opened')).toHaveLength(0);
    expect(captured('activation_milestone')).toHaveLength(0);
    expect(captured('session_summary')).toHaveLength(0);
  });

  it('records each milestone once, only for typed-in transactions', async () => {
    const m = await load();
    await signIn(m, new Date());
    m.track.track('Transaction Logged', { entry: 'import' });
    m.track.track('Transaction Logged', { entry: 'inline' });
    m.track.track('Transaction Logged', { entry: 'dialog' });
    m.track.track('Assignment Upserted');
    m.track.track('Assignment Upserted');
    await settle();
    expect(captured('activation_milestone').map((c) => c.props)).toEqual([
      expect.objectContaining({ milestone: 'first_transaction', day: '0' }),
      expect.objectContaining({ milestone: 'first_assign', day: '0' }),
    ]);
  });

  it('counts Ready to Assign at zero only after assigning in this visit', async () => {
    const m = await load();
    await signIn(m, new Date());
    m.fm.noteReadyToAssign(0);
    await settle();
    expect(captured('activation_milestone')).toHaveLength(0);
    m.track.track('Assignment Upserted');
    m.fm.noteReadyToAssign(0);
    await settle();
    expect(captured('activation_milestone').map((c) => c.props.milestone)).toEqual([
      'first_assign',
      'rta_zero',
    ]);
  });

  it('sends a session summary with sendBeacon on pagehide, once', async () => {
    const m = await load();
    await signIn(m, new Date(Date.now() - 5 * DAY));
    m.track.track('Transaction Logged', { entry: 'inline' });
    m.track.track('Assignment Upserted');
    m.track.track('import_finished', {
      source: 'csv',
      context: 'app',
      outcome: 'ok',
      error_code: 'none',
      rows_bucket: '10-100',
      duration_bucket: '<10s',
    });
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pagehide'));
    const summaries = captured('session_summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0].props).toMatchObject({
      day: '4-7',
      transactions_bucket: '1-10',
      assignments_bucket: '1-10',
      imported: 'yes',
    });
    expect(summaries[0].opts).toEqual({ transport: 'sendBeacon' });
  });

  it('counts nothing for a user who opted out', async () => {
    const m = await load();
    await signIn(m, new Date(), true);
    m.track.track('Assignment Upserted');
    window.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('reports an empty screen once per visit', async () => {
    const m = await load();
    await signIn(m, new Date());
    m.fm.noteEmptyState('reports');
    m.fm.noteEmptyState('reports');
    m.fm.noteEmptyState('budget');
    await settle();
    expect(captured('empty_state_viewed').map((c) => c.props.screen)).toEqual([
      'reports',
      'budget',
    ]);
  });

  it('buckets days since signup', async () => {
    const { fm } = await load();
    expect([0, 1, 3, 4, 7, 8, 14, 15, 30].map(fm.signupDayBucket)).toEqual([
      '0',
      '1',
      '3',
      '4-7',
      '4-7',
      '8-14',
      '8-14',
      '15-30',
      '15-30',
    ]);
  });
});
