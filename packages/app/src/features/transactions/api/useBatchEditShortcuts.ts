import { useEffect } from 'react';
import { isTypingTarget } from './useClearedShortcut';

/** With rows selected: this key opens the category picker. */
export const CATEGORIZE_SHORTCUT_KEY = 'G';
/** With rows selected: this key opens the move-to-account picker. */
export const MOVE_SHORTCUT_KEY = 'M';
/** With rows selected: this key opens the payee picker. */
export const PAYEE_SHORTCUT_KEY = 'P';

type BatchEditTarget = 'category' | 'account' | 'payee';

/**
 * G / M / P while the batch toolbar is showing. `open` returns false when the
 * action isn't available (e.g. only one account), leaving the key alone.
 */
export function useBatchEditShortcuts(open: (target: BatchEditTarget) => boolean) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return;
      if (isTypingTarget(event.target)) return;
      const key = event.key?.toUpperCase() ?? '';
      const targets: Record<string, BatchEditTarget> = {
        [CATEGORIZE_SHORTCUT_KEY]: 'category',
        [MOVE_SHORTCUT_KEY]: 'account',
        [PAYEE_SHORTCUT_KEY]: 'payee',
      };
      const target = targets[key];
      if (target && open(target)) event.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);
}
