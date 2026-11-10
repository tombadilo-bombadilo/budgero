import { clearLocalFiles, whenLocalWritesSettle } from '@budgero/core/browser';

/**
 * Remove every local budget copy, from OPFS and from the IndexedDB fallback
 * (no OPFS, or a Firefox private window), whichever this browser used.
 *
 * Destroy the runtime first: it holds the database connections, and a save it
 * starts after the wipe would put a budget back. Saves already in flight are
 * waited for here.
 *
 * Returns false (and logs it, which reaches error reports) when copies could
 * not be removed, so the caller can tell the user instead of claiming a clean
 * sign-out.
 */
export async function wipeLocalBudgetCopies(caller: string): Promise<boolean> {
  try {
    await whenLocalWritesSettle();
    await clearLocalFiles();
    return true;
  } catch (error) {
    console.error(`[${caller}] Local budget copies could not be removed`, error);
    return false;
  }
}
