import { useEffect, useState } from 'react';
import { useRuntime } from '@shared/runtime/runtime-provider';
import type { ConnectivityState } from '@shared/lib/types';

const defaultState: ConnectivityState = {
  clerkToken: false,
  apiReachable: false,
  wsConnected: false,
  overall: false,
  lastChecked: 0,
  selfHostable: false,
};

export function useConnectivity(): ConnectivityState {
  const runtime = useRuntime();
  const [state, setState] = useState<ConnectivityState>(() => {
    try {
      return runtime.connectivityState();
    } catch {
      return defaultState;
    }
  });

  useEffect(() => {
    const off = runtime.onConnectivityChange((snapshot) => setState(snapshot));
    return () => off?.();
  }, [runtime]);

  return state;
}
