import { beforeEach, describe, expect, it } from 'vitest';
import {
  cachedSchedulingGuideEntries,
  cacheSchedulingGuideSeen,
  requestSchedulingGuide,
  useSchedulingGuideStore,
} from './useSchedulingGuideStore';

describe('requestSchedulingGuide', () => {
  beforeEach(() => {
    localStorage.clear();
    useSchedulingGuideStore.setState({ request: null, pending: null });
  });

  it('asks for a budget’s guide unless this device has it cached as seen', () => {
    requestSchedulingGuide('future', 'space-a', 1, 9);
    expect(useSchedulingGuideStore.getState()).toMatchObject({
      request: { kind: 'future', spaceKey: 'space-a', budgetId: 1 },
      accountId: 9,
    });
    useSchedulingGuideStore.getState().dismiss();

    cacheSchedulingGuideSeen({ kind: 'future', spaceKey: 'space-a', budgetId: 1 });
    requestSchedulingGuide('future', 'space-a', 1);
    expect(useSchedulingGuideStore.getState().request).toBeNull();

    requestSchedulingGuide('future', 'space-a', 2);
    expect(useSchedulingGuideStore.getState().request?.budgetId).toBe(2);
  });

  it('lists the cached entries of one workspace', () => {
    cacheSchedulingGuideSeen({ kind: 'future', spaceKey: 'space-a', budgetId: 1 });
    cacheSchedulingGuideSeen({ kind: 'future', spaceKey: 'space-b', budgetId: 2 });
    expect(cachedSchedulingGuideEntries('space-a')).toEqual(['future:1']);
  });
});
