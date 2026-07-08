/**
 * ConnectivityMonitor — tracks API health and token availability.
 *
 * Refactored from ConnectivityService with injectable deps.
 * WS state is NOT tracked here — it's per-space in SyncTransport.
 */

import type { ConnectivityState, ConnectivityMonitorDeps } from '../types';

export type ConnectivityListener = (state: ConnectivityState) => void;

export class ConnectivityMonitor {
  private state: ConnectivityState = {
    clerkToken: false,
    apiReachable: false,
    wsConnected: false,
    overall: false,
    lastChecked: 0,
    selfHostable: false,
  };

  private listeners = new Set<ConnectivityListener>();

  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly intervalMs = 10000;

  private wsProvider: (() => boolean) | null = null;

  private onlineHandler?: () => void;

  private offlineHandler?: () => void;

  private deps: ConnectivityMonitorDeps;

  constructor(deps: ConnectivityMonitorDeps) {
    this.deps = deps;
    if (deps.isSelfHostable) {
      this.state.selfHostable = true;
    }
  }

  setWebSocketProvider(provider: () => boolean): void {
    this.wsProvider = provider;
  }

  getState(): ConnectivityState {
    return { ...this.state };
  }

  addListener(listener: ConnectivityListener): () => void {
    this.listeners.add(listener);
    try {
      listener(this.getState());
    } catch {
      /* no-op */
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (this.timer) return;

    this.probe().catch(() => {
      /* probe error handled internally */
    });
    this.timer = setInterval(
      () =>
        this.probe().catch(() => {
          /* probe error handled internally */
        }),
      this.intervalMs
    );

    if (typeof window !== 'undefined') {
      this.onlineHandler = () =>
        this.probe().catch(() => {
          /* probe error handled internally */
        });
      this.offlineHandler = () =>
        this.probe().catch(() => {
          /* probe error handled internally */
        });
      window.addEventListener('online', this.onlineHandler);
      window.addEventListener('offline', this.offlineHandler);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (typeof window !== 'undefined') {
      if (this.onlineHandler) window.removeEventListener('online', this.onlineHandler);
      if (this.offlineHandler) window.removeEventListener('offline', this.offlineHandler);
    }
  }

  async probe(): Promise<void> {
    const selfHostable = this.deps.isSelfHostable ?? false;

    const tokenPromise = selfHostable
      ? Promise.resolve(true)
      : (async () => {
          try {
            const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500));
            const token = await Promise.race([this.deps.getToken(), timeout]);
            return typeof token === 'string' && token.length > 0;
          } catch {
            return false;
          }
        })();

    const apiPromise = this.deps.checkApiHealth();

    const [clerkToken, apiReachable] = await Promise.all([tokenPromise, apiPromise]);
    const wsConnected = this.deps.getWebSocketConnected?.() ?? (!!this.wsProvider?.());
    this.update({ clerkToken, apiReachable, wsConnected, selfHostable });
  }

  refresh(): void {
    this.probe().catch(() => {
      /* probe error handled internally */
    });
  }

  private update(partial: Partial<ConnectivityState>): void {
    const next: ConnectivityState = {
      ...this.state,
      ...partial,
      lastChecked: Date.now(),
    };
    next.overall = next.selfHostable
      ? !!(next.apiReachable && next.wsConnected)
      : !!(next.clerkToken && next.apiReachable && next.wsConnected);

    const changed = JSON.stringify(next) !== JSON.stringify(this.state);
    this.state = next;
    if (changed) {
      this.listeners.forEach((l) => {
        try {
          l(this.getState());
        } catch {
          /* no-op */
        }
      });
    }
  }
}
