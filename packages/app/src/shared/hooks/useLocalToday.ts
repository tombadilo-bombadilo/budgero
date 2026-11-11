import { useEffect, useState } from 'react';
import { getTodayISO } from '@shared/lib/date-utils';

/** Milliseconds until just after the next local midnight. */
function untilNextDay(now = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return Math.max(1_000, next.getTime() - now.getTime());
}

/**
 * The user's local day (YYYY-MM-DD) that turns over at midnight, and is
 * re-read when the tab comes back (timers sleep in background tabs).
 */
export function useLocalToday(): string {
  const [today, setToday] = useState(getTodayISO);
  useEffect(() => {
    const check = () => setToday(getTodayISO());
    let timer = window.setTimeout(function tick() {
      check();
      timer = window.setTimeout(tick, untilNextDay());
    }, untilNextDay());
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);
  return today;
}
