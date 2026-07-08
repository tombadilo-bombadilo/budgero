import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActivityHeartbeat } from './ActivityHeartbeat';

const recordActivityHeartbeat = vi.fn(() => Promise.resolve());
const useProfile = vi.fn(() => ({
  data: { id: 'user_heartbeat' },
}));

vi.mock('@entities/user/api/useAuth', () => ({
  useProfile: () => useProfile(),
}));

vi.mock('@shared/api/api-client', () => ({
  authApi: {
    recordActivityHeartbeat: () => recordActivityHeartbeat(),
  },
}));

class MockBroadcastChannel {
  static channels = new Map<string, Set<MockBroadcastChannel>>();

  name: string;

  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    const set = MockBroadcastChannel.channels.get(name) ?? new Set<MockBroadcastChannel>();
    set.add(this);
    MockBroadcastChannel.channels.set(name, set);
  }

  postMessage(data: unknown) {
    const set = MockBroadcastChannel.channels.get(this.name);
    if (!set) return;
    for (const channel of set) {
      if (channel === this) continue;
      channel.onmessage?.({ data } as MessageEvent);
    }
  }

  close() {
    MockBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}

function createStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

function installStorageMock() {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: createStorageMock(),
  });
}

function setVisibilityState(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  });
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

describe('ActivityHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
    installStorageMock();
    setVisibilityState('visible');
    setOnline(true);
    window.localStorage.clear();
    recordActivityHeartbeat.mockClear();
    useProfile.mockReturnValue({
      data: { id: 'user_heartbeat' },
    });
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    MockBroadcastChannel.channels.clear();
  });

  it('sends an immediate heartbeat and repeats every 60 seconds when eligible', async () => {
    render(<ActivityHeartbeat />);

    await vi.advanceTimersByTimeAsync(1);
    expect(recordActivityHeartbeat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(recordActivityHeartbeat).toHaveBeenCalledTimes(2);
  });

  it('does not send while the document is hidden or offline', async () => {
    setVisibilityState('hidden');
    setOnline(false);

    render(<ActivityHeartbeat />);

    await vi.advanceTimersByTimeAsync(1);
    expect(recordActivityHeartbeat).not.toHaveBeenCalled();
  });

  it('sends immediately when the page becomes visible again', async () => {
    setVisibilityState('hidden');

    render(<ActivityHeartbeat />);

    await vi.advanceTimersByTimeAsync(1);
    expect(recordActivityHeartbeat).not.toHaveBeenCalled();

    setVisibilityState('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    await vi.advanceTimersByTimeAsync(1);
    expect(recordActivityHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('elects a single leader across multiple mounted tabs', async () => {
    render(
      <>
        <ActivityHeartbeat />
        <ActivityHeartbeat />
      </>
    );

    await vi.advanceTimersByTimeAsync(1);
    expect(recordActivityHeartbeat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(recordActivityHeartbeat).toHaveBeenCalledTimes(2);
  });
});
