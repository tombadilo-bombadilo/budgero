import { create } from 'zustand';
import { getFormatOptionFromLabel } from '@shared/lib/number-format';
import type { Account, Budget, Category } from '@budgero/core/browser';
import { DateRange } from 'react-day-picker';
import { subDays } from 'date-fns';
import { persistUserPreferencesPatch } from '@shared/lib/user-preferences-sync';
import { getMonthKey } from '@shared/lib/date-utils';

function buildCurrencyLocalizer(currency: string, number_format: string): Intl.NumberFormat | null {
  const settings = getFormatOptionFromLabel(number_format);
  if (!settings) {
    return null;
  }
  return Intl.NumberFormat(settings.locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: settings.fractionDigits,
    maximumFractionDigits: settings.fractionDigits,
    useGrouping: settings.useGrouping,
  });
}

export type RangeOption = 'last-30' | 'last-month' | 'last-60' | 'last-90' | 'ytd' | 'custom';

export type HomePageOption = 'dashboard' | 'planning' | 'accounts' | 'analytics';
export type ClassicFontId =
  | 'fira-code'
  | 'montserrat'
  | 'exo-2'
  | 'azeret'
  | 'inter'
  | 'roboto'
  | 'poppins'
  | 'ibm-plex-mono';

export type DesktopBudgetLayout = 'cards' | 'compact' | 'table';
export type MobileBudgetLayout = 'cards' | 'compact' | 'table';

const CLASSIC_FONT_STORAGE_KEY = 'budgero:classic-font';
const DESKTOP_LAYOUT_STORAGE_KEY = 'budgero:desktop-budget-layout';
const LEGACY_COMPACT_LAYOUT_KEY = 'budgero:compact-desktop-table';
const COMPACT_MOBILE_LAYOUT_KEY = 'budgero:compact-mobile-layout';
const MOBILE_BUDGET_LAYOUT_KEY = 'budgero:mobile-budget-layout';
const LEGACY_COMPACT_MOBILE_TABLE_KEY = 'budgero:compact-mobile-table';
const HOME_PAGE_STORAGE_KEY = 'budgero:home-page';

/**
 * Read a persisted UI preference. `validate` maps the raw stored string to a
 * value (returning undefined to fall back) and may encapsulate legacy-key
 * migrations. Falls back on SSR and storage errors.
 */
function readStoredPref<T>(
  key: string,
  validate: (stored: string | null) => T | undefined,
  fallback: T
): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = validate(window.localStorage.getItem(key));
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

/** Persist a UI preference; `null` clears the key. Storage errors are ignored. */
function writeStoredPref(key: string, value: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // storage may be unavailable; ignore
  }
}

function isClassicFontId(value: unknown): value is ClassicFontId {
  return (
    value === 'fira-code' ||
    value === 'montserrat' ||
    value === 'exo-2' ||
    value === 'azeret' ||
    value === 'inter' ||
    value === 'roboto' ||
    value === 'poppins' ||
    value === 'ibm-plex-mono'
  );
}

function applyClassicFont(font: ClassicFontId) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (font === 'poppins') {
    root.removeAttribute('data-classic-font');
  } else {
    root.setAttribute('data-classic-font', font);
  }
}

interface UiState {
  currentMonth: string;
  setCurrentMonth: (month: string) => void;

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;

  selectedTransactionId: number | null;
  setSelectedTransactionId: (id: number | null) => void;

  rowSelection: Record<number, boolean>;
  setRowSelection: (sel: Record<number, boolean>) => void;

  pagination: { pageIndex: number; pageSize: number };
  setPagination: (p: { pageIndex: number; pageSize: number }) => void;

  isBudgetImporting: boolean;
  setIsBudgetImporting: (open: boolean) => void;

  globalLocalizer: Intl.NumberFormat;
  accountLocalizer: Intl.NumberFormat;
  setGlobalLocalizer: (currency: string, number_format: string) => void;
  setAccountLocalizer: (currency: string, number_format: string) => void;

  selectedBudget: Budget | null;
  setSelectedBudget: (budget: Budget | null) => void;

  selectedAccount: Account | null;
  setSelectedAccount: (account: Account | null) => void;

  selectedCategories: Category[];
  setSelectedCategories: (categories: Category[]) => void;
  lastSelectedCategoryId: number | null;
  setLastSelectedCategoryId: (id: number | null) => void;

  homePage: HomePageOption;
  setHomePage: (page: HomePageOption) => void;

  // Focus a budget category in the table
  focusCategoryId: number | null;
  setFocusCategoryId: (id: number | null) => void;

  highlightAddCategoryGroupId: number | null;
  setHighlightAddCategoryGroupId: (id: number | null) => void;

  highlightGoalCategoryId: number | null;
  setHighlightGoalCategoryId: (id: number | null) => void;

  highlightAssignmentCategoryId: number | null;
  setHighlightAssignmentCategoryId: (id: number | null) => void;

  classicFont: ClassicFontId;
  setClassicFont: (font: ClassicFontId) => void;

  desktopBudgetLayout: DesktopBudgetLayout;
  setDesktopBudgetLayout: (value: DesktopBudgetLayout) => void;

  // Compact mobile layout (header only)
  compactMobileLayout: boolean;
  setCompactMobileLayout: (value: boolean) => void;

  mobileBudgetLayout: MobileBudgetLayout;
  setMobileBudgetLayout: (value: MobileBudgetLayout) => void;

  // Date range for charts
  dateRange: DateRange | undefined;
  setDateRange: (range: DateRange | undefined) => void;
  rangeOption: RangeOption;
  setRangeOption: (option: RangeOption) => void;
  transactionCurrencyDisplay: 'budget' | 'account';
  setTransactionCurrencyDisplay: (display: 'budget' | 'account') => void;

  currencyConversion: {
    isActive: boolean;
    message: string;
    progress?: { current: number; total: number };
    error?: string;
  };
  setCurrencyConversion: (state: Partial<UiState['currencyConversion']>) => void;
  resetCurrencyConversion: () => void;
  pendingImportFile: File | null;
  setPendingImportFile: (file: File | null) => void;

  showHiddenCategories: boolean;
  setShowHiddenCategories: (show: boolean) => void;

  // Privacy mode - masks visible numeric digits across the UI
  privacyMaskNumbers: boolean;
  setPrivacyMaskNumbers: (enabled: boolean) => void;
  togglePrivacyMaskNumbers: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  toggleCommandPalette: () => set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
  classicFont: (() => {
    const font = readStoredPref<ClassicFontId>(
      CLASSIC_FONT_STORAGE_KEY,
      (stored) => (isClassicFontId(stored) ? stored : undefined),
      'poppins'
    );
    applyClassicFont(font);
    return font;
  })(),
  setClassicFont: (font) => {
    applyClassicFont(font);
    writeStoredPref(CLASSIC_FONT_STORAGE_KEY, font === 'poppins' ? null : font);
    persistUserPreferencesPatch({ classic_font: font });
    set({ classicFont: font });
  },
  desktopBudgetLayout: readStoredPref<DesktopBudgetLayout>(
    DESKTOP_LAYOUT_STORAGE_KEY,
    (stored) => {
      if (stored === 'cards' || stored === 'compact' || stored === 'table') {
        return stored;
      }
      // Legacy migration: map old compact flag to compact layout
      if (window.localStorage.getItem(LEGACY_COMPACT_LAYOUT_KEY) === '1') {
        return 'compact';
      }
      return undefined;
    },
    'table'
  ),
  setDesktopBudgetLayout: (value) => {
    writeStoredPref(DESKTOP_LAYOUT_STORAGE_KEY, value);
    // cleanup legacy flag
    writeStoredPref(LEGACY_COMPACT_LAYOUT_KEY, null);
    persistUserPreferencesPatch({ desktop_budget_layout: value });
    set({ desktopBudgetLayout: value });
  },
  compactMobileLayout: readStoredPref(COMPACT_MOBILE_LAYOUT_KEY, (stored) => stored === '1', false),
  setCompactMobileLayout: (value) => {
    writeStoredPref(COMPACT_MOBILE_LAYOUT_KEY, value ? '1' : null);
    persistUserPreferencesPatch({ compact_mobile_layout: value });
    set({ compactMobileLayout: value });
  },
  mobileBudgetLayout: readStoredPref<MobileBudgetLayout>(
    MOBILE_BUDGET_LAYOUT_KEY,
    (stored) => {
      if (stored === 'cards' || stored === 'compact' || stored === 'table') {
        return stored;
      }
      // Legacy migration: map old compact table flag to table layout
      if (window.localStorage.getItem(LEGACY_COMPACT_MOBILE_TABLE_KEY) === '1') {
        return 'table';
      }
      return undefined;
    },
    'cards'
  ),
  setMobileBudgetLayout: (value) => {
    writeStoredPref(MOBILE_BUDGET_LAYOUT_KEY, value);
    // cleanup legacy flag
    writeStoredPref(LEGACY_COMPACT_MOBILE_TABLE_KEY, null);
    persistUserPreferencesPatch({ mobile_budget_layout: value });
    set({ mobileBudgetLayout: value });
  },
  // Default to the planning workspace (resolved to the /budgeting route by
  // the router) — it's the core of the app and what users coming from YNAB
  // expect to land on. Changeable in Settings → Appearance → Default Home.
  homePage: readStoredPref<HomePageOption>(
    HOME_PAGE_STORAGE_KEY,
    (stored) =>
      stored === 'dashboard' ||
      stored === 'planning' ||
      stored === 'accounts' ||
      stored === 'analytics'
        ? stored
        : undefined,
    'planning'
  ),
  setHomePage: (page) => {
    writeStoredPref(HOME_PAGE_STORAGE_KEY, page);
    persistUserPreferencesPatch({ home_page: page });
    set({ homePage: page });
  },
  currentMonth: getMonthKey(new Date()),
  setCurrentMonth: (month) => set({ currentMonth: month }),

  selectedTransactionId: null,
  setSelectedTransactionId: (id) => set({ selectedTransactionId: id }),

  rowSelection: {},
  setRowSelection: (sel) => set({ rowSelection: sel }),

  pagination: { pageIndex: 0, pageSize: 25 },
  setPagination: (p) => set({ pagination: p }),

  isBudgetImporting: false,
  setIsBudgetImporting: (open) => set({ isBudgetImporting: open }),

  globalLocalizer: Intl.NumberFormat('en-EN', {
    style: 'currency',
    currency: 'USD',
  }),
  accountLocalizer: Intl.NumberFormat('en-EN', {
    style: 'currency',
    currency: 'USD',
  }),

  setGlobalLocalizer: (currency: string, number_format: string) => {
    const localizer = buildCurrencyLocalizer(currency, number_format);
    if (localizer) {
      set({ globalLocalizer: localizer });
    }
  },

  setAccountLocalizer: (currency: string, number_format: string) => {
    const localizer = buildCurrencyLocalizer(currency, number_format);
    if (localizer) {
      set({ accountLocalizer: localizer });
    }
  },

  selectedBudget: null,
  setSelectedBudget: (budget) => {
    set({ selectedBudget: budget });

    // Update localizers when the budget changes. NumberFormat is a budget-level
    // setting that drives BOTH localizers, so rebuild both — otherwise a format
    // change only refreshes globalLocalizer and account pages (which default to
    // accountLocalizer) keep the stale format until the account is re-selected.
    if (budget?.DisplayCurrency && budget?.NumberFormat) {
      const state = useUiStore.getState();
      state.setGlobalLocalizer(budget.DisplayCurrency, budget.NumberFormat);
      const accountCurrency = state.selectedAccount?.Currency ?? budget.DisplayCurrency;
      state.setAccountLocalizer(accountCurrency, budget.NumberFormat);
    }
  },

  selectedAccount: null,
  setSelectedAccount: (account) => {
    set({ selectedAccount: account });

    if (account?.Currency) {
      const state = useUiStore.getState();
      const budget = state.selectedBudget;
      if (budget?.NumberFormat) {
        state.setAccountLocalizer(account.Currency, budget.NumberFormat);
      }
    }
  },

  selectedCategories: [],
  setSelectedCategories: (categories) => set({ selectedCategories: categories }),
  lastSelectedCategoryId: null,
  setLastSelectedCategoryId: (id) => set({ lastSelectedCategoryId: id }),

  focusCategoryId: null,
  setFocusCategoryId: (id) => set({ focusCategoryId: id }),

  highlightAddCategoryGroupId: null,
  setHighlightAddCategoryGroupId: (id) => set({ highlightAddCategoryGroupId: id }),

  highlightGoalCategoryId: null,
  setHighlightGoalCategoryId: (id) => set({ highlightGoalCategoryId: id }),

  highlightAssignmentCategoryId: null,
  setHighlightAssignmentCategoryId: (id) => set({ highlightAssignmentCategoryId: id }),

  dateRange: {
    from: subDays(new Date(), 30),
    to: new Date(),
  },
  setDateRange: (range) => set({ dateRange: range }),
  rangeOption: 'last-30',
  setRangeOption: (option) => set({ rangeOption: option }),

  transactionCurrencyDisplay: 'account', // Default to account currency since that's what users actually transacted
  setTransactionCurrencyDisplay: (display) => set({ transactionCurrencyDisplay: display }),

  currencyConversion: {
    isActive: false,
    message: '',
  },
  setCurrencyConversion: (state) =>
    set((prev) => ({
      currencyConversion: { ...prev.currencyConversion, ...state },
    })),
  resetCurrencyConversion: () =>
    set({
      currencyConversion: { isActive: false, message: '', progress: undefined, error: undefined },
    }),
  pendingImportFile: null,
  setPendingImportFile: (file) => set({ pendingImportFile: file }),

  showHiddenCategories: false,
  setShowHiddenCategories: (show) => set({ showHiddenCategories: show }),

  // Privacy mode (session-only, non-persistent)
  privacyMaskNumbers: false,
  setPrivacyMaskNumbers: (enabled) => set({ privacyMaskNumbers: enabled }),
  togglePrivacyMaskNumbers: () =>
    set((state) => ({ privacyMaskNumbers: !state.privacyMaskNumbers })),
}));
