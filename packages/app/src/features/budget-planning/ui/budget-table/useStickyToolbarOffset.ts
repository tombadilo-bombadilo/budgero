/**
 * Sticky Toolbar Offset Hook
 *
 * The toolbar above the budget table sticks to the top of the scroll area.
 * The table's column header sticks too, so it has to sit right below the
 * toolbar or the toolbar covers it. This measures where the toolbar ends
 * (its sticky `top` plus its height), or 0 when the toolbar doesn't stick.
 *
 * Attach `slotRef` to an element whose first child is the toolbar.
 */

import { useCallback, useRef, useState } from 'react';

export function useStickyToolbarOffset() {
  const [offset, setOffset] = useState(0);
  const cleanupRef = useRef<(() => void) | null>(null);

  const slotRef = useCallback((slot: HTMLElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!slot || typeof ResizeObserver === 'undefined') return;

    let observed: Element | null = null;
    const resizeObserver = new ResizeObserver(() => measure());
    const measure = () => {
      const toolbar = slot.firstElementChild;
      if (toolbar !== observed) {
        if (observed) resizeObserver.unobserve(observed);
        if (toolbar) resizeObserver.observe(toolbar);
        observed = toolbar;
      }
      if (!(toolbar instanceof HTMLElement)) {
        setOffset(0);
        return;
      }
      const style = window.getComputedStyle(toolbar);
      setOffset(
        style.position === 'sticky' ? (Number.parseFloat(style.top) || 0) + toolbar.offsetHeight : 0
      );
    };

    const mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(slot, { childList: true });
    measure();

    cleanupRef.current = () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  return { slotRef, offset };
}
