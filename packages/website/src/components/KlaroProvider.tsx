'use client';

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { klaroConfig, type KlaroApi, type KlaroManager } from '@/lib/klaro-config';

declare global {
  interface Window {
    klaro?: KlaroApi;
    klaroConfig?: typeof klaroConfig;
  }
}

type KlaroContextValue = {
  manager: KlaroManager | null;
  show: () => void;
};

const KlaroContext = createContext<KlaroContextValue>({ manager: null, show: () => {} });

let klaroLoadPromise: Promise<KlaroApi> | null = null;

async function loadKlaro(): Promise<KlaroApi> {
  if (typeof window === 'undefined') {
    throw new Error('Klaro can only load in the browser');
  }
  if (window.klaro) return window.klaro;
  if (klaroLoadPromise) return klaroLoadPromise;

  klaroLoadPromise = (async () => {
    // Patch storage to a domain-appropriate strategy. On `*.budgero.app` we
    // use a cookie scoped to the apex so consent flows budgero.app <->
    // my.budgero.app. On localhost / preview deploys the apex doesn't
    // match the current host and the browser silently drops the Set-Cookie
    // header, leaving Klaro with no memory between reloads — fall back to
    // localStorage there.
    const isBudgeroApex =
      typeof window !== 'undefined' && window.location.hostname.endsWith('budgero.app');
    if (isBudgeroApex) {
      klaroConfig.storageMethod = 'cookie';
      klaroConfig.cookieDomain = '.budgero.app';
    } else {
      klaroConfig.storageMethod = 'localStorage';
      delete klaroConfig.cookieDomain;
    }

    // Klaro reads window.klaroConfig on load when invoked as a script. Setting
    // it before importing means setup runs against our config.
    window.klaroConfig = klaroConfig;
    // Load Klaro's stylesheet first, then our overrides — order matters; the
    // theme below wins on cascade because it's loaded second.
    await import('klaro/dist/klaro.css');
    await import('@/components/klaro-theme.css');
    const mod = await import('klaro');
    const api = (mod as unknown as { default: KlaroApi }).default ?? (mod as unknown as KlaroApi);
    api.setup(klaroConfig);
    window.klaro = api;
    return api;
  })();

  return klaroLoadPromise;
}

/**
 * Mounts Klaro client-side and provides the consent manager to children.
 *
 * Children read consent via `useKlaroConsent('serviceName')` — which is
 * useSyncExternalStore-backed so updates to consent flow through React without
 * needing to re-init providers.
 */
export function KlaroProvider({ children }: { children: React.ReactNode }) {
  const [manager, setManager] = useState<KlaroManager | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadKlaro().then((api) => {
      if (cancelled) return;
      setManager(api.getManager());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const show = () => {
    if (typeof window !== 'undefined' && window.klaro) {
      window.klaro.show(undefined, true);
    }
  };

  return <KlaroContext.Provider value={{ manager, show }}>{children}</KlaroContext.Provider>;
}

export function useKlaro() {
  return useContext(KlaroContext);
}

/**
 * Subscribe to consent for a single service. Returns false until Klaro has
 * loaded AND the user has explicitly consented to that service.
 */
export function useKlaroConsent(service: string): boolean {
  const { manager } = useKlaro();

  return useSyncExternalStore(
    (notify) => {
      if (!manager) return () => {};
      const watcher = { update: () => notify() };
      manager.watch(watcher);
      return () => manager.unwatch(watcher);
    },
    () => (manager ? manager.getConsent(service) : false),
    () => false
  );
}
