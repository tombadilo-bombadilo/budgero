import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import type {
  CustomDashboardWidget,
  CustomDashboardWithWidgets,
  DesktopWidgetLayout,
  MobileWidgetLayout,
} from '@budgero/core/browser';

/**
 * Built-in cards: the home page's own cards (cash balance, at a glance, …),
 * placeable on any dashboard next to saved questions.
 *
 * Stored as an ordinary dashboard widget so builds that predate them keep
 * working: ReportID is `builtin:<key>` (never a saved question's ID, so those
 * builds show their "source report is missing" card) and ChartID `builtin`.
 * TitleOverride holds the card's name in the language it was added in, which
 * is the title those builds show; this build draws the card's own header.
 */
export const BUILTIN_REPORT_PREFIX = 'builtin:';
export const BUILTIN_CHART_ID = 'builtin';

export const BUILTIN_CARD_KEYS = [
  'cash_balance',
  'at_a_glance',
  'cashflow_trend',
  'overspent',
  'section_spending',
  'spending_breakdown',
  'spending_overview',
  'spending_tabs',
  'section_actions',
  'upcoming',
  'uncategorized',
] as const;

export type BuiltinCardKey = (typeof BUILTIN_CARD_KEYS)[number];

export interface BuiltinCardInfo {
  key: BuiltinCardKey;
  label: MessageDescriptor;
  description: MessageDescriptor;
  /** Follows the dashboard's period tabs (1W / 1M / 3M / YTD). */
  usesPeriod: boolean;
  /** Width when added to a dashboard (of 12 columns). */
  colSpan: number;
}

export const BUILTIN_CARDS: Record<BuiltinCardKey, BuiltinCardInfo> = {
  cash_balance: {
    key: 'cash_balance',
    label: msg`Cash Balance`,
    description: msg`Checking, savings and cash, with its trend over the period.`,
    usesPeriod: true,
    colSpan: 12,
  },
  at_a_glance: {
    key: 'at_a_glance',
    label: msg`At a glance`,
    description: msg`This month’s income, spending and what’s left to assign.`,
    usesPeriod: false,
    colSpan: 12,
  },
  cashflow_trend: {
    key: 'cashflow_trend',
    label: msg`Cashflow trends`,
    description: msg`Income against spending, month by month.`,
    usesPeriod: true,
    colSpan: 8,
  },
  overspent: {
    key: 'overspent',
    label: msg`Overspent categories`,
    description: msg`Categories that spent more than they have this month.`,
    usesPeriod: false,
    colSpan: 4,
  },
  section_spending: {
    key: 'section_spending',
    label: msg`Section title: Spending Analysis`,
    description: msg`A divider with a title, to group the cards below it.`,
    usesPeriod: false,
    colSpan: 12,
  },
  spending_breakdown: {
    key: 'spending_breakdown',
    label: msg`Spending Breakdown`,
    description: msg`Total spent in the period, by category.`,
    usesPeriod: true,
    colSpan: 6,
  },
  spending_overview: {
    key: 'spending_overview',
    label: msg`Spending Overview`,
    description: msg`What’s left of the budget, and spending over time.`,
    usesPeriod: true,
    colSpan: 6,
  },
  spending_tabs: {
    key: 'spending_tabs',
    label: msg`Spending Analysis`,
    description: msg`Breakdown and time series in one card, with tabs (the phone’s home card).`,
    usesPeriod: true,
    colSpan: 12,
  },
  section_actions: {
    key: 'section_actions',
    label: msg`Section title: Action Items`,
    description: msg`A divider with a title, to group the cards below it.`,
    usesPeriod: false,
    colSpan: 12,
  },
  upcoming: {
    key: 'upcoming',
    label: msg`Upcoming transactions`,
    description: msg`The next recurring and scheduled transactions.`,
    usesPeriod: false,
    colSpan: 6,
  },
  uncategorized: {
    key: 'uncategorized',
    label: msg`Needs categorising`,
    description: msg`Transactions that still need a category.`,
    usesPeriod: false,
    colSpan: 6,
  },
};

/** Row span stored for built-ins: they size to their content, so it only satisfies older builds. */
export const BUILTIN_ROW_SPAN = 3;

export function builtinReportId(key: BuiltinCardKey): string {
  return `${BUILTIN_REPORT_PREFIX}${key}`;
}

export function isBuiltinWidget(widget: Pick<CustomDashboardWidget, 'reportId'>): boolean {
  return widget.reportId.startsWith(BUILTIN_REPORT_PREFIX);
}

/**
 * The card a widget shows: a known key, 'unknown' for a built-in this build
 * doesn't have (added by a newer one), or null for a saved question.
 */
export function builtinKeyOf(
  widget: Pick<CustomDashboardWidget, 'reportId'>
): BuiltinCardKey | 'unknown' | null {
  if (!isBuiltinWidget(widget)) return null;
  const key = widget.reportId.slice(BUILTIN_REPORT_PREFIX.length);
  return (BUILTIN_CARD_KEYS as readonly string[]).includes(key)
    ? (key as BuiltinCardKey)
    : 'unknown';
}

export function widgetUsesPeriod(widget: Pick<CustomDashboardWidget, 'reportId'>): boolean {
  const key = builtinKeyOf(widget);
  return key !== null && key !== 'unknown' && BUILTIN_CARDS[key].usesPeriod;
}

export type Platform = 'desktop' | 'mobile';

export function isHiddenOn(widget: CustomDashboardWidget, platform: Platform): boolean {
  return platform === 'desktop'
    ? widget.desktopLayout.hidden === true
    : widget.mobileLayout.hidden === true;
}

/** Whether any widget carries its own phone position (a dashboard made from the default home). */
export function hasPhoneOrder(widgets: CustomDashboardWidget[]): boolean {
  return widgets.some((widget) => widget.mobileLayout.order !== undefined);
}

/** All widgets in the order a platform shows them (hidden ones included, in place). */
export function orderedFor(
  widgets: CustomDashboardWidget[],
  platform: Platform
): CustomDashboardWidget[] {
  if (platform === 'desktop' || !hasPhoneOrder(widgets)) return widgets;
  return widgets
    .map((widget, index) => ({ widget, index }))
    .sort((a, b) => {
      const ao = a.widget.mobileLayout.order ?? Number.POSITIVE_INFINITY;
      const bo = b.widget.mobileLayout.order ?? Number.POSITIVE_INFINITY;
      return ao === bo ? a.index - b.index : ao - bo;
    })
    .map(({ widget }) => widget);
}

/** The widgets a platform shows, in its order. */
export function visibleFor(
  widgets: CustomDashboardWidget[],
  platform: Platform
): CustomDashboardWidget[] {
  return orderedFor(widgets, platform).filter((widget) => !isHiddenOn(widget, platform));
}

/**
 * Full order after the visible widgets were reordered: hidden widgets keep
 * their places, the visible slots take the new order.
 */
export function mergeVisibleOrder(allIds: string[], visibleIds: string[]): string[] {
  const visible = new Set(visibleIds);
  const queue = [...visibleIds];
  return allIds.map((id) => (visible.has(id) ? (queue.shift() ?? id) : id));
}

// ---------------------------------------------------------------------------
// Default home page

interface DefaultHomeEntry {
  key: BuiltinCardKey;
  colSpan: number;
  desktopHidden?: boolean;
  mobileHidden?: boolean;
}

/**
 * Today's home page, desktop order. The phone shows a different set in a
 * different order (MOBILE_ORDER); the rest are hidden there and vice versa.
 */
const DEFAULT_HOME: DefaultHomeEntry[] = [
  { key: 'cash_balance', colSpan: 12 },
  { key: 'at_a_glance', colSpan: 12 },
  { key: 'cashflow_trend', colSpan: 8 },
  { key: 'overspent', colSpan: 4 },
  { key: 'section_spending', colSpan: 12, mobileHidden: true },
  { key: 'spending_breakdown', colSpan: 6, mobileHidden: true },
  { key: 'spending_overview', colSpan: 6, mobileHidden: true },
  { key: 'section_actions', colSpan: 12, mobileHidden: true },
  { key: 'upcoming', colSpan: 6 },
  { key: 'uncategorized', colSpan: 6 },
  { key: 'spending_tabs', colSpan: 12, desktopHidden: true },
];

const MOBILE_ORDER: BuiltinCardKey[] = [
  'at_a_glance',
  'overspent',
  'cash_balance',
  'spending_tabs',
  'cashflow_trend',
  'upcoming',
  'uncategorized',
  'section_spending',
  'spending_breakdown',
  'spending_overview',
  'section_actions',
];

export const DEFAULT_HOME_DASHBOARD_ID = 'home-default';
const DEFAULT_WIDGET_PREFIX = 'default:';

export interface SeedWidget {
  key: BuiltinCardKey;
  desktopLayout: DesktopWidgetLayout;
  mobileLayout: MobileWidgetLayout;
}

/** The default home's widgets with their stored layouts, desktop order. */
export function defaultHomeWidgets(): SeedWidget[] {
  return DEFAULT_HOME.map((entry) => ({
    key: entry.key,
    desktopLayout: {
      colSpan: entry.colSpan,
      rowSpan: BUILTIN_ROW_SPAN,
      ...(entry.desktopHidden ? { hidden: true } : {}),
    },
    mobileLayout: {
      size: 'm',
      order: MOBILE_ORDER.indexOf(entry.key),
      ...(entry.mobileHidden ? { hidden: true } : {}),
    },
  }));
}

/** Widget ID of a default-home card before the home is stored. */
export function defaultWidgetId(key: BuiltinCardKey): string {
  return `${DEFAULT_WIDGET_PREFIX}${key}`;
}

export function isDefaultHomeDashboard(dashboard: Pick<CustomDashboardWithWidgets, 'id'>): boolean {
  return dashboard.id === DEFAULT_HOME_DASHBOARD_ID;
}

/**
 * The default home as a dashboard, never stored: what the home page shows
 * until its first edit stores a copy.
 */
export function defaultHomeDashboard(budgetId: number, name: string): CustomDashboardWithWidgets {
  const at = '1970-01-01T00:00:00.000Z';
  return {
    id: DEFAULT_HOME_DASHBOARD_ID,
    budgetId,
    name,
    sortOrder: 0,
    filters: null,
    isHome: true,
    origin: null,
    createdAt: at,
    updatedAt: at,
    widgets: defaultHomeWidgets().map((seed, index) => ({
      id: defaultWidgetId(seed.key),
      dashboardId: DEFAULT_HOME_DASHBOARD_ID,
      reportId: builtinReportId(seed.key),
      chartId: BUILTIN_CHART_ID,
      sortOrder: index,
      desktopLayout: seed.desktopLayout,
      mobileLayout: seed.mobileLayout,
      createdAt: at,
      updatedAt: at,
    })),
  };
}

/** A name not taken yet (dashboard names are unique per budget, ignoring case). */
export function uniqueDashboardName(base: string, taken: string[]): string {
  const names = new Set(taken.map((name) => name.trim().toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
}

/** The budget's home dashboard among its dashboards (newest if two ever claim it). */
export function pickHomeDashboard<T extends { id: string; isHome: boolean; updatedAt: string }>(
  dashboards: T[]
): T | null {
  return (
    dashboards
      .filter((dashboard) => dashboard.isHome)
      .sort((a, b) =>
        a.updatedAt === b.updatedAt
          ? a.id.localeCompare(b.id)
          : b.updatedAt.localeCompare(a.updatedAt)
      )[0] ?? null
  );
}

/** Origin of a dashboard stored from the default home on its first edit (core's HOME_DEFAULT_ORIGIN). */
const HOME_COPY_ORIGIN = 'home_default';

/**
 * The newest dashboard stored from the default home (the user's customised
 * home), or null. `except` skips one dashboard.
 */
export function pickHomeCopy<T extends { id: string; origin: string | null; updatedAt: string }>(
  dashboards: T[],
  except?: string
): T | null {
  return (
    dashboards
      .filter((dashboard) => dashboard.origin === HOME_COPY_ORIGIN && dashboard.id !== except)
      .sort((a, b) =>
        a.updatedAt === b.updatedAt
          ? a.id.localeCompare(b.id)
          : b.updatedAt.localeCompare(a.updatedAt)
      )[0] ?? null
  );
}

/**
 * What the home page shows: the dashboard set as home; else the customised
 * home (a copy of the default, e.g. after another dashboard stopped being
 * home); else null for the default layout. Only "Reset to default" removes
 * the copy.
 */
export function resolveHomeDashboard<
  T extends { id: string; isHome: boolean; origin: string | null; updatedAt: string },
>(dashboards: T[]): T | null {
  return pickHomeDashboard(dashboards) ?? pickHomeCopy(dashboards);
}
