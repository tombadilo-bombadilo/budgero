import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectivityMonitor } from './connectivity-monitor';

describe('ConnectivityMonitor', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('probes and computes overall state with token requirement', async () => {
    const monitor = new ConnectivityMonitor({
      getToken: async () => 'token',
      checkApiHealth: async () => true,
    });

    let latest = monitor.getState();
    monitor.addListener((state) => {
      latest = state;
    });

    monitor.setWebSocketProvider(() => true);
    await monitor.probe();

    expect(latest.clerkToken).toBe(true);
    expect(latest.apiReachable).toBe(true);
    expect(latest.wsConnected).toBe(true);
    expect(latest.overall).toBe(true);
  });

  it('uses self-hostable mode without token requirement', async () => {
    const monitor = new ConnectivityMonitor({
      getToken: async () => null,
      checkApiHealth: async () => true,
      isSelfHostable: true,
    });

    monitor.setWebSocketProvider(() => true);
    await monitor.probe();

    const state = monitor.getState();
    expect(state.selfHostable).toBe(true);
    expect(state.clerkToken).toBe(true);
    expect(state.overall).toBe(true);
  });

  it('starts periodic probing and handles stop', async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => undefined);
    const monitor = new ConnectivityMonitor({
      getToken: async () => 't',
      checkApiHealth: async () => true,
    });

    vi.spyOn(monitor, 'probe').mockImplementation(probe);
    monitor.start();
    await vi.runOnlyPendingTimersAsync();
    expect(probe).toHaveBeenCalled();

    monitor.stop();
    const count = probe.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(probe.mock.calls.length).toBe(count);
  });

  it('refresh triggers probe and listener failures are swallowed', () => {
    const monitor = new ConnectivityMonitor({
      getToken: async () => 'token',
      checkApiHealth: async () => false,
    });

    const probeSpy = vi.spyOn(monitor, 'probe').mockResolvedValue(undefined);
    monitor.addListener(() => {
      throw new Error('ignore');
    });

    monitor.refresh();
    expect(probeSpy).toHaveBeenCalled();
  });

  it('handles token failures, refresh probe rejection, and window event handlers', async () => {
    vi.useFakeTimers();
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const monitor = new ConnectivityMonitor({
      getToken: async () => {
        throw new Error('token failed');
      },
      checkApiHealth: async () => true,
      getWebSocketConnected: () => true,
    });

    monitor.start();
    await Promise.resolve();
    await monitor.probe();
    const state = monitor.getState();
    expect(state.clerkToken).toBe(false);
    expect(state.wsConnected).toBe(true);
    expect(state.overall).toBe(false);

    const probeSpy = vi.spyOn(monitor, 'probe').mockRejectedValue(new Error('probe fail'));
    monitor.refresh();
    await Promise.resolve();
    expect(probeSpy).toHaveBeenCalled();

    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('offline'));
    await Promise.resolve();

    monitor.stop();
    monitor.stop();
    expect(addEventListenerSpy).toHaveBeenCalled();
    expect(removeEventListenerSpy).toHaveBeenCalled();
  });

  it('is idempotent when started twice and tolerates listener update failures', async () => {
    vi.useFakeTimers();
    const monitor = new ConnectivityMonitor({
      getToken: async () => 'token',
      checkApiHealth: async () => true,
    });

    const goodListener = vi.fn();
    monitor.addListener(() => {
      throw new Error('listener failed');
    });
    monitor.addListener(goodListener);
    monitor.setWebSocketProvider(() => true);

    monitor.start();
    monitor.start();
    await vi.runOnlyPendingTimersAsync();
    await monitor.probe();

    expect(goodListener).toHaveBeenCalled();
  });
});
