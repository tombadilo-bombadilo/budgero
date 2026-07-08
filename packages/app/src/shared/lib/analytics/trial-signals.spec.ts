import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reportTrialSignal } from './trial-signals';

const { postMock } = vi.hoisted(() => ({
  postMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('@shared/api/api-client', () => ({
  apiClient: { post: postMock },
}));

vi.mock('@shared/lib/env', () => ({
  IS_SELF_HOSTABLE_BUILD: false,
}));

describe('reportTrialSignal consent decoupling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  // Trial signals are functional (they compute a discount the user is actively
  // earning) and carry no PII, so they are intentionally NOT gated by the
  // analytics consent. Rejecting analytics cookies sets the client
  // `budgero:analytics_consent` flag to 'denied' (via disableAnalytics()), and
  // that must NOT stop a user from earning their reward. The only honored
  // opt-out is the explicit Settings → Privacy → "Trial Reward Tracking"
  // toggle, enforced server-side in RecordSignal via the user's
  // is_trial_signals_disabled flag.
  it('still fires even when the client analytics consent is denied', () => {
    localStorage.setItem('budgero:analytics_consent', 'denied');
    reportTrialSignal('reconciliation');
    expect(postMock).toHaveBeenCalledWith('/trial/signal', { kind: 'reconciliation' });
  });

  it('fires for a normal (non-opted-out) user', () => {
    reportTrialSignal('reconciliation');
    expect(postMock).toHaveBeenCalledWith('/trial/signal', { kind: 'reconciliation' });
  });
});
