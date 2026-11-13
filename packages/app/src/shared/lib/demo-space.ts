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
import type { Services } from '@budgero/core/browser';

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

/** True when an account was created by the demo seed (the synced marker). */
export function isDemoAccount(account: { Metadata?: unknown }): boolean {
  const raw = account.Metadata;
  if (!raw) return false;
  try {
    const metadata = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Boolean(metadata && (metadata as Record<string, unknown>)[DEMO_ACCOUNT_METADATA_KEY]);
  } catch {
    return false;
  }
}

/**
 * Proof, from the workspace's own data, that the open workspace is only the
 * onboarding demo: it has a budget, and every budget in it has an account the
 * demo seed marked. A workspace whose seed never ran, or where a budget of the
 * user's own was set up, fails it, so it is never deleted as "the demo".
 */
export function holdsOnlyDemoBudgets(services: Pick<Services, 'budgets' | 'accounts'>): boolean {
  const budgets = services.budgets.getAllBudgets();
  return (
    budgets.length > 0 &&
    budgets.every((budget) => services.accounts.listAccounts(budget.ID).some(isDemoAccount))
  );
}
