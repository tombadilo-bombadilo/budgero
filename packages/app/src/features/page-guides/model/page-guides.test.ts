import { PAGE_GUIDE_IDS } from '@shared/lib/analytics/events';
import { renderHook } from '@testing-library/react';
import { usePageGuideCards } from '../ui/guide-content';
import {
  docsUrl,
  hasSeenPageGuide,
  isNewForPageGuides,
  markPageGuideSeen,
  openPageGuide,
  PAGE_GUIDE_CARDS,
  PAGE_GUIDES,
  PAGE_GUIDES_SEEN_KEY,
  pageGuideForPath,
  usePageGuideStore,
  type PageGuideId,
} from './page-guides';

const NOW = new Date(2026, 10, 11, 12).getTime();
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

beforeEach(() => {
  localStorage.clear();
  usePageGuideStore.setState({ request: null });
});

describe('pageGuideForPath', () => {
  it('maps each page to its guide', () => {
    expect(pageGuideForPath('/budgeting')).toBe('budget');
    expect(pageGuideForPath('/accounts')).toBe('accounts');
    expect(pageGuideForPath('/accounts/all')).toBe('transactions');
    expect(pageGuideForPath('/accounts/12/')).toBe('transactions');
    expect(pageGuideForPath('/settings/rules')).toBe('rules');
    expect(pageGuideForPath('/settings/recurring')).toBe('recurring');
    expect(pageGuideForPath('/settings/imports')).toBe('imports');
    expect(pageGuideForPath('/settings/workspaces')).toBe('workspaces');
    expect(pageGuideForPath('/settings/security')).toBe('security');
    expect(pageGuideForPath('/settings/currencies')).toBe('currencies');
    expect(pageGuideForPath('/settings/currencies/x')).toBeNull();
    expect(pageGuideForPath('/reports')).toBe('reports');
    expect(pageGuideForPath('/reports/prebuilt')).toBe('reports');
    expect(pageGuideForPath('/dashboard')).toBe('home');
    expect(pageGuideForPath('/settings/appearance')).toBeNull();
    expect(pageGuideForPath('/reports/dashboards')).toBeNull();
  });
});

describe('isNewForPageGuides', () => {
  const base = { signedUpAt: null, firstStepsStartedOn: null, isDemo: false };

  it('counts someone who signed up in the last 30 days', () => {
    expect(isNewForPageGuides({ ...base, signedUpAt: daysAgo(0) }, NOW)).toBe(true);
    expect(isNewForPageGuides({ ...base, signedUpAt: daysAgo(29) }, NOW)).toBe(true);
  });

  it('leaves out people who used Budgero before guides existed', () => {
    expect(isNewForPageGuides({ ...base, signedUpAt: daysAgo(31) }, NOW)).toBe(false);
    expect(isNewForPageGuides({ ...base, signedUpAt: daysAgo(400) }, NOW)).toBe(false);
    expect(isNewForPageGuides(base, NOW)).toBe(false);
  });

  it('counts a workspace set up from scratch on this device when the signup date is unknown', () => {
    expect(isNewForPageGuides({ ...base, firstStepsStartedOn: '2026-11-01' }, NOW)).toBe(true);
    expect(isNewForPageGuides({ ...base, firstStepsStartedOn: '2026-09-01' }, NOW)).toBe(false);
  });

  it('never opens guides by itself in the demo', () => {
    expect(
      isNewForPageGuides(
        { signedUpAt: daysAgo(0), firstStepsStartedOn: '2026-11-11', isDemo: true },
        NOW
      )
    ).toBe(false);
  });
});

describe('seen guides', () => {
  it('are remembered per user', () => {
    expect(hasSeenPageGuide('u1', 'budget')).toBe(false);
    markPageGuideSeen('u1', 'budget');
    markPageGuideSeen('u1', 'budget');
    expect(hasSeenPageGuide('u1', 'budget')).toBe(true);
    expect(hasSeenPageGuide('u1', 'accounts')).toBe(false);
    expect(hasSeenPageGuide('u2', 'budget')).toBe(false);
    expect(JSON.parse(localStorage.getItem(PAGE_GUIDES_SEEN_KEY)!)).toEqual({ u1: ['budget'] });
  });

  it('count as seen when storage is blocked, so nothing opens on every visit', () => {
    const spy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(hasSeenPageGuide('u1', 'home')).toBe(true);
    spy.mockRestore();
  });
});

describe('openPageGuide', () => {
  it('opens a guide at a named card', () => {
    openPageGuide('budget', { card: 'goals' });
    expect(usePageGuideStore.getState().request).toEqual({
      id: 'budget',
      card: 2,
      trigger: 'manual',
    });
    openPageGuide('accounts');
    expect(usePageGuideStore.getState().request?.card).toBe(0);
    openPageGuide('transactions', { card: 'dates' });
    expect(usePageGuideStore.getState().request).toMatchObject({ id: 'transactions', card: 1 });
  });
});

it('every guide has the cards PAGE_GUIDE_CARDS names, two to four of them', () => {
  for (const id of Object.keys(PAGE_GUIDE_CARDS) as PageGuideId[]) {
    const { result } = renderHook(() => usePageGuideCards(id));
    expect(result.current.map((card) => card.key)).toEqual([...PAGE_GUIDE_CARDS[id]]);
    expect(result.current.length).toBeGreaterThanOrEqual(2);
    expect(result.current.length).toBeLessThanOrEqual(4);
  }
});

it('links to the docs in the reader’s language', () => {
  expect(docsUrl('goals', 'en')).toBe('https://budgero.app/docs/goals');
  expect(docsUrl('goals', 'de')).toBe('https://budgero.app/de/docs/goals');
});

it('every guide id has a registry entry with at least one page', () => {
  for (const id of PAGE_GUIDE_IDS) {
    expect(PAGE_GUIDES[id].paths.length).toBeGreaterThan(0);
  }
});
