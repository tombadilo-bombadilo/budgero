import { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Router navigation state telling the budgeting page to expand and scroll to
 * a category — the shape {@link useFocusCategoryFromNavState} reads back.
 */
export function focusCategoryNavState(expandCategoryId?: number) {
  return { expandCategoryId, scrollToCategory: true };
}

/**
 * Derives the focus category id from navigation state and clears the navigation
 * state after reading it. Returns the category id to focus, or null.
 */
export function useFocusCategoryFromNavState(): number | null {
  const location = useLocation();

  // Derive focus category from navigation state - no useState needed
  const focusCategoryId = useMemo(() => {
    const state = location.state as
      | { expandCategoryId?: number; scrollToCategory?: boolean }
      | undefined;
    return state?.expandCategoryId && state?.scrollToCategory ? state.expandCategoryId : null;
  }, [location.state]);

  // Clear navigation state after reading it (side effect only, no setState)
  useEffect(() => {
    const state = location.state as
      | { expandCategoryId?: number; scrollToCategory?: boolean }
      | undefined;
    if (state?.expandCategoryId && state?.scrollToCategory) {
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  return focusCategoryId;
}
