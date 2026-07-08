import { describe, expect, it } from 'vitest';
import { RuntimeStatePolicy } from './runtime-state-policy';

describe('RuntimeStatePolicy', () => {
  it('resolves init and switch intents with strict guards', () => {
    const policy = new RuntimeStatePolicy();

    expect(policy.resolveIntent('init:start', 'Idle')).toBe('Initializing');
    expect(policy.resolveIntent('init:success', 'Initializing')).toBe('Ready');
    expect(policy.resolveIntent('switch:start', 'Ready')).toBe('SwitchingSpace');
    expect(policy.resolveIntent('switch:success', 'SwitchingSpace')).toBe('Ready');
    expect(policy.resolveIntent('destroy', 'Ready')).toBe('Destroyed');
  });

  it('supports helper policy checks', () => {
    const policy = new RuntimeStatePolicy();

    expect(policy.shouldNoopInit('Ready')).toBe(true);
    expect(policy.shouldNoopInit('Idle')).toBe(false);
    expect(policy.shouldResetBeforeInit('Error')).toBe(true);
    expect(policy.shouldResetBeforeInit('Destroyed')).toBe(true);
    expect(policy.shouldResetBeforeInit('Ready')).toBe(false);
    expect(policy.canSwitchSpace('Ready')).toBe(true);
    expect(policy.canSwitchSpace('Idle')).toBe(false);
    expect(policy.canExecuteMutation('Degraded')).toBe(true);
    expect(policy.canExecuteMutation('Initializing')).toBe(false);
    expect(policy.isInitialized('Reconnecting')).toBe(true);
    expect(policy.isInitialized('Idle')).toBe(false);
  });

  it('rejects invalid intent/state combinations', () => {
    const policy = new RuntimeStatePolicy();

    expect(() => policy.resolveIntent('switch:start', 'Idle')).toThrow('Cannot switch space');
    expect(() => policy.resolveIntent('init:success', 'Ready')).toThrow('Cannot complete init');
    expect(() => policy.resolveIntent('init:reset', 'Idle')).toThrow('Cannot reset init');
    expect(() => policy.resolveIntent('init:failure', 'Ready')).toThrow('Cannot fail init');
    expect(() => policy.resolveIntent('switch:failure', 'Ready')).toThrow('Cannot fail switch');
    expect(() => policy.resolveIntent('init:start', 'Ready')).toThrow('Cannot start init');
    expect(() => policy.resolveIntent('switch:success', 'Ready')).toThrow('Cannot complete switch');
  });

  it('returns current state for unknown intent fallthrough', () => {
    const policy = new RuntimeStatePolicy();
    expect(policy.resolveIntent('unknown:intent' as never, 'Degraded')).toBe('Degraded');
  });
});
