/**
 * Sign-out wipes localStorage. A few small markers have to outlive it, or
 * signing in again would lose the demo budget's banner, repeat first-month
 * analytics events and drop the first-steps checklist. They hold only ids,
 * dates and step/milestone names: no budget data, nothing secret.
 */
export const SIGN_OUT_PRESERVED_LOCAL_KEYS: readonly string[] = [
  'budgero:demo-space', // shared/lib/demo-space.ts
  'budgero:fm-opened', // shared/lib/analytics/first-month.ts
  'budgero:fm-milestones',
  'budgero:first-steps', // shared/lib/first-steps/first-steps.ts
];

/** localStorage.clear() that keeps the keys above (and any extra ones). */
export function clearLocalStorageForSignOut(extraKeys: readonly string[] = []): void {
  const kept: [string, string][] = [];
  try {
    for (const key of [...SIGN_OUT_PRESERVED_LOCAL_KEYS, ...extraKeys]) {
      const value = localStorage.getItem(key);
      if (value !== null) kept.push([key, value]);
    }
  } catch {
    /* storage blocked: nothing to keep */
  }
  try {
    localStorage.clear();
  } finally {
    try {
      for (const [key, value] of kept) localStorage.setItem(key, value);
    } catch {
      /* no-op */
    }
  }
}
