import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SELECTIONS,
  forgetRememberedSelections,
  hasSelectionParams,
  parseSelections,
  serializeSelections,
  useAnalyticsPageState,
  type AnalyticsSelections,
} from './analytics-state';

const full: AnalyticsSelections = {
  period: 'custom',
  customStart: '2026-01-01',
  customEnd: '2026-03-31',
  accountIds: [3, 1],
  categoryIds: [7],
  payees: ['Acme, Inc.', 'Café & Bar'],
  labelIds: [2, 9],
};

describe('serializeSelections / parseSelections', () => {
  it('leaves defaults out of the query string', () => {
    expect(serializeSelections(DEFAULT_SELECTIONS).toString()).toBe('');
    expect(hasSelectionParams(serializeSelections(DEFAULT_SELECTIONS))).toBe(false);
  });

  it('round-trips every selection, including payees with commas', () => {
    const params = serializeSelections(full);
    expect(params.get('p')).toBe('custom');
    expect(params.get('a')).toBe('3,1');
    expect(params.getAll('py')).toEqual(full.payees);
    expect(parseSelections(new URLSearchParams(params.toString()))).toEqual(full);
  });

  it('keeps unrelated params and drops stale filter params', () => {
    const base = new URLSearchParams('tab=x&p=3m&a=1');
    const params = serializeSelections({ ...DEFAULT_SELECTIONS, labelIds: [4] }, base);
    expect(params.toString()).toBe('tab=x&l=4');
  });

  it('falls back to defaults for malformed values', () => {
    const parsed = parseSelections(
      new URLSearchParams('p=bogus&s=2026-02-30&e=nope&a=1,x,-2,1,0,2.5,4&c=&l=abc&py=&py=%20')
    );
    expect(parsed).toEqual({ ...DEFAULT_SELECTIONS, accountIds: [1, 4] });
  });

  it('orders a reversed custom range', () => {
    const parsed = parseSelections(new URLSearchParams('p=custom&s=2026-05-01&e=2026-01-01'));
    expect(parsed.customStart).toBe('2026-01-01');
    expect(parsed.customEnd).toBe('2026-05-01');
  });
});

describe('useAnalyticsPageState', () => {
  beforeEach(() => forgetRememberedSelections());

  const mount = (url: string) =>
    renderHook(() => ({ state: useAnalyticsPageState(), location: useLocation() }), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
      ),
    });

  it('reads the selections from the URL', () => {
    const { result } = mount('/reports/prebuilt/spending?p=3m&a=5,6');
    expect(result.current.state.selections.period).toBe('3m');
    expect(result.current.state.selections.accountIds).toEqual([5, 6]);
    expect(result.current.state.filters.accountIds).toEqual([5, 6]);
  });

  it('writes updates to the URL', () => {
    const { result } = mount('/reports/prebuilt/spending');
    act(() => result.current.state.update({ period: 'ytd' }));
    act(() => result.current.state.update({ categoryIds: [8] }));
    expect(result.current.location.search).toBe('?p=ytd&c=8');
    expect(result.current.state.selections.categoryIds).toEqual([8]);
    act(() => result.current.state.update({ period: '12m', categoryIds: [] }));
    expect(result.current.location.search).toBe('');
  });

  it('carries the selections into a report opened without a query string', async () => {
    const first = mount('/reports/prebuilt/spending');
    act(() => first.result.current.state.update({ period: '6m', payees: ['Acme'] }));
    first.unmount();

    const second = mount('/reports/prebuilt/in-out');
    expect(second.result.current.state.selections.period).toBe('6m');
    expect(second.result.current.state.selections.payees).toEqual(['Acme']);
    await waitFor(() => expect(second.result.current.location.search).toBe('?p=6m&py=Acme'));
  });

  it('prefers the URL over remembered selections, and forgets them once reset', () => {
    const first = mount('/reports/prebuilt/spending');
    act(() => first.result.current.state.update({ period: '6m' }));
    first.unmount();

    const second = mount('/reports/prebuilt/in-out?p=3m');
    expect(second.result.current.state.selections.period).toBe('3m');
    act(() => second.result.current.state.update({ period: '12m' }));
    second.unmount();

    const third = mount('/reports/prebuilt/wealth');
    expect(third.result.current.state.selections).toEqual(DEFAULT_SELECTIONS);
  });
});
