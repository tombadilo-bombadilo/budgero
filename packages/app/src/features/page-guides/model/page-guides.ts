/**
 * Page guides: a few short cards that explain a page the first time a new
 * user opens it, and again whenever they ask ("How this works").
 *
 * Which guides a user has seen is remembered on this device only
 * (localStorage, per user) and never sent anywhere. The key is kept over
 * sign-out (sign-out-preserved.ts) so signing in again doesn't repeat them.
 */
import { create } from 'zustand';
import type { PageGuideId } from '@shared/lib/analytics/events';

export type { PageGuideId };

/** Stable card keys, so a caller can open a guide at a given card. */
export const PAGE_GUIDE_CARDS = {
  budget: ['assign', 'columns', 'goals', 'overspending'],
  accounts: ['add', 'import', 'cleared', 'reconcile'],
  reports: ['questions', 'build', 'drill'],
  home: ['overview', 'attention', 'yours'],
} as const satisfies Record<PageGuideId, readonly string[]>;

export type PageGuideCardKey<G extends PageGuideId = PageGuideId> =
  (typeof PAGE_GUIDE_CARDS)[G][number];

/** budgero.app docs page; English is unprefixed, the other locales are not. */
export function docsUrl(slug: string, locale: string): string {
  const prefix = ['de', 'fr', 'es', 'nl'].includes(locale) ? `/${locale}` : '';
  return `https://budgero.app${prefix}/docs/${slug}`;
}

/** The guide for a route, if the page has one. */
export function pageGuideForPath(pathname: string): PageGuideId | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/budgeting') return 'budget';
  if (path === '/accounts' || path.startsWith('/accounts/')) return 'accounts';
  // /reports/prebuilt is the reports page before the reports home replaced it.
  if (path === '/reports' || path === '/reports/prebuilt') return 'reports';
  if (path === '/dashboard') return 'home';
  return null;
}

// ---------------------------------------------------------------------------
// Who gets a guide without asking
// ---------------------------------------------------------------------------

/** How long after signing up (or setting up a budget) guides still open by themselves. */
export const NEW_USER_DAYS = 30;
const DAY_MS = 86_400_000;

export interface PageGuideAudience {
  /** Profile `created_at`; unknown while the profile loads or offline. */
  signedUpAt: string | null | undefined;
  /** The open workspace's first-steps checklist start day (YYYY-MM-DD), if this device started one. */
  firstStepsStartedOn: string | null | undefined;
  /** The open workspace is the onboarding demo. */
  isDemo: boolean;
}

function withinNewUserWindow(ms: number, now: number): boolean {
  return Number.isFinite(ms) && now - ms >= -DAY_MS && now - ms <= NEW_USER_DAYS * DAY_MS;
}

/**
 * Guides open by themselves only for someone new: signed up in the last 30
 * days, or set this workspace up from scratch on this device in that time.
 * People who used Budgero before guides existed get only the "How this
 * works" button. Never in the demo: it is sample data, and the guides are
 * worth more on the user's own budget.
 */
export function isNewForPageGuides(audience: PageGuideAudience, now = Date.now()): boolean {
  if (audience.isDemo) return false;
  if (audience.signedUpAt && withinNewUserWindow(Date.parse(audience.signedUpAt), now)) {
    return true;
  }
  if (audience.firstStepsStartedOn) {
    const [y, m, d] = audience.firstStepsStartedOn.split('-').map(Number);
    return withinNewUserWindow(new Date(y, m - 1, d).getTime(), now);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Seen guides (per user, this device)
// ---------------------------------------------------------------------------

export const PAGE_GUIDES_SEEN_KEY = 'budgero:page-guides';

function readSeen(): Record<string, PageGuideId[]> {
  try {
    const raw = localStorage.getItem(PAGE_GUIDES_SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, PageGuideId[]>) : {};
  } catch {
    return {};
  }
}

/** True when storage can't be read either: better no guide than one on every visit. */
export function hasSeenPageGuide(userId: string, id: PageGuideId): boolean {
  try {
    localStorage.getItem(PAGE_GUIDES_SEEN_KEY);
  } catch {
    return true;
  }
  return readSeen()[userId]?.includes(id) ?? false;
}

export function markPageGuideSeen(userId: string, id: PageGuideId): void {
  const all = readSeen();
  const mine = all[userId] ?? [];
  if (mine.includes(id)) return;
  try {
    localStorage.setItem(PAGE_GUIDES_SEEN_KEY, JSON.stringify({ ...all, [userId]: [...mine, id] }));
  } catch {
    /* storage blocked: the guide may show again next time */
  }
}

// ---------------------------------------------------------------------------
// Open requests
// ---------------------------------------------------------------------------

export interface PageGuideRequest {
  id: PageGuideId;
  /** Card index to start at. */
  card: number;
  /** Opened by itself on a first visit, or asked for. */
  trigger: 'auto' | 'manual';
}

interface PageGuideState {
  request: PageGuideRequest | null;
  close: () => void;
}

export const usePageGuideStore = create<PageGuideState>()((set) => ({
  request: null,
  close: () => set({ request: null }),
}));

/**
 * Opens a guide, optionally at one of its cards, e.g.
 * `openPageGuide('budget', { card: 'goals' })`. It appears once no other
 * dialog is open, so it is safe to call from a menu or drawer that is closing.
 */
export function openPageGuide<G extends PageGuideId>(
  id: G,
  options: { card?: PageGuideCardKey<G> } = {}
): void {
  const cards: readonly string[] = PAGE_GUIDE_CARDS[id];
  const card = options.card ? Math.max(0, cards.indexOf(options.card)) : 0;
  usePageGuideStore.setState({ request: { id, card, trigger: 'manual' } });
}

/** Used by the host for a first visit. */
export function requestAutoPageGuide(id: PageGuideId): void {
  usePageGuideStore.setState({ request: { id, card: 0, trigger: 'auto' } });
}

/** Another modal (Radix dialog, alert dialog or vaul drawer) is open. */
export function isOtherDialogOpen(): boolean {
  return Boolean(
    document.querySelector(
      '[role="dialog"][data-state="open"]:not([data-page-guide]), [role="alertdialog"][data-state="open"]'
    )
  );
}
