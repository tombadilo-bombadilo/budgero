import { describe, expect, it } from 'vitest';
import type { CustomDashboardWidget } from '@budgero/core/browser';
import {
  builtinKeyOf,
  mergeVisibleOrder,
  pickHomeDashboard,
  uniqueDashboardName,
  visibleFor,
} from './builtin-cards';

const widget = (
  id: string,
  reportId: string,
  patch: Partial<Pick<CustomDashboardWidget, 'desktopLayout' | 'mobileLayout'>> = {}
): CustomDashboardWidget => ({
  id,
  dashboardId: 'd',
  reportId,
  chartId: 'c',
  sortOrder: 0,
  desktopLayout: { colSpan: 6, rowSpan: 3 },
  mobileLayout: { size: 'm' },
  createdAt: '',
  updatedAt: '',
  ...patch,
});

describe('built-in cards', () => {
  it('tells built-ins (known or from a newer build) from saved questions', () => {
    expect(builtinKeyOf(widget('a', 'builtin:overspent'))).toBe('overspent');
    expect(builtinKeyOf(widget('a', 'builtin:net_worth_2030'))).toBe('unknown');
    expect(builtinKeyOf(widget('a', '0b7c-uuid'))).toBeNull();
  });

  it('orders the phone by its own order when one is stored, and hides per platform', () => {
    const widgets = [
      widget('q', 'report-1'),
      widget('x', 'builtin:spending_tabs', {
        desktopLayout: { colSpan: 12, rowSpan: 3, hidden: true },
        mobileLayout: { size: 'm', order: 0 },
      }),
      widget('y', 'builtin:section_actions', {
        mobileLayout: { size: 'm', order: 1, hidden: true },
      }),
    ];
    expect(visibleFor(widgets, 'desktop').map((w) => w.id)).toEqual(['q', 'y']);
    // A widget without a phone position (added later) goes last.
    expect(visibleFor(widgets, 'mobile').map((w) => w.id)).toEqual(['x', 'q']);
    // Custom dashboards without phone positions keep one shared order.
    const plain = [widget('a', 'r'), widget('b', 'r')];
    expect(visibleFor(plain, 'mobile').map((w) => w.id)).toEqual(['a', 'b']);
  });

  it('keeps hidden widgets in place when the visible ones are reordered', () => {
    expect(mergeVisibleOrder(['a', 'h', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'h', 'a', 'b']);
  });

  it('picks a free dashboard name and the newest home', () => {
    expect(uniqueDashboardName('Home', ['My Dashboard'])).toBe('Home');
    expect(uniqueDashboardName('Home', ['home', 'Home 2'])).toBe('Home 3');
    expect(
      pickHomeDashboard([
        { id: 'a', isHome: true, updatedAt: '2026-01-01' },
        { id: 'b', isHome: true, updatedAt: '2026-02-01' },
        { id: 'c', isHome: false, updatedAt: '2026-03-01' },
      ])?.id
    ).toBe('b');
    expect(pickHomeDashboard([{ id: 'c', isHome: false, updatedAt: '' }])).toBeNull();
  });
});
