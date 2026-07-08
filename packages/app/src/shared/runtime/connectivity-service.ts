/**
 * Backwards-compatible connectivity service.
 *
 * Delegates to the RuntimeCoordinator's ConnectivityMonitor when available,
 * falls back to a standalone instance for early-boot usage.
 */

import { ConnectivityMonitor, type ConnectivityMonitorDeps } from '@budgero/runtime';
import { getRuntime } from '@shared/runtime/global';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';

function createDefaultDeps(overrides?: Partial<ConnectivityMonitorDeps>): ConnectivityMonitorDeps {
  return {
    async getToken() {
      if (overrides?.getToken) {
        return overrides.getToken();
      }
      try {
        const { getGlobalToken } = await import('@shared/lib/clerk-token-manager');
        return getGlobalToken();
      } catch {
        return null;
      }
    },
    async checkApiHealth() {
      if (overrides?.checkApiHealth) {
        return overrides.checkApiHealth();
      }
      try {
        const { checkApiHealth } = await import('@shared/api/health');
        return checkApiHealth();
      } catch {
        return false;
      }
    },
    getWebSocketConnected: overrides?.getWebSocketConnected,
    isSelfHostable:
      overrides?.isSelfHostable ??
      (() => {
        try {
          return import.meta.env?.VITE_SELF_HOSTABLE === 'true';
        } catch {
          return false;
        }
      })(),
  };
}

function createFallbackMonitor(): ConnectivityMonitor {
  return new ConnectivityMonitor(createDefaultDeps());
}

let fallbackInstance: ConnectivityMonitor | null = null;

/**
 * Returns the connectivity monitor.
 *
 * If the runtime is initialized, returns the coordinator's monitor.
 * Otherwise returns a standalone fallback instance (for early boot).
 */
export function getConnectivityService(): ConnectivityMonitor {
  const runtime = getRuntime();
  const monitor = runtime?.getConnectivityMonitor?.();
  if (monitor) return monitor;

  if (!fallbackInstance) {
    fallbackInstance = createFallbackMonitor();
  }
  return fallbackInstance;
}

/**
 * True once a connectivity probe has completed (trivially true on SaaS
 * builds, which never gate on connectivity). Reads live state — use in
 * render-time gates, not in effects that need a captured snapshot.
 */
export function isConnectivityKnown(): boolean {
  return !IS_SELF_HOSTABLE_BUILD || getConnectivityService().getState().lastChecked > 0;
}
