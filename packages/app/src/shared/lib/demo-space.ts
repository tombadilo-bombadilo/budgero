/**
 * Which workspace on this device is the demo budget from onboarding. The
 * marker is local: on another device the demo is just a workspace named
 * "Demo budget" that the owner can delete in Settings → Workspaces.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'budgero:demo-space';
const listeners = new Set<() => void>();

export function getDemoSpaceId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setDemoSpaceId(spaceId: string | null): void {
  try {
    if (spaceId) localStorage.setItem(KEY, spaceId);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the banner just won't show */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDemoSpaceId(): string | null {
  return useSyncExternalStore(subscribe, getDemoSpaceId, () => null);
}
