/**
 * Swipe Month Hook
 *
 * Handles swipe gestures to change the current month.
 */

import { useState, useEffect } from 'react';
import { useSwipeable } from 'react-swipeable';
import { addMonths, format as formatDate, parse as parseDate } from 'date-fns';

interface UseSwipeMonthProps {
  currentMonth: string;
  setCurrentMonth: (month: string) => void;
  monthOverride?: string;
  swipeDisabled: boolean;
}

export function useSwipeMonth({
  currentMonth,
  setCurrentMonth,
  monthOverride,
  swipeDisabled,
}: UseSwipeMonthProps) {
  const [enableSwipe, setEnableSwipe] = useState(false);

  const changeMonthBy = (delta: number) => {
    if (monthOverride) return; // in multi-month context, do not change global month
    try {
      const base = parseDate(`${currentMonth}-01`, 'yyyy-MM-dd', new Date());
      const next = addMonths(base, delta);
      setCurrentMonth(formatDate(next, 'yyyy-MM'));
      if (navigator.vibrate) navigator.vibrate(10);
    } catch {
      // no-op
    }
  };

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => changeMonthBy(1),
    onSwipedRight: () => changeMonthBy(-1),
    preventScrollOnSwipe: true,
    trackTouch: true,
    delta: 20,
  });

  // Only enable swipe on touch/mobile devices
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let frame: number | null = null;

    if (swipeDisabled || monthOverride) {
      frame = window.requestAnimationFrame(() => setEnableSwipe(false));
      return () => {
        if (frame !== null) window.cancelAnimationFrame(frame);
      };
    }

    const mql = window.matchMedia('(hover: none) and (pointer: coarse)');
    const applyState = () => {
      setEnableSwipe(mql.matches || window.innerWidth < 768);
    };

    frame = window.requestAnimationFrame(applyState);
    const onMediaChange = () => applyState();
    const onResize = () => applyState();
    mql.addEventListener?.('change', onMediaChange);
    window.addEventListener('resize', onResize);

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      mql.removeEventListener?.('change', onMediaChange);
      window.removeEventListener('resize', onResize);
    };
  }, [swipeDisabled, monthOverride]);

  return {
    enableSwipe,
    swipeHandlers,
  };
}
