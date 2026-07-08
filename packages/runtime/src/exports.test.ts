import { describe, expect, it } from 'vitest';
import * as runtime from './index';
import * as browser from './browser';

describe('public exports', () => {
  it('exposes expected runtime classes and helpers', () => {
    expect(runtime.RuntimeCoordinator).toBeTypeOf('function');
    expect(runtime.KeyVault).toBeTypeOf('function');
    expect(runtime.ConnectivityMonitor).toBeTypeOf('function');
    expect(runtime.OfflineQueue).toBeTypeOf('function');
    expect(runtime.SpaceRegistry).toBeTypeOf('function');
    expect(runtime.MutationExecutor).toBeTypeOf('function');
    expect(runtime.DatabaseSync).toBeTypeOf('function');
    expect(runtime.SyncTransport).toBeTypeOf('function');
    expect(runtime.generateMutationId).toBeTypeOf('function');
  });

  it('browser entry re-exports runtime api', () => {
    expect(browser.RuntimeCoordinator).toBe(runtime.RuntimeCoordinator);
    expect(browser.DatabaseSync).toBe(runtime.DatabaseSync);
  });
});
