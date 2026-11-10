/**
 * Which workspace is the demo budget from onboarding.
 *
 * The durable marker is a flag in the metadata of the demo's accounts: it is
 * part of the workspace's own encrypted, synced data, so it survives sign-out
 * and shows up on every device (see useIsDemoSpace). The localStorage entry
 * here is only a fast cache of the workspace id: it is set as soon as the
 * workspace exists, kept across sign-out, and refilled from the accounts.
 */
import { useSyncExternalStore } from 'react';

export const DEMO_SPACE_STORAGE_KEY = 'budgero:demo-space';
/** Set to true in the metadata of every account the demo seed creates. */
export const DEMO_ACCOUNT_METADATA_KEY = 'demo_budget';
const KEY = DEMO_SPACE_STORAGE_KEY;
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
    /* storage blocked: the accounts still carry the marker */
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
