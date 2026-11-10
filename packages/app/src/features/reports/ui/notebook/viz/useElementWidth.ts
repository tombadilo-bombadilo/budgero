import { useEffect, useState, type RefObject } from 'react';

/** The element's width, kept current as it resizes; `fallback` until measured. */
export function useElementWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      if (element.clientWidth > 0) setWidth(element.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** Room for category labels: about a third of the chart, within readable bounds. */
export function labelWidthFor(containerWidth: number, max = 200): number {
  return Math.round(Math.min(max, Math.max(72, containerWidth * 0.32)));
}
