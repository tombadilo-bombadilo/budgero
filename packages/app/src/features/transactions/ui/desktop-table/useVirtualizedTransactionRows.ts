import React from 'react';
import { buildRowOffsets, findRowAt } from './row-offsets';

export const TRANSACTION_ROW_HEIGHT = 64;
export const COMPACT_TRANSACTION_ROW_HEIGHT = 40;
const OVERSCAN_ROWS = 8;
const DEFAULT_VIEWPORT_HEIGHT = 640;
/** Rendered rows carry this attribute (their key) so measured heights can be read back. */
export const ROW_KEY_ATTRIBUTE = 'data-row-key';

const NO_HEIGHTS: ReadonlyMap<string, number> = new Map();

/** Applies measured heights; keeps the old state (no re-render) when nothing moved by over half a pixel. */
export function mergeHeights(
  previous: { basis: string; heights: ReadonlyMap<string, number> },
  basis: string,
  updates: [string, number][]
): { basis: string; heights: ReadonlyMap<string, number> } {
  const base = previous.basis === basis ? previous.heights : NO_HEIGHTS;
  let next: Map<string, number> | null = previous.basis === basis ? null : new Map();
  for (const [key, height] of updates) {
    const known = (next ?? base).get(key);
    if (known !== undefined && Math.abs(known - height) <= 0.5) continue;
    next ??= new Map(base);
    next.set(key, height);
  }
  return next ? { basis, heights: next } : previous;
}

export interface VirtualizedRowsOptions<T> {
  /**
   * Rows can differ in height (wrapped memos): measure every rendered row and
   * lay the list out from the measured heights. Off = every row is `rowHeight`.
   */
  dynamic?: boolean;
  /** Row key, matching the row element's data-row-key; required with `dynamic`. */
  getKey?: (item: T) => string | number;
}

export function useVirtualizedTransactionRows<T>(
  items: T[],
  rowHeight = TRANSACTION_ROW_HEIGHT,
  { dynamic = false, getKey }: VirtualizedRowsOptions<T> = {}
) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const animationFrameRef = React.useRef<number | null>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(DEFAULT_VIEWPORT_HEIGHT);
  const hasItems = items.length > 0;
  const measuring = dynamic && !!getKey;

  // Measured heights by row key, for one basis (measuring on, base height):
  // a new basis (text size, density) starts empty, so none go stale.
  const basis = `${measuring}:${rowHeight}`;
  const basisRef = React.useRef(basis);
  React.useLayoutEffect(() => {
    basisRef.current = basis;
  });
  const [measured, setMeasured] = React.useState<{
    basis: string;
    heights: ReadonlyMap<string, number>;
  }>(() => ({ basis, heights: new Map() }));
  const heights = measured.basis === basis ? measured.heights : NO_HEIGHTS;

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateHeight = () => setViewportHeight(viewport.clientHeight || DEFAULT_VIEWPORT_HEIGHT);
    const observer = new ResizeObserver(updateHeight);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [hasItems]);

  // One observer for all rendered rows: a row reports its height when first
  // rendered and again whenever it changes (memo edited, column resized).
  const rowObserverRef = React.useRef<ResizeObserver | null>(null);
  const observedRowsRef = React.useRef(new Set<Element>());
  // A layout effect, declared before the one below, so the observer exists
  // when the first measured render observes its rows.
  React.useLayoutEffect(() => {
    if (!measuring) return;
    const observed = observedRowsRef.current;
    const observer = new ResizeObserver((entries) => {
      const updates: [string, number][] = [];
      for (const entry of entries) {
        const key = entry.target.getAttribute(ROW_KEY_ATTRIBUTE);
        if (key === null || !entry.target.isConnected) continue;
        const { height } = entry.target.getBoundingClientRect();
        if (height > 0) updates.push([key, height]);
      }
      if (updates.length > 0) {
        setMeasured((previous) => mergeHeights(previous, basisRef.current, updates));
      }
    });
    rowObserverRef.current = observer;
    return () => {
      observer.disconnect();
      observed.clear();
      rowObserverRef.current = null;
    };
  }, [measuring]);

  // After every render: observe newly rendered rows, forget removed ones.
  React.useLayoutEffect(() => {
    const observer = rowObserverRef.current;
    const viewport = viewportRef.current;
    if (!measuring || !observer || !viewport) return;
    const observed = observedRowsRef.current;
    const rows = viewport.querySelectorAll(`[${ROW_KEY_ATTRIBUTE}]`);
    const current = new Set<Element>(rows);
    for (const row of observed) {
      if (!current.has(row)) {
        observer.unobserve(row);
        observed.delete(row);
      }
    }
    for (const row of current) {
      if (!observed.has(row)) {
        observer.observe(row);
        observed.add(row);
      }
    }
  });

  React.useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    },
    []
  );

  const handleScroll = React.useCallback<React.UIEventHandler<HTMLDivElement>>((event) => {
    const nextScrollTop = event.currentTarget.scrollTop;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(() => {
      setScrollTop(nextScrollTop);
      animationFrameRef.current = null;
    });
  }, []);

  // Row tops (dynamic only): measured heights, rowHeight for rows not seen yet.
  const offsets = React.useMemo(() => {
    if (!measuring || !getKey) return null;
    return buildRowOffsets(
      items.length,
      (index) => heights.get(String(getKey(items[index]))) ?? rowHeight
    );
  }, [items, getKey, measuring, rowHeight, heights]);

  const offsetOf = React.useCallback(
    (index: number) => (offsets ? offsets[Math.min(index, items.length)] : index * rowHeight),
    [offsets, items.length, rowHeight]
  );

  // Stable across measurements: callers scroll from effects keyed on it, and a
  // new height must not count as a reason to scroll again.
  const offsetOfRef = React.useRef(offsetOf);
  React.useLayoutEffect(() => {
    offsetOfRef.current = offsetOf;
  });
  const scrollToIndex = React.useCallback((index: number) => {
    const nextScrollTop = Math.max(0, offsetOfRef.current(index));
    if (viewportRef.current) {
      viewportRef.current.scrollTop = nextScrollTop;
    }
    setScrollTop(nextScrollTop);
  }, []);

  let startIndex: number;
  let endIndex: number;
  if (offsets) {
    startIndex = Math.max(0, findRowAt(offsets, scrollTop) - OVERSCAN_ROWS);
    endIndex = Math.min(
      items.length,
      findRowAt(offsets, scrollTop + viewportHeight) + 1 + OVERSCAN_ROWS
    );
  } else {
    startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS);
    const visibleRowCount = Math.ceil(viewportHeight / rowHeight) + OVERSCAN_ROWS * 2;
    endIndex = Math.min(items.length, startIndex + visibleRowCount);
  }

  const totalHeight = offsets ? offsets[items.length] : items.length * rowHeight;

  return {
    viewportRef,
    handleScroll,
    scrollToIndex,
    visibleItems: items.slice(startIndex, endIndex),
    startIndex,
    topSpacerHeight: offsetOf(startIndex),
    bottomSpacerHeight: Math.max(0, totalHeight - offsetOf(endIndex)),
    endIndex,
  };
}
