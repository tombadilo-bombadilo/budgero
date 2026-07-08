import { useCallback } from 'react';
import { addMonths, format, parse } from 'date-fns';
import { useUiStore } from '@shared/store/useUiStore';

/**
 * Returns a stepper that moves the globally-selected budget month one month
 * backward or forward, persisting the result via the UI store.
 */
export function useNavigateMonth() {
  const currentMonth = useUiStore((state) => state.currentMonth);
  const setCurrentMonth = useUiStore((state) => state.setCurrentMonth);

  return useCallback(
    (direction: 'prev' | 'next') => {
      const currentDate = parse(`${currentMonth}-01`, 'yyyy-MM-dd', new Date());
      const updated = addMonths(currentDate, direction === 'prev' ? -1 : 1);
      setCurrentMonth(format(updated, 'yyyy-MM'));
    },
    [currentMonth, setCurrentMonth]
  );
}
