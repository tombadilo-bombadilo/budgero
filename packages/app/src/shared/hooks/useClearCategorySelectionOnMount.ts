import { useEffect } from 'react';
import { useUiStore } from '@shared/store/useUiStore';

/**
 * Clears the selected-categories selection on mount.
 * Deferred via requestAnimationFrame to avoid a synchronous render cascade.
 */
export function useClearCategorySelectionOnMount() {
  const setSelectedCategories = useUiStore((state) => state.setSelectedCategories);

  useEffect(() => {
    const id = requestAnimationFrame(() => setSelectedCategories([]));
    return () => cancelAnimationFrame(id);
  }, [setSelectedCategories]);
}
