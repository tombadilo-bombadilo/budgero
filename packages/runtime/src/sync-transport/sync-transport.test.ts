import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MUTATION_CURSOR_STORAGE_PREFIX, PASSWORD_CHANGED_REASON_KEY } from '../types/storage-keys';
import { SyncTransport, SnapshotUnavailableError } from './sync-transport';
import { createStorageMock } from '../__tests__/storage-mock';

class FakeWebSocket {
  static OPEN = 1;

  static CONNECTING = 0;

  static CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;

  readonly url: string;

  onopen: (() => void) | null = null;

  onclose: (() => void) | null = null;

  onerror: (() => void) | null = null;

  onmessage: ((event: { data: string }) => void) | null = null;

  sent: string[] = [];

  shouldThrowOnSend = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  emitClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  emitMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  send(data: string): void {
    if (this.shouldThrowOnSend) {
      throw new Error('send failed');
    }
    this.sent.push(data);
  }

  close(): void {
    this.emitClose();
  }
}

describe('SyncTransport', () => {
  const localStorageMock = createStorageMock();

  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorageMock.clear();
  });

  function createTransport(overrides?: Partial<ConstructorParameters<typeof SyncTransport>[1]>) {
    const onRemoteMutation = vi.fn(async () => undefined);
    const onConnectionChange = vi.fn();
    const onCatchUpUnsafe = vi.fn(async () => undefined);
    const deps = {
      getToken: async () => 'token',
      encryptPayload: async () => 'encrypted',
      decryptPayload: async () => ({ op: 'remote.op', args: { a: 1 } }),
      onRemoteMutation,
      onConnectionChange,
      onCatchUpUnsafe,
      getWebSocketUrl: () => 'ws://example/ws',
      subscribeNetworkStatus: () => () => undefined,
      ...overrides,
    };

    return {
      transport: new SyncTransport('space_1', deps),
      deps,
      onRemoteMutation,
      onConnectionChange,
      onCatchUpUnsafe,
    };
  }

  it('connects and sends encrypted mutations', async () => {
    const { transport } = createTransport();

    await transport.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0]!.emitOpen();

    const sent = await transport.send({ id: 'm1', op: 'x', args: { y: 1 } });
    expect(sent).toBe(true);
    expect(transport.isConnected()).toBe(true);

    const mutationPayloadRaw = FakeWebSocket.instances[0]!.sent.map((entry) => {
      try {
        return JSON.parse(entry) as { type?: string };
      } catch {
        return {};
      }
    }).find((entry) => entry.type === 'mutation');
    const payload = (mutationPayloadRaw ?? {}) as {
      type: string;
      id: string;
      encryptedPayload: string;
      baseVersion: number;
    };
    expect(payload.type).toBe('mutation');
    expect(payload.id).toBe('m1');
    expect(payload.encryptedPayload).toBe('encrypted');
    expect(payload.baseVersion).toBe(0);
  });

  it('fails send when disconnected and handles send errors by reconnecting', async () => {
    vi.useFakeTimers();
    const { transport } = createTransport({ getReconnectDelayMs: () => 0 });

    expect(await transport.send({ id: 'm0', op: 'x', args: {} })).toBe(false);

    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();
    ws.shouldThrowOnSend = true;

    await expect(transport.send({ id: 'm1', op: 'x', args: {} })).resolves.toBe(false);

    await vi.runAllTimersAsync();
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);
  });

  it('processes ack, mutation_applied, catch-up, and key-version ack messages', async () => {
    const onSyncStateChanged = vi.fn();
    const { transport, onRemoteMutation } = createTransport({ onSyncStateChanged });
    transport.setLocalVersion(4);
    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    ws.emitMessage({ type: 'mutation_ack', version: 5 });
    expect(transport.getLocalVersion()).toBe(5);

    await (
      transport as unknown as {
        handleMutationApplied(msg: unknown): Promise<void>;
      }
    ).handleMutationApplied({
      type: 'mutation_applied',
      mutationId: 'remote-1',
      version: 6,
      spaceId: 'space_1',
      payload: { encryptedPayload: 'cipher' },
    });
    expect(onRemoteMutation).toHaveBeenCalledWith('remote.op', { a: 1 }, 'remote-1');
    expect(transport.getLocalVersion()).toBe(6);

    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: [{ id: 'c1', version: 7, op: 'x', args: JSON.stringify({ p: 1 }) }],
      hasMore: false,
      latestVersion: 7,
      nextSinceVersion: 7,
    });
    await Promise.resolve();
    expect(onRemoteMutation).toHaveBeenCalledWith('x', { p: 1 }, 'c1');

    ws.emitMessage({ type: 'sync_state_changed', version: 8, spaceId: 'space_1' });
    expect(onSyncStateChanged).toHaveBeenCalledWith('space_1', 8, false);

    // out_of_band marks blobs whose content is not in the mutation log
    // (imports/restores) — receivers must download rather than just record.
    ws.emitMessage({
      type: 'sync_state_changed',
      version: 9,
      spaceId: 'space_1',
      out_of_band: true,
    });
    expect(onSyncStateChanged).toHaveBeenCalledWith('space_1', 9, true);

    const pending = transport.incrementEncryptionKeyVersion();
    ws.emitMessage({ type: 'encryption_key_version_ack', success: true, new_version: 7 });
    await expect(pending).resolves.toBe(7);
  });

  it('notifies onMutationAck with the acked mutation id and survives handler failures', async () => {
    const onMutationAck = vi.fn(async () => undefined);
    const { transport } = createTransport({ onMutationAck });
    transport.setLocalVersion(4);
    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    const flush = () =>
      new Promise((resolve) => {
        setTimeout(resolve, 0);
      });

    // The server's WritePump serializes the acked ID as `mutationId` — this
    // is the shape a real budgero-server sends. (It was once read from
    // `hash`, which the real ack never carried: the queue silently never
    // drained. Guard the actual wire shape.)
    ws.emitMessage({ type: 'mutation_ack', version: 5, mutationId: 'm1' });
    await flush();
    expect(onMutationAck).toHaveBeenCalledWith('m1', 5);

    // `hash` (internal hub field name) is accepted as a fallback.
    ws.emitMessage({ type: 'mutation_ack', version: 5, hash: 'm1-hash' });
    await flush();
    expect(onMutationAck).toHaveBeenCalledWith('m1-hash', 5);

    // A failing ack handler must not break message processing.
    onMutationAck.mockRejectedValueOnce(new Error('ack handler boom'));
    ws.emitMessage({ type: 'mutation_ack', version: 6, hash: 'm2' });
    await flush();
    expect(onMutationAck).toHaveBeenCalledWith('m2', 6);
    expect(transport.getLocalVersion()).toBe(6);

    // No id at all — cursor still advances, no ack callback.
    onMutationAck.mockClear();
    ws.emitMessage({ type: 'mutation_ack', version: 7 });
    await flush();
    expect(onMutationAck).not.toHaveBeenCalled();
    expect(transport.getLocalVersion()).toBe(7);
  });

  it('never advances the cursor past an empty mutation_applied payload — requests catch-up instead', async () => {
    const { transport, onRemoteMutation } = createTransport();
    transport.setLocalVersion(4);
    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();
    // Settle the connect-time catch-up so the gap/payload guards below are
    // the ones issuing requests (a request mid-catch-up would be redundant).
    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: [],
      hasMore: false,
      latestVersion: 4,
      nextSinceVersion: 4,
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    ws.sent = []; // ignore the initial catch-up request from connect

    const invoke = (msg: unknown) =>
      (
        transport as unknown as {
          handleMutationApplied(msg: unknown): Promise<void>;
        }
      ).handleMutationApplied(msg);

    // Version gap (4 → 9): a broadcast was missed — must NOT apply, must
    // NOT advance; pulls the range via catch-up instead.
    await invoke({
      type: 'mutation_applied',
      mutationId: 'remote-9',
      version: 9,
      spaceId: 'space_1',
    });
    // A second out-of-order broadcast while that catch-up is in flight is
    // ignored (the pending catch-up covers it) — no duplicate request.
    await invoke({
      type: 'mutation_applied',
      mutationId: 'remote-10',
      version: 10,
      spaceId: 'space_1',
      payload: {},
    });

    expect(onRemoteMutation).not.toHaveBeenCalled();
    expect(transport.getLocalVersion()).toBe(4);

    const catchUps = ws.sent
      .map((entry) => JSON.parse(entry) as { type?: string; sinceVersion?: number })
      .filter((entry) => entry.type === 'catch_up_request');
    expect(catchUps.length).toBe(1);
    expect(catchUps[0]?.sinceVersion).toBe(4);
  });

  it('dequeues on a gapped mutation_ack but does not advance the cursor past the gap', async () => {
    const onMutationAck = vi.fn(async () => undefined);
    const { transport } = createTransport({ onMutationAck });
    transport.setLocalVersion(4);
    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();
    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: [],
      hasMore: false,
      latestVersion: 4,
      nextSinceVersion: 4,
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    ws.sent = [];

    // Our mutation landed at version 9 — versions 5..8 were broadcasts we
    // never received. The ack must release the queue entry but NOT advance
    // the cursor (that would skip 5..8 forever); the gap is pulled via
    // catch-up, which redelivers our own mutation as a dedupable echo.
    ws.emitMessage({ type: 'mutation_ack', version: 9, mutationId: 'mine' });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(onMutationAck).toHaveBeenCalledWith('mine', 9);
    expect(transport.getLocalVersion()).toBe(4);
    const catchUps = ws.sent
      .map((entry) => JSON.parse(entry) as { type?: string; sinceVersion?: number })
      .filter((entry) => entry.type === 'catch_up_request');
    expect(catchUps.length).toBe(1);
    expect(catchUps[0]?.sinceVersion).toBe(4);
  });

  it('buffers mutation_ack in buffer mode so it cannot overtake a buffered catch-up page', async () => {
    const onMutationAck = vi.fn(async () => undefined);
    const { transport, onRemoteMutation } = createTransport({ onMutationAck });
    transport.setLocalVersion(4);
    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    transport.setBufferMode(true);
    // Catch-up page 5..6 arrives first, then the ack for our own mutation
    // at 7. Without buffering the ack would advance (and persist) the
    // cursor to 7 while the DB still lacks 5..6.
    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: [
        { id: 'c5', version: 5, op: 'x', args: JSON.stringify({}) },
        { id: 'c6', version: 6, op: 'x', args: JSON.stringify({}) },
      ],
      hasMore: false,
      latestVersion: 6,
      nextSinceVersion: 6,
    });
    ws.emitMessage({ type: 'mutation_ack', version: 7, mutationId: 'mine' });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    // Nothing processed while buffering.
    expect(transport.getLocalVersion()).toBe(4);
    expect(onMutationAck).not.toHaveBeenCalled();

    await transport.flushBuffer();

    // Page applied first (cursor 6), then the ack lands contiguously (7).
    expect(onRemoteMutation).toHaveBeenCalledTimes(2);
    expect(onMutationAck).toHaveBeenCalledWith('mine', 7);
    expect(transport.getLocalVersion()).toBe(7);
  });

  it('own-mutation ack mid-catch-up does not trip the regression guards', async () => {
    const { transport, onRemoteMutation } = createTransport();
    transport.setLocalVersion(100);
    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen(); // requests catch-up since=100

    // Our own queued mutation is appended at 131 and acked BEFORE the
    // catch-up page (101..130, computed pre-append with latestVersion=130)
    // arrives. Contiguity keeps the cursor at 100, and the page's metadata
    // is judged against the page's own progression — this exact sequence
    // used to fire handleCatchUpUnsafe('latest_version_regressed') and
    // force a full snapshot restore on an ordinary reconnect.
    ws.emitMessage({ type: 'mutation_ack', version: 131, mutationId: 'mine' });
    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: Array.from({ length: 30 }, (_, i) => ({
        id: `c${101 + i}`,
        version: 101 + i,
        op: 'x',
        args: JSON.stringify({}),
      })),
      hasMore: false,
      latestVersion: 130,
      nextSinceVersion: 130,
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(onRemoteMutation).toHaveBeenCalledTimes(30);
    expect(transport.getLocalVersion()).toBe(130);
    expect(transport.hasInitialCatchUpSettled()).toBe(true);
  });

  it('never applies a contiguous mutation_applied whose payload is empty — requests catch-up', async () => {
    const { transport, onRemoteMutation } = createTransport();
    transport.setLocalVersion(4);
    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();
    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: [],
      hasMore: false,
      latestVersion: 4,
      nextSinceVersion: 4,
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    ws.sent = [];

    // Contiguous version (5) but the server's best-effort re-query lost the
    // payload — the cursor must not advance past a mutation we can't decode.
    await (
      transport as unknown as {
        handleMutationApplied(msg: unknown): Promise<void>;
      }
    ).handleMutationApplied({
      type: 'mutation_applied',
      mutationId: 'remote-5',
      version: 5,
      spaceId: 'space_1',
      payload: {},
    });

    expect(onRemoteMutation).not.toHaveBeenCalled();
    expect(transport.getLocalVersion()).toBe(4);
    const catchUps = ws.sent
      .map((entry) => JSON.parse(entry) as { type?: string; sinceVersion?: number })
      .filter((entry) => entry.type === 'catch_up_request');
    expect(catchUps.length).toBe(1);
    expect(catchUps[0]?.sinceVersion).toBe(4);
  });

  it('requests catch-up on connect when local version exists and advances version from replay', async () => {
    const onSyncStateChanged = vi.fn();
    const { transport, onRemoteMutation } = createTransport({ onSyncStateChanged });
    transport.setLocalVersion(12);

    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    const catchUpRequest = JSON.parse(ws.sent[0] ?? '{}') as {
      type?: string;
      sinceVersion?: number;
    };
    expect(catchUpRequest.type).toBe('catch_up_request');
    expect(catchUpRequest.sinceVersion).toBe(12);

    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: [{ id: 'c2', version: 13, op: 'x', args: { p: 2 } }],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onRemoteMutation).toHaveBeenCalledWith('x', { p: 2 }, 'c2');
    expect(transport.getLocalVersion()).toBe(13);
    expect(localStorageMock.getItem(`${MUTATION_CURSOR_STORAGE_PREFIX}space_1`)).toBe('13');
  });

  it('requests paged catch-up until metadata reports completion', async () => {
    const { transport, onRemoteMutation } = createTransport();
    transport.setLocalVersion(10);

    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    const firstRequest = JSON.parse(ws.sent[0] ?? '{}') as { sinceVersion?: number };
    expect(firstRequest.sinceVersion).toBe(10);

    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: [{ id: 'c11', version: 11, op: 'x', args: { p: 11 } }],
      hasMore: true,
      latestVersion: 12,
      nextSinceVersion: 11,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const secondRequest = JSON.parse(ws.sent[1] ?? '{}') as { sinceVersion?: number };
    expect(secondRequest.sinceVersion).toBe(11);

    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: [{ id: 'c12', version: 12, op: 'x', args: { p: 12 } }],
      hasMore: false,
      latestVersion: 12,
      nextSinceVersion: 12,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onRemoteMutation).toHaveBeenCalledWith('x', { p: 11 }, 'c11');
    expect(onRemoteMutation).toHaveBeenCalledWith('x', { p: 12 }, 'c12');
    expect(transport.getLocalVersion()).toBe(12);
  });

  it('continues legacy catch-up paging until an empty page is returned', async () => {
    const { transport } = createTransport();
    transport.setLocalVersion(20);

    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: [{ id: 'c21', version: 21, op: 'x', args: { p: 21 } }],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const secondRequest = JSON.parse(ws.sent[1] ?? '{}') as { sinceVersion?: number };
    expect(secondRequest.sinceVersion).toBe(21);

    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transport.getLocalVersion()).toBe(21);
    expect(ws.sent.length).toBe(2);
  });

  it('requests catch-up when in sync and completes with zero mutations', async () => {
    const { transport, onRemoteMutation } = createTransport();
    transport.setLocalVersion(30);

    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: [],
      hasMore: false,
      latestVersion: 30,
      nextSinceVersion: 30,
    });
    await Promise.resolve();

    expect(onRemoteMutation).not.toHaveBeenCalled();
    expect(transport.getLocalVersion()).toBe(30);
  });

  it('fails closed to snapshot recovery on non-monotonic catch-up versions', async () => {
    const { transport, onCatchUpUnsafe } = createTransport();
    transport.setLocalVersion(5);

    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: [
        { id: 'c6', version: 6, op: 'x', args: { p: 6 } },
        { id: 'c6-dup', version: 6, op: 'x', args: { p: 7 } },
      ],
      hasMore: false,
      latestVersion: 6,
      nextSinceVersion: 6,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onCatchUpUnsafe).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'non_monotonic_version',
        sinceVersion: 5,
        localVersion: 6,
        spaceId: 'space_1',
      })
    );
  });

  it('falls back to snapshot recovery when the catch-up log has a gap', async () => {
    const { transport, onRemoteMutation, onCatchUpUnsafe } = createTransport();
    transport.setLocalVersion(5);

    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    // Log was pruned/compacted: first surviving mutation is past our cursor,
    // so replay must not be attempted at all.
    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: [{ id: 'c300', version: 300, op: 'x', args: { p: 1 } }],
      hasMore: false,
      latestVersion: 300,
      nextSinceVersion: 300,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onRemoteMutation).not.toHaveBeenCalled();
    expect(onCatchUpUnsafe).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'mutation_log_gap',
        sinceVersion: 5,
        spaceId: 'space_1',
      })
    );
  });

  it('disables sync for the session when recovery has no snapshot to restore', async () => {
    vi.useFakeTimers();
    const { transport } = createTransport({
      onCatchUpUnsafe: async () => {
        throw new SnapshotUnavailableError();
      },
      getReconnectDelayMs: () => 0,
    });

    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: [{ id: 'c300', version: 300, op: 'x', args: { p: 1 } }],
      hasMore: false,
      latestVersion: 300,
      nextSinceVersion: 300,
    });
    await vi.runAllTimersAsync();

    // No reconnect loop: the socket stays down and connect() becomes a no-op.
    const instanceCount = FakeWebSocket.instances.length;
    expect(transport.isConnected()).toBe(false);
    await transport.connect();
    expect(FakeWebSocket.instances.length).toBe(instanceCount);
    await expect(transport.waitForInitialCatchUp()).resolves.toEqual({
      completed: false,
      timedOut: false,
    });
  });

  it('fails closed to snapshot recovery when applying catch-up mutation fails', async () => {
    const { transport, onRemoteMutation, onCatchUpUnsafe } = createTransport();
    transport.setLocalVersion(8);
    onRemoteMutation.mockRejectedValueOnce(new Error('apply failed'));

    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: [{ id: 'c9', version: 9, op: 'x', args: { p: 9 } }],
      hasMore: false,
      latestVersion: 9,
      nextSinceVersion: 9,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onCatchUpUnsafe).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'apply_failed',
        sinceVersion: 8,
        spaceId: 'space_1',
      })
    );
  });

  it('fails closed to snapshot recovery on catch-up metadata regression', async () => {
    const { transport, onCatchUpUnsafe } = createTransport();
    transport.setLocalVersion(10);

    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: [{ id: 'c11', version: 11, op: 'x', args: { p: 11 } }],
      hasMore: true,
      latestVersion: 12,
      nextSinceVersion: 10,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onCatchUpUnsafe).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'next_since_regressed',
        sinceVersion: 10,
        localVersion: 11,
      })
    );
  });

  it('treats null catch-up mutations payload as an empty page for compatibility', async () => {
    const { transport, onRemoteMutation, onCatchUpUnsafe } = createTransport();
    transport.setLocalVersion(3);

    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: null,
      hasMore: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onRemoteMutation).not.toHaveBeenCalled();
    expect(onCatchUpUnsafe).not.toHaveBeenCalled();
    expect(transport.getLocalVersion()).toBe(3);
  });

  it('fails closed to snapshot recovery on malformed catch-up payload', async () => {
    const { transport, onCatchUpUnsafe } = createTransport();
    transport.setLocalVersion(3);

    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: { bad: true },
      hasMore: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onCatchUpUnsafe).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'malformed_payload',
        sinceVersion: 3,
      })
    );
  });

  it('handles failed key-version ack and pending callbacks on destroy', async () => {
    const { transport } = createTransport();
    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    const pending = transport.incrementEncryptionKeyVersion();
    ws.emitMessage({ type: 'encryption_key_version_ack', success: false, error: 'bad' });
    await expect(pending).rejects.toThrow('bad');

    const pending2 = transport.incrementEncryptionKeyVersion();
    transport.destroy();
    await expect(pending2).rejects.toThrow('SyncTransport destroyed');
  });

  it('buffers mutation_applied messages and flushes later', async () => {
    const { transport, onRemoteMutation } = createTransport();
    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    transport.setBufferMode(true);
    ws.emitMessage({
      type: 'mutation_applied',
      mutationId: 'remote-1',
      payload: { op: 'direct', args: { a: 1 } },
      spaceId: 'space_1',
    });
    await Promise.resolve();

    expect(onRemoteMutation).not.toHaveBeenCalled();

    await transport.flushBuffer();
    expect(onRemoteMutation).toHaveBeenCalledWith('direct', { a: 1 }, 'remote-1');
  });

  it('ignores mismatched space and malformed payload branches', async () => {
    const { transport, onRemoteMutation, onCatchUpUnsafe } = createTransport();
    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    ws.emitMessage({ type: 'mutation_applied', mutationId: 'x', spaceId: 'other' });
    ws.emitMessage({ type: 'mutation_applied', mutationId: 'x', payload: { args: '{bad' } });
    ws.emitMessage({ type: 'catch_up_response', mutations: [{ id: 'x', args: '{bad' }] });
    ws.emitMessage({ type: 'not_json' });

    await Promise.resolve();
    expect(onRemoteMutation).not.toHaveBeenCalled();
    expect(onCatchUpUnsafe).toHaveBeenCalled();
  });

  it('master_password_changed flags the reason and reloads (user-scoped signal)', async () => {
    const setPasswordChangedReason = vi.fn();
    const reloadApp = vi.fn();
    const { transport } = createTransport({ setPasswordChangedReason, reloadApp });
    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    ws.emitMessage({ type: 'master_password_changed', spaceId: 'space_1' });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(setPasswordChangedReason).toHaveBeenCalled();
    expect(reloadApp).toHaveBeenCalled();
  });

  it('notifyMasterPasswordChanged sends the user-scoped signal when connected', async () => {
    const { transport } = createTransport();
    // Not connected: silent no-op.
    transport.notifyMasterPasswordChanged();

    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();
    ws.sent = [];

    transport.notifyMasterPasswordChanged();
    const sent = ws.sent.map((entry) => JSON.parse(entry) as { type?: string; spaceId?: string });
    expect(sent).toEqual([{ type: 'master_password_changed', spaceId: 'space_1' }]);
  });

  it('handles encryption key changed with callbacks and fallback localStorage reason', async () => {
    const onEncryptionKeyChanged = vi.fn();
    const setPasswordChangedReason = vi.fn();
    const reloadApp = vi.fn();
    const { transport } = createTransport({ onEncryptionKeyChanged });

    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    ws.emitMessage({ type: 'encryption_key_changed', version: 9, spaceId: 'space_1' });
    expect(onEncryptionKeyChanged).toHaveBeenCalledWith('space_1', 9);

    const second = createTransport({ setPasswordChangedReason, reloadApp }).transport;
    await second.connect();
    const ws2 = FakeWebSocket.instances[1]!;
    ws2.emitOpen();
    ws2.emitMessage({ type: 'encryption_key_changed', version: 3, spaceId: 'space_1' });

    expect(setPasswordChangedReason).toHaveBeenCalled();
    expect(reloadApp).toHaveBeenCalled();

    const reloadAppFallback = vi.fn();
    const third = createTransport({ reloadApp: reloadAppFallback }).transport;
    await third.connect();
    const ws3 = FakeWebSocket.instances[2]!;
    ws3.emitOpen();
    ws3.emitMessage({ type: 'encryption_key_changed', version: 2, spaceId: 'space_1' });
    expect(localStorageMock.getItem(PASSWORD_CHANGED_REASON_KEY)).toBe('true');
    expect(reloadAppFallback).toHaveBeenCalled();
  });

  it('supports listeners, sync status updates, suspend, and destroy cleanup', async () => {
    const unsubscribe = vi.fn();
    const onConnection = vi.fn();
    const onSync = vi.fn();
    const { transport } = createTransport({
      subscribeNetworkStatus: () => unsubscribe,
      getReconnectDelayMs: () => 0,
    });

    const offConn = transport.onConnectionChange(onConnection);
    const offSync = transport.addSyncStatusListener(onSync);

    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    transport.updateSyncStatus({ isSyncing: true, syncError: 'x' });
    expect(onSync).toHaveBeenCalled();

    offConn();
    offSync();

    transport.suspend();
    expect(transport.isConnected()).toBe(false);

    transport.destroy();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('waits for initial catch-up completion before resolving', async () => {
    const { transport } = createTransport();
    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    const waitPromise = transport.waitForInitialCatchUp({ timeoutMs: 1_000 });

    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: [],
      hasMore: false,
      latestVersion: 0,
      nextSinceVersion: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(waitPromise).resolves.toEqual({ completed: true, timedOut: false });
  });

  it('times out waiting for initial catch-up when no catch-up response arrives', async () => {
    vi.useFakeTimers();
    const { transport } = createTransport();
    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    const waitPromise = transport.waitForInitialCatchUp({ timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(30);

    await expect(waitPromise).resolves.toEqual({ completed: false, timedOut: true });
  });

  it('loads persisted mutation cursor from localStorage', async () => {
    localStorageMock.setItem(`${MUTATION_CURSOR_STORAGE_PREFIX}space_1`, '9');
    const { transport } = createTransport();
    expect(transport.getLocalVersion()).toBe(9);
  });

  it('keeps cursor durable version unchanged when local persistence reports failure', async () => {
    const persistLocalDatabase = vi.fn(async () => false);
    const { transport } = createTransport({ persistLocalDatabase });
    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    // Contiguous ack (0 → 1); a gapped version would (correctly) be ignored.
    ws.emitMessage({ type: 'mutation_ack', version: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transport.getLocalVersion()).toBe(1);
    expect(persistLocalDatabase).toHaveBeenCalledTimes(1);
    expect(localStorageMock.getItem(`${MUTATION_CURSOR_STORAGE_PREFIX}space_1`)).toBe(null);
  });

  it('keeps cursor durable version unchanged when local persistence throws', async () => {
    const persistLocalDatabase = vi.fn(async () => {
      throw new Error('disk failed');
    });
    const { transport } = createTransport({ persistLocalDatabase });
    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    ws.emitMessage({ type: 'mutation_ack', version: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transport.getLocalVersion()).toBe(1);
    expect(persistLocalDatabase).toHaveBeenCalledTimes(1);
    expect(localStorageMock.getItem(`${MUTATION_CURSOR_STORAGE_PREFIX}space_1`)).toBe(null);
  });

  it('persists local mutation state even when mutation_applied has no version', async () => {
    const persistLocalDatabase = vi.fn(async () => true);
    const { transport } = createTransport({ persistLocalDatabase });
    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();
    ws.emitMessage({
      type: 'catch_up_response',
      spaceId: 'space_1',
      mutations: [],
      hasMore: false,
      latestVersion: 0,
      nextSinceVersion: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    ws.emitMessage({
      type: 'mutation_applied',
      mutationId: 'remote-42',
      payload: { op: 'x', args: { p: 1 } },
      spaceId: 'space_1',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(persistLocalDatabase).toHaveBeenCalled();
  });

  it('supports overlay listeners and fallback window online/offline handlers', async () => {
    vi.useFakeTimers();
    const onOverlay = vi.fn();
    const { transport } = createTransport({
      subscribeNetworkStatus: undefined,
      getReconnectDelayMs: () => 0,
    });
    const offOverlay = transport.addOverlayListener(onOverlay);

    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();
    expect(transport.isConnected()).toBe(true);

    transport.emitOverlay('syncing');
    expect(onOverlay).toHaveBeenCalledWith('syncing');
    offOverlay();

    window.dispatchEvent(new Event('offline'));
    expect(transport.isConnected()).toBe(false);

    window.dispatchEvent(new Event('online'));
    await vi.runAllTimersAsync();
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);

    transport.destroy();
  });

  it('handles ws error callback, raw invalid json, and connect idempotency', async () => {
    const { transport } = createTransport();
    await transport.connect();
    await transport.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);

    const ws = FakeWebSocket.instances[0]!;
    ws.onerror?.();
    ws.emitOpen();

    await expect(
      (transport as unknown as { handleRawMessage(raw: string): Promise<void> }).handleRawMessage(
        'not-json'
      )
    ).resolves.toBeUndefined();
  });

  it('covers exceptional branches for listeners, reconnect scheduling, and fallback handlers', async () => {
    vi.useFakeTimers();
    const { transport } = createTransport({
      subscribeNetworkStatus: undefined,
      getReconnectDelayMs: () => -1,
      log: undefined,
    });

    // Listener wrappers should swallow listener failures.
    transport.onConnectionChange(() => {
      throw new Error('listener-fail');
    });
    transport.addSyncStatusListener(() => {
      throw new Error('sync-listener-fail');
    });
    transport.addOverlayListener(() => {
      throw new Error('overlay-listener-fail');
    });
    transport.emitOverlay('success');
    transport.updateSyncStatus({ isSyncing: true });

    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    // Offline handler catches close failures.
    ws.close = () => {
      throw new Error('close failed');
    };
    window.dispatchEvent(new Event('offline'));

    // Force connect rejection branch inside scheduled reconnect callback.
    (
      transport as unknown as {
        connect: () => Promise<void>;
        scheduleReconnect: () => void;
      }
    ).connect = vi.fn(async () => {
      throw new Error('reconnect failed');
    });
    (
      transport as unknown as {
        scheduleReconnect: () => void;
      }
    ).scheduleReconnect();
    await vi.runAllTimersAsync();

    // Force increment callback catch path and callback cleanup.
    const ws2 = new FakeWebSocket('ws://example/ws');
    ws2.readyState = FakeWebSocket.OPEN;
    ws2.send = () => {
      throw new Error('increment send fail');
    };
    (transport as unknown as { ws: FakeWebSocket | null }).ws = ws2;
    await expect(transport.incrementEncryptionKeyVersion()).rejects.toThrow('increment send fail');

    // Flush buffer catch path.
    (
      transport as unknown as {
        messageBuffer: { type: string }[];
        processMessage: () => Promise<void>;
      }
    ).messageBuffer = [{ type: 'mutation_applied' }];
    (
      transport as unknown as {
        processMessage: () => Promise<void>;
      }
    ).processMessage = vi.fn(async () => {
      throw new Error('process fail');
    });
    await transport.flushBuffer();

    // handleRawMessage called via ws.onmessage should swallow rejections.
    (
      transport as unknown as {
        handleRawMessage: () => Promise<void>;
      }
    ).handleRawMessage = vi.fn(async () => {
      throw new Error('raw fail');
    });
    ws2.onmessage?.({ data: '{}' });

    // networkUnsubscribe failure is swallowed in destroy.
    (transport as unknown as { networkUnsubscribe: (() => void) | null }).networkUnsubscribe =
      () => {
        throw new Error('unsubscribe failed');
      };
    transport.destroy();
  });

  it('uses default browser websocket url when provider missing', async () => {
    const { transport } = createTransport({ getWebSocketUrl: undefined });

    await transport.connect();
    expect(FakeWebSocket.instances[0]!.url).toContain('/api/v1/ws/sync');
    expect(FakeWebSocket.instances[0]!.url).toContain('space_id=space_1');
  });

  it('throws when default websocket url is requested without browser window', () => {
    const { transport } = createTransport();
    vi.stubGlobal('window', undefined as unknown as Window);

    expect(() =>
      (
        transport as unknown as {
          createDefaultWebSocketUrl(token: string | null): string;
        }
      ).createDefaultWebSocketUrl('token')
    ).toThrow('No WebSocket URL provider available in non-browser environment');
  });

  it('covers private message and key-change branches', async () => {
    const { transport, onRemoteMutation } = createTransport({
      onEncryptionKeyChanged: undefined,
      setPasswordChangedReason: undefined,
      reloadApp: vi.fn(),
      log: undefined,
    });
    await transport.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    await (
      transport as unknown as {
        processMessage: (msg: unknown) => Promise<void>;
      }
    ).processMessage({ type: 'sync_state_changed' });

    await (
      transport as unknown as {
        handleMutationApplied: (msg: unknown) => Promise<void>;
      }
    ).handleMutationApplied({ type: 'mutation_applied' });

    onRemoteMutation.mockRejectedValueOnce('remote-fail');
    await (
      transport as unknown as {
        handleMutationApplied: (msg: unknown) => Promise<void>;
      }
    ).handleMutationApplied({
      type: 'mutation_applied',
      mutationId: 'm-x',
      payload: { op: 'x', args: { y: 1 } },
    });

    await (
      transport as unknown as {
        handleCatchUp: (msg: unknown) => Promise<void>;
      }
    ).handleCatchUp({ type: 'catch_up_response', mutations: null });

    await (
      transport as unknown as {
        handleCatchUp: (msg: unknown) => Promise<void>;
      }
    ).handleCatchUp({
      type: 'catch_up_response',
      mutations: [{ id: undefined, version: 1, encryptedPayload: 'cipher' }],
      hasMore: false,
    });

    onRemoteMutation.mockRejectedValueOnce('catch-up-fail');
    await (
      transport as unknown as {
        handleCatchUp: (msg: unknown) => Promise<void>;
      }
    ).handleCatchUp({
      type: 'catch_up_response',
      mutations: [{ id: 'c2', version: 2, op: 'z', args: { p: 2 } }],
      hasMore: false,
    });

    const localSet = vi.spyOn(localStorageMock, 'setItem').mockImplementation(() => {
      throw new Error('storage fail');
    });
    (
      transport as unknown as {
        handleEncryptionKeyChanged: (msg: unknown) => void;
      }
    ).handleEncryptionKeyChanged({ type: 'encryption_key_changed', version: 'bad' });
    expect(localSet).toHaveBeenCalledWith(PASSWORD_CHANGED_REASON_KEY, 'true');

    (
      transport as unknown as {
        keyVersionCallbacks: { resolve(v: number): void; reject(e: Error): void }[];
        handleKeyVersionAck: (msg: unknown) => void;
      }
    ).keyVersionCallbacks.push({
      resolve: vi.fn(),
      reject: vi.fn(),
    });
    (
      transport as unknown as {
        handleKeyVersionAck: (msg: unknown) => void;
      }
    ).handleKeyVersionAck({ type: 'encryption_key_version_ack', success: false });
  });

  it('covers reconnect/suspend and default URL protocol branches', async () => {
    vi.useFakeTimers();
    const { transport } = createTransport({
      getReconnectDelayMs: () => 0,
    });

    // connect() catch branch when constructor throws
    vi.stubGlobal(
      'WebSocket',
      class {
        static OPEN = 1;

        static CONNECTING = 0;

        constructor(_url: string) {
          throw new Error('construct fail');
        }
      } as unknown as typeof WebSocket
    );
    await transport.connect();
    await vi.runOnlyPendingTimersAsync();

    // restore working websocket and open it
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    await transport.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.emitOpen();

    // send catch with non-Error + close failure branch
    ws.close = () => {
      throw new Error('close failed');
    };
    (
      transport as unknown as {
        deps: { encryptPayload(payload: unknown): Promise<string> };
      }
    ).deps.encryptPayload = async () => {
      throw 'encrypt fail';
    };
    await expect(transport.send({ id: 's1', op: 'x', args: {} })).resolves.toBe(false);

    // increment second-guard branch and non-Error reject branch
    let readyReads = 0;
    (transport as unknown as { ws: unknown }).ws = {
      send: () => {
        throw 'send fail';
      },
      get readyState() {
        readyReads += 1;
        return readyReads === 1 ? FakeWebSocket.OPEN : FakeWebSocket.CONNECTING;
      },
    };
    await expect(transport.incrementEncryptionKeyVersion()).rejects.toThrow(
      'WebSocket not connected'
    );

    // suspend close failure branch
    (transport as unknown as { ws: { close(): void } | null }).ws = {
      close: () => {
        throw new Error('suspend close fail');
      },
    };
    expect(() => transport.suspend()).not.toThrow();

    // createDefaultWebSocketUrl protocol/token branches
    vi.stubGlobal('window', {
      location: {
        protocol: 'http:',
        host: 'example.test',
        reload: vi.fn(),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as Window);
    const url = (
      transport as unknown as {
        createDefaultWebSocketUrl(token: string | null): string;
      }
    ).createDefaultWebSocketUrl(null);
    expect(url).toContain('ws://example.test');
    expect(url).toContain('token=');

    (
      transport as unknown as {
        handleEncryptionKeyChanged: (msg: unknown) => void;
      }
    ).handleEncryptionKeyChanged({ type: 'encryption_key_changed', version: 3 });
    expect(
      (
        window as unknown as {
          location: { reload: ReturnType<typeof vi.fn> };
        }
      ).location.reload
    ).toHaveBeenCalled();
  });
});
