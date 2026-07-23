import { describe, expect, it } from 'vitest';

import { isRecoveryRoute } from './policy';

describe('isRecoveryRoute', () => {
  it('includes /join so invited users can redeem a share code without an active plan', () => {
    expect(isRecoveryRoute('/join')).toBe(true);
  });

  it('matches exact recovery routes only exactly', () => {
    expect(isRecoveryRoute('/subscription/success')).toBe(true);
    expect(isRecoveryRoute('/subscription/success/extra')).toBe(false);
    expect(isRecoveryRoute('/join/extra')).toBe(false);
  });

  it('matches settings recovery routes by prefix', () => {
    expect(isRecoveryRoute('/settings/subscription')).toBe(true);
    expect(isRecoveryRoute('/settings/workspaces')).toBe(true);
    expect(isRecoveryRoute('/settings/account')).toBe(true);
    expect(isRecoveryRoute('/settings/data')).toBe(true);
    expect(isRecoveryRoute('/dashboard')).toBe(false);
  });
});
