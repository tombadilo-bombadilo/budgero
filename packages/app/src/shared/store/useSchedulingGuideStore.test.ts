import { beforeEach, describe, expect, it } from 'vitest';
import { requestSchedulingGuide, useSchedulingGuideStore } from './useSchedulingGuideStore';

describe('requestSchedulingGuide', () => {
  beforeEach(() => {
    localStorage.clear();
    useSchedulingGuideStore.setState({ pending: null });
  });

  it('shows each guide once per budget', () => {
    requestSchedulingGuide('future', 'space-a', 1);
    expect(useSchedulingGuideStore.getState().pending).toBe('future');
    useSchedulingGuideStore.getState().dismiss();

    requestSchedulingGuide('future', 'space-a', 1);
    expect(useSchedulingGuideStore.getState().pending).toBeNull();

    requestSchedulingGuide('future', 'space-a', 2);
    expect(useSchedulingGuideStore.getState().pending).toBe('future');
  });
});
