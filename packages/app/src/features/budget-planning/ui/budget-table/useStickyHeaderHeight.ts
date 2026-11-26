/**
 * Sticky Header Height Hook
 *
 * Measures the table's sticky column header (the element marked
 * `data-budget-sticky-header`), so the page can keep its scrollbar below the
 * toolbar and header instead of running alongside them. 0 when the layout
 * has no visible sticky header.
 *
 * Attach `rootRef` to an element that contains the table.
 */

import { useCallback, useRef, useState } from 'react';

export function useStickyHeaderHeight() {
  const [height, setHeight] = useState(0);
  const cleanupRef = useRef<(() => void) | null>(null);

  const rootRef = useCallback((root: HTMLElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!root || typeof ResizeObserver === 'undefined') return;

    // The header element changes with the layout, the sortable fork and the
    // empty state; each of those resizes the table, so re-find it then.
    let observed: Element | null = null;
    const observer = new ResizeObserver(() => measure());
    const measure = () => {
      const header = root.querySelector<HTMLElement>('[data-budget-sticky-header]');
      if (header !== observed) {
        if (observed) observer.unobserve(observed);
        if (header) observer.observe(header);
        observed = header;
      }
      setHeight(header?.offsetHeight ?? 0);
    };
    observer.observe(root);
    measure();

    cleanupRef.current = () => observer.disconnect();
  }, []);

  return { rootRef, height };
}
