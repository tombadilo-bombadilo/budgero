import { useEffect } from 'react';

/**
 * Asks the browser to confirm closing or reloading the tab while `active`
 * (unsaved work). In-app navigation is not blocked here.
 */
export function useLeaveGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need a return value to show the prompt.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);
}
