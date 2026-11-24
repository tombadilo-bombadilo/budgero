import { describe, expect, it } from 'vitest';
import { AppRuntime } from './app-runtime';

/** AppRuntime whose services are bound to `boundDb` while the coordinator's active DB is `activeDb`. */
function stubRuntime(boundDb: object | null, activeDb: object | null) {
  const runtime = new AppRuntime();
  const services = { accounts: {} };
  const internals = runtime as unknown as {
    coordinator: { getDatabase(): object | null };
    serviceManager: {
      isInitialized(): boolean;
      getServices(): unknown;
      getDatabase(): object;
    };
  };
  internals.coordinator = { getDatabase: () => activeDb };
  internals.serviceManager = {
    isInitialized: () => boundDb !== null,
    getServices: () => {
      if (!boundDb) throw Object.assign(new Error('x'), { name: 'ServicesNotReadyError' });
      return services;
    },
    getDatabase: () => {
      if (!boundDb) throw new Error('Database not initialized');
      return boundDb;
    },
  };
  return { runtime, services };
}

describe('AppRuntime services during a workspace switch', () => {
  it('serves services bound to the active database', () => {
    const db = {};
    const { runtime, services } = stubRuntime(db, db);
    expect(runtime.servicesReady()).toBe(true);
    expect(runtime.services()).toBe(services);
  });

  it('refuses services still bound to the closed database of the previous workspace', () => {
    // Switch started: the old session (and its DB) is disposed, the new one is loading.
    const { runtime } = stubRuntime({}, null);
    expect(runtime.servicesReady()).toBe(false);
    expect(() => runtime.services()).toThrow(
      expect.objectContaining({ name: 'ServicesNotReadyError' })
    );
  });

  it('refuses them after the new database is active but before services are rebuilt', () => {
    const { runtime } = stubRuntime({}, {});
    expect(runtime.servicesReady()).toBe(false);
    expect(() => runtime.services()).toThrow(
      expect.objectContaining({ name: 'ServicesNotReadyError' })
    );
  });
});
