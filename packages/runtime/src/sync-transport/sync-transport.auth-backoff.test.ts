import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SyncTransport,
  SYNC_SESSION_EXPIRED_MESSAGE,
  SYNC_SESSION_REJECTED_MESSAGE,
} from './sync-transport';
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

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emitClose();
  }
}

let visibility: DocumentVisibilityState = 'visible';

function setVisibility(next: DocumentVisibilityState): void {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('SyncTransport auth and visibility handling', () => {
  const localStorageMock = createStorageMock();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal('localStorage', localStorageMock as unknown as Storage);
    FakeWebSocket.instances = [];
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorageMock.clear();
    delete (document as unknown as { visibilityState?: unknown }).visibilityState;
  });

  function createTransport(overrides?: Partial<ConstructorParameters<typeof SyncTransport>[1]>) {
    const deps = {
      getToken: vi.fn(async (): Promise<string | null> => 'token'),
      encryptPayload: async () => 'encrypted',
      decryptPayload: async () => ({ op: 'remote.op', args: {} }),
      onRemoteMutation: vi.fn(async () => undefined),
      onConnectionChange: vi.fn(),
      getWebSocketUrl: (_spaceId: string, token: string | null) =>
        `ws://example/ws?token=${token ?? ''}`,
      subscribeNetworkStatus: () => () => undefined,
      ...overrides,
    };
    const transport = new SyncTransport('space_1', deps);
    const statuses: (string | null)[] = [];
    transport.addSyncStatusListener((s) => statuses.push(s.syncError?.message ?? null));
    return { transport, deps, statuses };
  }

  /** Times (ms since start) at which sockets were created over `totalMs`. */
  async function socketTimes(totalMs: number, onSocket?: (ws: FakeWebSocket) => void) {
    const start = Date.now();
    const times: number[] = [];
    let seen = FakeWebSocket.instances.length;
    for (let t = 0; t < totalMs; t += 100) {
      await vi.advanceTimersByTimeAsync(100);
      while (FakeWebSocket.instances.length > seen) {
        const ws = FakeWebSocket.instances[seen]!;
        seen += 1;
        times.push(Date.now() - start);
        onSocket?.(ws);
      }
    }
    return times;
  }

  it('never opens a socket without a token, and retries for one with backoff', async () => {
    const getToken = vi.fn(async (): Promise<string | null> => null);
    getToken.mockResolvedValueOnce('');
    const { transport, statuses } = createTransport({ getToken });

    await transport.connect();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(FakeWebSocket.instances).toHaveLength(0);
    // Attempts at 0, 2, 6, 14 and 30 s (gaps 2/4/8/16 s): backoff, not a 10 s loop.
    expect(getToken.mock.calls.length).toBe(5);
    expect(statuses).toContain(SYNC_SESSION_EXPIRED_MESSAGE);

    // Session is back: the next scheduled retry opens a socket with it.
    getToken.mockResolvedValue('fresh');
    await vi.advanceTimersByTimeAsync(2_000); // next retry at 62 s
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]!.url).toContain('token=fresh');
    FakeWebSocket.instances[0]!.emitOpen();
    expect(statuses.at(-1)).toBeNull();
    transport.destroy();
  });

  it('treats a throwing token getter like a missing token', async () => {
    const getToken = vi.fn(async (): Promise<string | null> => {
      throw new Error('clerk not loaded');
    });
    const { transport } = createTransport({ getToken });

    await expect(transport.connect()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWebSocket.instances).toHaveLength(0);
    transport.destroy();
  });

  it('retryNow reconnects at once when a fresh token shows up', async () => {
    const getToken = vi.fn(async (): Promise<string | null> => null);
    const { transport } = createTransport({ getToken });
    await transport.connect();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FakeWebSocket.instances).toHaveLength(0);

    getToken.mockResolvedValue('fresh');
    transport.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.instances).toHaveLength(1);

    // Connected/connecting: retryNow is a no-op.
    transport.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.instances).toHaveLength(1);
    transport.destroy();
  });

  it('pauses reconnects while the page is hidden and resumes on visible', async () => {
    const { transport, deps } = createTransport();
    await transport.connect();
    FakeWebSocket.instances[0]!.emitOpen();

    setVisibility('hidden');
    FakeWebSocket.instances[0]!.emitClose();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    const tokenCallsWhileHidden = deps.getToken.mock.calls.length;

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(deps.getToken.mock.calls.length).toBe(tokenCallsWhileHidden + 1);
    FakeWebSocket.instances[1]!.emitOpen();
    expect(transport.isConnected()).toBe(true);
    transport.destroy();
  });

  it('keeps an open socket when the page is hidden', async () => {
    const { transport } = createTransport();
    await transport.connect();
    FakeWebSocket.instances[0]!.emitOpen();
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.isConnected()).toBe(true);
    transport.destroy();
  });

  it('stops a token-less retry loop when the page goes hidden', async () => {
    const getToken = vi.fn(async (): Promise<string | null> => null);
    const { transport } = createTransport({ getToken });
    await transport.connect();
    await vi.advanceTimersByTimeAsync(1_000);
    setVisibility('hidden');
    const calls = getToken.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    // At most the one retry already scheduled before hiding checks visibility.
    expect(getToken.mock.calls.length).toBe(calls);
    expect(FakeWebSocket.instances).toHaveLength(0);
    transport.destroy();
  });

  it('backs off when the handshake is refused while the API is up', async () => {
    const checkApiHealth = vi.fn(async () => true);
    const { transport, statuses } = createTransport({ checkApiHealth });
    await transport.connect();
    FakeWebSocket.instances[0]!.emitClose();

    const times = await socketTimes(70_000, (ws) => ws.emitClose());
    const gaps = times.map((t, i) => (i === 0 ? t : t - times[i - 1]!));
    expect(gaps.map((g) => Math.round(g / 1000))).toEqual([2, 4, 8, 16, 32]);
    expect(statuses).toContain(SYNC_SESSION_REJECTED_MESSAGE);
    expect(checkApiHealth).toHaveBeenCalled();
    transport.destroy();
  });

  it('caps the auth backoff', async () => {
    const { transport } = createTransport({ checkApiHealth: async () => true });
    await transport.connect();
    FakeWebSocket.instances[0]!.emitClose();
    await socketTimes(20 * 60_000, (ws) => ws.emitClose());
    const before = FakeWebSocket.instances.length;
    const times = await socketTimes(11 * 60_000, (ws) => ws.emitClose());
    expect(FakeWebSocket.instances.length - before).toBe(2);
    expect(times[1]! - times[0]!).toBe(5 * 60_000);
    transport.destroy();
  });

  it('keeps the fast reconnect cadence while the server is down', async () => {
    const checkApiHealth = vi.fn(async () => false);
    const { transport, statuses } = createTransport({ checkApiHealth });
    await transport.connect();
    FakeWebSocket.instances[0]!.emitClose();

    const times = await socketTimes(36_000, (ws) => ws.emitClose());
    const gaps = times.map((t, i) => (i === 0 ? t : t - times[i - 1]!));
    expect(gaps.map((g) => Math.round(g / 1000))).toEqual([1, 2, 4, 8, 10, 10]);
    expect(statuses).not.toContain(SYNC_SESSION_REJECTED_MESSAGE);
    transport.destroy();
  });

  it('reconnects a dropped valid-token socket after the usual 1 s', async () => {
    const { transport, deps } = createTransport({ checkApiHealth: async () => true });
    await transport.connect();
    FakeWebSocket.instances[0]!.emitOpen();
    FakeWebSocket.instances[0]!.emitClose();

    await vi.advanceTimersByTimeAsync(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1]!.url).toContain('token=token');
    FakeWebSocket.instances[1]!.emitOpen();
    expect(transport.isConnected()).toBe(true);
    expect(deps.onConnectionChange).toHaveBeenLastCalledWith(true);
    transport.destroy();
  });

  it('a successful connection resets the auth backoff', async () => {
    let refuse = true;
    const { transport } = createTransport({ checkApiHealth: async () => true });
    await transport.connect();
    FakeWebSocket.instances[0]!.emitClose();
    await socketTimes(30_000, (ws) => (refuse ? ws.emitClose() : ws.emitOpen()));
    refuse = false;
    await socketTimes(40_000, (ws) => ws.emitOpen());
    expect(transport.isConnected()).toBe(true);

    const count = FakeWebSocket.instances.length;
    FakeWebSocket.instances.at(-1)!.emitClose();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWebSocket.instances).toHaveLength(count + 1);
    transport.destroy();
  });

  it('removes its visibility listener on destroy', async () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const { transport } = createTransport();
    transport.destroy();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
