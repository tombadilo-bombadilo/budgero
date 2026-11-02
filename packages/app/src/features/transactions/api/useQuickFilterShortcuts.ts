import { useEffect } from 'react';
import { isTypingTarget } from './useClearedShortcut';

export const UNCLEARED_FILTER_KEY = 'C';
export const UNCATEGORIZED_FILTER_KEY = 'U';

/** Shift+C toggles the uncleared filter, Shift+U the uncategorized filter. */
export function useQuickFilterShortcuts(
  enabled: boolean,
  toggleUncleared: () => void,
  toggleUncategorized: () => void
) {
  useEffect(() => {
    if (!enabled) return undefined;
    const handler = (event: KeyboardEvent) => {
      if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (isTypingTarget(event.target)) return;
      const key = event.key?.toLowerCase() ?? '';
      if (key === UNCLEARED_FILTER_KEY.toLowerCase()) toggleUncleared();
      else if (key === UNCATEGORIZED_FILTER_KEY.toLowerCase()) toggleUncategorized();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, toggleUncleared, toggleUncategorized]);
}
