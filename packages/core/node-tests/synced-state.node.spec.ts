import { describe, expect, it } from 'vitest';
import {
  DatabaseAdapter,
  NodeSqlJsAdapter,
  ServiceManager,
  SYNCED_STATE_MAX_TOMBSTONES,
  SYNCED_STATE_MAX_VALUE_LENGTH,
  type SyncedStateService,
} from '../src';

async function store(): Promise<SyncedStateService> {
  const adapter = await NodeSqlJsAdapter.create();
  const serviceManager = new ServiceManager();
  await serviceManager.initialize(adapter as DatabaseAdapter);
  return serviceManager.getServices().syncedState;
}

const T1 = '2026-11-12T10:00:00.000Z';
const T2 = '2026-11-12T10:00:01.000Z';
const T3 = '2026-11-12T10:00:02.000Z';

type Op = (s: SyncedStateService) => void;

/** Applies the same ops in every order and expects one result. */
async function convergesTo(ops: Op[], read: (s: SyncedStateService) => unknown) {
  const orders =
    ops.length === 2
      ? [
          [0, 1],
          [1, 0],
        ]
      : permutations(ops.map((_, i) => i));
  const results = [];
  for (const order of orders) {
    const s = await store();
    order.forEach((i) => ops[i](s));
    results.push(JSON.stringify(read(s)));
  }
  expect(new Set(results).size).toBe(1);
  return JSON.parse(results[0]) as unknown;
}

function permutations(items: number[]): number[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])
  );
}

describe('synced state: set', () => {
  it('round-trips JSON values per scope and key', async () => {
    const s = await store();
    expect(s.get('workspace', 'importRoutes')).toBeUndefined();
    s.set('workspace', 'importRoutes', { a: 1 }, T1);
    s.set('user:u1', 'theme', 'dark', T1);
    s.set('budget:3', 'savingsTarget', 1200, T1);
    expect(s.get('workspace', 'importRoutes')).toEqual({ a: 1 });
    expect(s.get('user:u1', 'theme')).toBe('dark');
    expect(s.get('user:u2', 'theme')).toBeUndefined();
    expect(s.get('budget:3', 'savingsTarget')).toBe(1200);
    expect(s.getEntry('user:u1', 'theme')).toEqual({ value: 'dark', updatedAt: T1 });
  });

  it('keeps the newest write whatever order writes arrive in', async () => {
    const value = await convergesTo(
      [(s) => s.set('workspace', 'k', 'old', T1), (s) => s.set('workspace', 'k', 'new', T2)],
      (s) => s.get('workspace', 'k')
    );
    expect(value).toBe('new');
  });

  it('breaks a tie on time the same way everywhere', async () => {
    await convergesTo(
      [(s) => s.set('workspace', 'k', 'a', T1), (s) => s.set('workspace', 'k', 'b', T1)],
      (s) => s.get('workspace', 'k')
    );
  });

  it('deletes with null, and an older set arriving later does not bring it back', async () => {
    const value = await convergesTo(
      [(s) => s.set('workspace', 'k', 'v', T1), (s) => s.set('workspace', 'k', null, T2)],
      (s) => s.getEntry('workspace', 'k')
    );
    expect(value).toBeNull();
  });
});

describe('synced state: merge', () => {
  it('keeps entries two devices add at once', async () => {
    const value = await convergesTo(
      [
        (s) => s.merge('workspace', 'templates', { set: { a: { n: 1 } } }, T1),
        (s) => s.merge('workspace', 'templates', { set: { b: { n: 2 } } }, T2),
      ],
      (s) => s.get('workspace', 'templates')
    );
    expect(value).toEqual({ a: { n: 1 }, b: { n: 2 } });
  });

  it('removes an entry, and an older add of it arriving later stays removed', async () => {
    const value = await convergesTo(
      [
        (s) => s.merge('workspace', 'm', { set: { a: 1, b: 2 } }, T1),
        (s) => s.merge('workspace', 'm', { remove: ['a'] }, T2),
      ],
      (s) => s.get('workspace', 'm')
    );
    expect(value).toEqual({ b: 2 });
  });

  it('converges when merges and a whole-value set interleave', async () => {
    const value = await convergesTo(
      [
        (s) => s.merge('workspace', 'm', { set: { a: 1 } }, T1),
        (s) => s.set('workspace', 'm', { z: 0 }, T2),
        (s) => s.merge('workspace', 'm', { set: { c: 3 }, remove: ['z'] }, T3),
      ],
      (s) => s.get('workspace', 'm')
    );
    expect(value).toEqual({ c: 3 });
  });

  it('reports whether anything changed', async () => {
    const s = await store();
    expect(s.merge('workspace', 'm', { set: { a: 1 } }, T2)).toBe(true);
    expect(s.merge('workspace', 'm', { set: { a: 0 } }, T1)).toBe(false);
    expect(s.set('workspace', 'k', 1, T2)).toBe(true);
    expect(s.set('workspace', 'k', 2, T1)).toBe(false);
  });
});

describe('synced state: validation', () => {
  it('accepts the three scopes and any well-formed key, rejects the rest', async () => {
    const s = await store();
    expect(() => s.set('user:user_2abcDEF', 'some.futureKey-1', true, T1)).not.toThrow();
    for (const scope of ['', 'user:', 'budget:0', 'budget:x', 'team', 'user:a b']) {
      expect(() => s.set(scope as 'workspace', 'k', 1, T1), scope).toThrow();
    }
    for (const key of ['', '1abc', 'a b', 'x'.repeat(129)]) {
      expect(() => s.set('workspace', key, 1, T1), key).toThrow();
    }
    expect(() => s.set('workspace', 'k', 1, 'yesterday')).toThrow();
    expect(() => s.merge('workspace', 'k', {}, T1)).toThrow();
    expect(() => s.merge('workspace', 'k', { set: [] as never }, T1)).toThrow();
  });

  it('refuses values over the size cap before sending, never on replay', async () => {
    const s = await store();
    const big = 'x'.repeat(SYNCED_STATE_MAX_VALUE_LENGTH);
    expect(() => s.checkSet('workspace', 'k', big)).toThrow(/too large/);
    expect(() => s.checkSet('workspace', 'k', 'x'.repeat(4000))).not.toThrow();
    s.set('workspace', 'm', { a: 'x'.repeat(SYNCED_STATE_MAX_VALUE_LENGTH - 100) }, T1);
    expect(() => s.checkMerge('workspace', 'm', { set: { b: 'y'.repeat(200) } })).toThrow(
      /too large/
    );
    expect(() => s.checkMerge('workspace', 'm', { remove: ['a'] })).not.toThrow();
  });
});

/** A patch whose `set` has the entry as an own key (as JSON.parse of synced args gives). */
const patchSet = (entry: string, value: unknown) =>
  JSON.parse(`{"set":{${JSON.stringify(entry)}:${JSON.stringify(value)}}}`) as {
    set: Record<string, unknown>;
  };

const read = (s: SyncedStateService) => ({
  value: s.get('workspace', 'routes'),
  text: JSON.stringify(s.get('workspace', 'routes')),
});

describe('synced state: any string is a safe entry key', () => {
  const T4 = '2026-11-12T10:00:03.000Z';
  for (const entry of ['__proto__', 'constructor', 'hasOwnProperty', 'toString', 'prototype']) {
    it(`keeps "${entry}" as a plain entry through set, remove and re-add, in any order`, async () => {
      const ops: Op[] = [
        (s) => s.merge('workspace', 'routes', patchSet(entry, 'first'), T1),
        (s) => s.merge('workspace', 'routes', { remove: [entry] }, T2),
        (s) => s.merge('workspace', 'routes', patchSet(entry, 'again'), T3),
        (s) => s.merge('workspace', 'routes', patchSet('other', 1), T4),
      ];
      const result = (await convergesTo(ops, read)) as { text: string };
      const parsed = JSON.parse(result.text) as Record<string, unknown>;
      expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
      expect(Object.keys(parsed).sort()).toEqual([entry, 'other'].sort());
      expect(Object.getOwnPropertyDescriptor(parsed, entry)?.value).toBe('again');
    }, 60_000); // 24 orders, a fresh database each

    it(`does not see an inherited "${entry}" on an empty value`, async () => {
      const s = await store();
      // Only a remove that has nothing to remove: no own entry, so it's a new tombstone.
      expect(s.merge('workspace', 'routes', { remove: [entry] }, T1)).toBe(true);
      expect(s.get('workspace', 'routes')).toEqual({});
      // An add older than the removal stays removed.
      expect(s.merge('workspace', 'routes', patchSet(entry, 1), '2026-11-12T09:00:00.000Z')).toBe(
        false
      );
      expect(Object.keys(s.get('workspace', 'routes') as object)).toEqual([]);
    });
  }

  it('checks the size of a merge with such keys without touching prototypes', async () => {
    const s = await store();
    expect(() => s.checkMerge('workspace', 'routes', patchSet('__proto__', 'x'))).not.toThrow();
    expect(() =>
      s.checkMerge(
        'workspace',
        'routes',
        patchSet('__proto__', 'x'.repeat(SYNCED_STATE_MAX_VALUE_LENGTH))
      )
    ).toThrow(/too large/);
  });

  it('keeps such keys when a whole-value set lands before a newer merge', async () => {
    const value = await convergesTo(
      [
        (s) => s.set('workspace', 'routes', { a: 1 }, T1),
        (s) => s.merge('workspace', 'routes', patchSet('__proto__', 'p'), T2),
      ],
      read
    );
    expect(JSON.parse((value as { text: string }).text)).toEqual(
      JSON.parse('{"__proto__":"p","a":1}')
    );
  });
});

describe('synced state: tombstones', () => {
  const at = (i: number) => new Date(Date.UTC(2026, 10, 12, 10) + i * 1000).toISOString();
  type Clocks = { entries: Record<string, string>; removed?: string[] };
  const clocksOf = (s: SyncedStateService): Clocks => {
    const row = (s as unknown as { row(scope: string, key: string): { Clocks: string } }).row(
      'workspace',
      'routes'
    );
    return JSON.parse(row.Clocks) as Clocks;
  };

  /** Remembered routes: add one per step, keep the newest `keep`, remove the oldest. */
  function rotation(steps: number, keep: number): { op: Op; i: number }[] {
    const ops: { op: Op; i: number }[] = [];
    for (let i = 0; i < steps; i += 1) {
      const patch: { set: Record<string, unknown>; remove?: string[] } = {
        set: { [`route-${i}`]: i },
      };
      if (i >= keep) patch.remove = [`route-${i - keep}`];
      ops.push({ op: (s) => s.merge('workspace', 'routes', patch, at(i)), i });
    }
    return ops;
  }

  it('keeps at most the cap of removed entries, dropping the oldest', async () => {
    const s = await store();
    const steps = SYNCED_STATE_MAX_TOMBSTONES + 300;
    rotation(steps, 50).forEach(({ op }) => op(s));
    const clocks = clocksOf(s);
    expect(clocks.removed).toHaveLength(SYNCED_STATE_MAX_TOMBSTONES);
    // Live entries plus the newest tombstones, nothing else.
    expect(Object.keys(clocks.entries)).toHaveLength(SYNCED_STATE_MAX_TOMBSTONES + 50);
    const removedIds = clocks.removed!.map((e) => Number(e.slice(6))).sort((a, b) => a - b);
    expect(removedIds[0]).toBe(steps - 50 - SYNCED_STATE_MAX_TOMBSTONES);
    expect(Object.keys(s.get('workspace', 'routes') as object)).toHaveLength(50);
  });

  it('two devices end up with the same value and clocks', async () => {
    const ops = rotation(SYNCED_STATE_MAX_TOMBSTONES + 200, 20);
    const a = await store();
    const b = await store();
    ops.forEach(({ op }) => op(a));
    // B receives in batches of 7, each batch in reverse (offline device catching up).
    for (let i = 0; i < ops.length; i += 7) {
      ops
        .slice(i, i + 7)
        .reverse()
        .forEach(({ op }) => op(b));
    }
    expect(b.get('workspace', 'routes')).toEqual(a.get('workspace', 'routes'));
    expect(clocksOf(b)).toEqual(clocksOf(a));
  });

  it('documents the trade-off: an add older than a dropped tombstone comes back', async () => {
    const s = await store();
    rotation(SYNCED_STATE_MAX_TOMBSTONES + 100, 10).forEach(({ op }) => op(s));
    // route-0's tombstone is long gone; its original add arriving now restores it.
    s.merge('workspace', 'routes', { set: { 'route-0': 0 } }, at(0));
    expect((s.get('workspace', 'routes') as Record<string, unknown>)['route-0']).toBe(0);
  });
});
