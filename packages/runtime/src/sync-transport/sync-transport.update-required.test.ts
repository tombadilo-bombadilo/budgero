/**
 * A synced mutation this build can't apply (newer format, or an op code it
 * doesn't have) must stop sync with "update required" — cursor held, nothing
 * after it applied, never quarantined — and resume once the app is updated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MUTATION_CURSOR_STORAGE_PREFIX } from '../types/storage-keys';
import { MUTATION_FORMAT_VERSION, UnknownOpCodeError } from '../sync-format';
import { SyncTransport } from './sync-transport';
import { createStorageMock } from '../__tests__/storage-mock';

class FakeWebSocket {
  static OPEN = 1;

  static CONNECTING = 0;

  static CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;

  onopen: (() => void) | null = null;

  onclose: (() => void) | null = null;

  onerror: (() => void) | null = null;

  onmessage: ((event: { data: string }) => void) | null = null;

  sent: string[] = [];

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  emitMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  catchUpRequests(): number[] {
    return this.sent
      .map((raw) => JSON.parse(raw) as { type: string; sinceVersion?: number })
      .filter((msg) => msg.type === 'catch_up_request')
      .map((msg) => msg.sinceVersion ?? -1);
  }
}

const CURSOR_KEY = `${MUTATION_CURSOR_STORAGE_PREFIX}space_1`;

/** Op codes an older build knows — a stand-in for its registry. */
const OLD_REGISTRY = new Set(['transactions.add', 'payees.update']);

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function entry(version: number, op: string, v = 2) {
  return { id: `m${version}`, version, v, op, args: { n: version } };
}

describe('SyncTransport — update required', () => {
  const localStorageMock = createStorageMock();

  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorageMock.clear();
  });

  /** A device whose registry is `registry` (undefined = knows every op). */
  function device(registry?: Set<string>) {
    const applied: string[] = [];
    const onRemoteMutation = vi.fn(async (op: string, _args: unknown, id: string) => {
      if (registry && !registry.has(op)) throw new UnknownOpCodeError(op);
      applied.push(id);
    });
    const onCatchUpUnsafe = vi.fn(async () => undefined);
    const onUnknownOpCode = vi.fn();
    const onFormatTooNew = vi.fn();
    const transport = new SyncTransport('space_1', {
      getToken: async () => 'token',
      onConnectionChange: () => undefined,
      encryptPayload: async () => 'encrypted',
      decryptPayload: async () => ({ op: 'unused', args: {} }),
      onRemoteMutation,
      onCatchUpUnsafe,
      onUnknownOpCode,
      onFormatTooNew,
      persistLocalDatabase: async () => true,
      getWebSocketUrl: () => 'ws://example/ws',
      subscribeNetworkStatus: () => () => undefined,
    });
    return { transport, applied, onCatchUpUnsafe, onUnknownOpCode, onFormatTooNew };
  }

  async function open(transport: SyncTransport): Promise<FakeWebSocket> {
    await transport.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.emitOpen();
    await settle();
    return ws;
  }

  it('halts catch-up at an unknown op code instead of quarantining it, then resumes after update', async () => {
    const page = [
      entry(1, 'transactions.add'),
      entry(2, 'payees.restore'),
      entry(3, 'payees.update'),
    ];
    const old = device(OLD_REGISTRY);
    const ws = await open(old.transport);

    ws.emitMessage({ type: 'catch_up_response', mutations: page, hasMore: false });
    await settle();

    expect(old.applied).toEqual(['m1']);
    expect(old.transport.getLocalVersion()).toBe(1);
    expect(old.transport.isUpdateRequired()).toBe(true);
    expect(old.onUnknownOpCode).toHaveBeenCalledTimes(1);
    expect(old.onUnknownOpCode).toHaveBeenCalledWith('space_1', 'payees.restore');
    expect(old.onCatchUpUnsafe).not.toHaveBeenCalled();

    // A second replay (the path that quarantined before) and later live
    // mutations change nothing: no skip, no out-of-order apply, no snapshot.
    ws.emitMessage({ type: 'catch_up_response', mutations: page, hasMore: false });
    ws.emitMessage({
      type: 'mutation_applied',
      mutationId: 'm4',
      version: 4,
      payload: { v: 2, op: 'transactions.add', args: {} },
    });
    ws.emitMessage({ type: 'mutation_ack', mutationId: 'own', version: 5 });
    await settle();

    expect(old.applied).toEqual(['m1']);
    expect(old.transport.getLocalVersion()).toBe(1);
    expect(old.onCatchUpUnsafe).not.toHaveBeenCalled();
    expect(old.onUnknownOpCode).toHaveBeenCalledTimes(1);
    expect(localStorageMock.getItem(CURSOR_KEY)).toBe('1');
    const requestsBeforeUpdate = ws.catchUpRequests();
    expect(requestsBeforeUpdate).toEqual([0]);

    // The app updates (reload = new transport, full registry): catch-up
    // resumes from the stored cursor and applies the held mutation.
    old.transport.destroy();
    const updated = device();
    expect(updated.transport.getLocalVersion()).toBe(1);
    const ws2 = await open(updated.transport);
    expect(ws2.catchUpRequests()).toEqual([1]);
    ws2.emitMessage({ type: 'catch_up_response', mutations: page.slice(1), hasMore: false });
    await settle();

    expect(updated.applied).toEqual(['m2', 'm3']);
    expect(updated.transport.getLocalVersion()).toBe(3);
    expect(updated.transport.isUpdateRequired()).toBe(false);
    expect(updated.onUnknownOpCode).not.toHaveBeenCalled();
    updated.transport.destroy();
  });

  it('halts on a live mutation with an unknown op code and holds the cursor', async () => {
    const old = device(OLD_REGISTRY);
    const ws = await open(old.transport);
    ws.emitMessage({
      type: 'catch_up_response',
      mutations: [entry(1, 'transactions.add')],
      hasMore: false,
    });
    await settle();

    ws.emitMessage({
      type: 'mutation_applied',
      mutationId: 'm2',
      version: 2,
      payload: { v: 3, op: 'history.applyOps', args: { ops: [] } },
    });
    await settle();
    ws.emitMessage({
      type: 'mutation_applied',
      mutationId: 'm3',
      version: 3,
      payload: { v: 2, op: 'transactions.add', args: {} },
    });
    await settle();

    expect(old.applied).toEqual(['m1']);
    expect(old.transport.getLocalVersion()).toBe(1);
    expect(old.onUnknownOpCode).toHaveBeenCalledWith('space_1', 'history.applyOps');
    expect(old.onCatchUpUnsafe).not.toHaveBeenCalled();
    // The gap after the halt must not trigger a catch-up that would skip it.
    expect(ws.catchUpRequests()).toEqual([0]);
    old.transport.destroy();
  });

  it('halts on a payload from a newer format (what a v1.18 device does with v3 ops)', async () => {
    const old = device(OLD_REGISTRY);
    const ws = await open(old.transport);
    const newer = MUTATION_FORMAT_VERSION + 1;

    ws.emitMessage({
      type: 'catch_up_response',
      mutations: [
        entry(1, 'transactions.add'),
        entry(2, 'transactions.add', newer),
        entry(3, 'payees.update'),
      ],
      hasMore: false,
    });
    await settle();
    ws.emitMessage({
      type: 'catch_up_response',
      mutations: [entry(2, 'transactions.add', newer), entry(3, 'payees.update')],
      hasMore: false,
    });
    await settle();

    expect(old.applied).toEqual(['m1']);
    expect(old.transport.getLocalVersion()).toBe(1);
    expect(old.onFormatTooNew).toHaveBeenCalledTimes(1);
    expect(old.onFormatTooNew).toHaveBeenCalledWith('space_1', newer);
    expect(old.onCatchUpUnsafe).not.toHaveBeenCalled();
    old.transport.destroy();
  });

  it('still applies streams of older-format ops (unversioned, v2, v3)', async () => {
    const current = device();
    const ws = await open(current.transport);
    ws.emitMessage({
      type: 'catch_up_response',
      mutations: [
        { id: 'm1', version: 1, op: 'transactions.add', args: { inflow: 1.5 } },
        entry(2, 'payees.update', 2),
        entry(3, 'payees.restore', 3),
      ],
      hasMore: false,
    });
    await settle();

    expect(current.applied).toEqual(['m1', 'm2', 'm3']);
    expect(current.transport.getLocalVersion()).toBe(3);
    expect(current.transport.isUpdateRequired()).toBe(false);
    current.transport.destroy();
  });

  it('stamps each sent mutation with the lowest format that can express it', async () => {
    const encryptPayload = vi.fn(async () => 'encrypted');
    const transport = new SyncTransport('space_1', {
      getToken: async () => 'token',
      onConnectionChange: () => undefined,
      encryptPayload,
      decryptPayload: async () => ({ op: 'unused', args: {} }),
      onRemoteMutation: async () => undefined,
      getWebSocketUrl: () => 'ws://example/ws',
      subscribeNetworkStatus: () => () => undefined,
    });
    await open(transport);

    await transport.send({ id: 'a', op: 'transactions.update', args: {} });
    await transport.send({ id: 'b', op: 'transactions.saveSplits', args: {} });
    await transport.send({
      id: 'c',
      op: 'history.applyOps',
      args: { ops: [{ op: 'transactions.update', args: {} }] },
    });

    const versions = encryptPayload.mock.calls.map(
      (call) => (call as unknown as [{ v: number }])[0].v
    );
    expect(versions).toEqual([2, 3, 3]);
    transport.destroy();
  });
});
