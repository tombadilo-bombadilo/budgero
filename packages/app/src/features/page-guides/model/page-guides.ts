/**
 * Page guides: a few short cards that explain a page the first time a new
 * user opens it, and again whenever they ask ("How this works").
 *
 * Which guides a user has seen lives in the workspace's encrypted database
 * (synced, per user) with a localStorage cache on each device; see "Seen
 * guides" below. The cache key is kept over sign-out (sign-out-preserved.ts).
 */
import { create } from 'zustand';
import type { PageGuideId } from '@shared/lib/analytics/events';

export type { PageGuideId };

/**
 * Every guide: the pages it belongs to and its card keys (stable, so a caller
 * can open a guide at a given card). Adding a guide is one entry here, its
 * cards in ui/guide-content.tsx and its id in PAGE_GUIDE_IDS (analytics).
 * A path ending in `/*` covers everything below it.
 */
export const PAGE_GUIDES = {
  budget: { paths: ['/budgeting'], cards: ['assign', 'columns', 'goals', 'overspending'] },
  // The accounts overview has its own guide; every register (one account, or
  // all of them at /accounts/all) shares the transactions guide.
  accounts: { paths: ['/accounts'], cards: ['add', 'budget', 'balances', 'reconcile'] },
  transactions: { paths: ['/accounts/*'], cards: ['add', 'dates', 'search', 'cleared'] },
  // /reports/prebuilt is the reports page before the reports home replaced it.
  reports: { paths: ['/reports', '/reports/prebuilt'], cards: ['questions', 'build', 'drill'] },
  home: { paths: ['/dashboard'], cards: ['overview', 'attention', 'yours'] },
  rules: { paths: ['/settings/rules'], cards: ['what', 'when', 'existing', 'undo'] },
  recurring: { paths: ['/settings/recurring'], cards: ['what', 'register', 'actions'] },
  imports: { paths: ['/settings/imports'], cards: ['files', 'accounts', 'duplicates', 'undo'] },
  workspaces: { paths: ['/settings/workspaces'], cards: ['what', 'invite', 'join', 'members'] },
  security: {
    paths: ['/settings/security'],
    cards: ['encryption', 'change', 'storage', 'privacy'],
  },
  currencies: {
    paths: ['/settings/currencies'],
    cards: ['currencies', 'rates', 'custom', 'override'],
  },
} as const satisfies Record<PageGuideId, { paths: readonly string[]; cards: readonly string[] }>;

export const PAGE_GUIDE_CARDS = Object.fromEntries(
  Object.entries(PAGE_GUIDES).map(([id, guide]) => [id, guide.cards])
) as { [G in PageGuideId]: (typeof PAGE_GUIDES)[G]['cards'] };

export type PageGuideCardKey<G extends PageGuideId = PageGuideId> =
  (typeof PAGE_GUIDES)[G]['cards'][number];

/** budgero.app docs page; English is unprefixed, the other locales are not. */
export function docsUrl(slug: string, locale: string): string {
  const prefix = ['de', 'fr', 'es', 'nl'].includes(locale) ? `/${locale}` : '';
  return `https://budgero.app${prefix}/docs/${slug}`;
}

/** The guide for a route, if the page has one. */
export function pageGuideForPath(pathname: string): PageGuideId | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  for (const [id, guide] of Object.entries(PAGE_GUIDES) as [
    PageGuideId,
    { paths: readonly string[] },
  ][]) {
    const match = guide.paths.some((p) =>
      p.endsWith('/*') ? path.startsWith(p.slice(0, -1)) : path === p
    );
    if (match) return id;
  }
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
  /** The user's first-steps checklist start day in the open workspace (YYYY-MM-DD, synced), if any. */
  firstStepsStartedOn: string | null | undefined;
  /** The open workspace is the onboarding demo. */
  isDemo: boolean;
}

function withinNewUserWindow(ms: number, now: number): boolean {
  return Number.isFinite(ms) && now - ms >= -DAY_MS && now - ms <= NEW_USER_DAYS * DAY_MS;
}

/**
 * Guides open by themselves only for someone new: signed up in the last 30
 * days, or set this workspace up from scratch in that time (on any device).
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
// Seen guides
// ---------------------------------------------------------------------------
//
// The source of truth is the open workspace's encrypted database (core
// PageGuidesService, op pageGuides.markSeen), keyed by user id, so it syncs to
// the user's other devices and survives cleared site data; the server only
// sees an opaque encrypted mutation. localStorage (per user, this device, all
// workspaces) is an instant cache: a guide counts as seen when either says so.

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

function storageReadable(): boolean {
  try {
    localStorage.getItem(PAGE_GUIDES_SEEN_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Guides this device's cache has for the user. */
export function cachedSeenPageGuides(userId: string): PageGuideId[] {
  const mine = readSeen()[userId];
  return Array.isArray(mine) ? mine.filter((id) => typeof id === 'string') : [];
}

/** True when storage can't be read either: better no guide than one on every visit. */
export function hasSeenPageGuide(userId: string, id: PageGuideId): boolean {
  if (!storageReadable()) return true;
  return cachedSeenPageGuides(userId).includes(id);
}

/** Adds guides to the device cache; writes nothing when they are all there. */
export function cachePageGuidesSeen(userId: string, ids: readonly PageGuideId[]): void {
  const mine = cachedSeenPageGuides(userId);
  const next = mergeGuideIds(mine, ids);
  if (next.length === mine.length) return;
  try {
    localStorage.setItem(PAGE_GUIDES_SEEN_KEY, JSON.stringify({ ...readSeen(), [userId]: next }));
  } catch {
    /* storage blocked: the synced state still remembers it */
  }
}

/** Marks one guide seen in the device cache (see usePageGuidesSeen for the synced write). */
export function markPageGuideSeen(userId: string, id: PageGuideId): void {
  cachePageGuidesSeen(userId, [id]);
}

/** Union, first list's order first. */
export function mergeGuideIds(a: readonly PageGuideId[], b: readonly PageGuideId[]): PageGuideId[] {
  const out = [...new Set(a)];
  for (const id of b) if (!out.includes(id)) out.push(id);
  return out;
}

/** Guides the cache has that the synced state doesn't: what one write should add. */
export function unsyncedGuideIds(
  cached: readonly PageGuideId[],
  synced: readonly PageGuideId[]
): PageGuideId[] {
  return [...new Set(cached)].filter((id) => !synced.includes(id));
}

/**
 * Synced seen state of the open workspace: still loading, unavailable (no
 * database, read failed: the cache decides alone), or the list.
 */
export type SyncedPageGuides = 'loading' | 'unavailable' | readonly PageGuideId[];

/**
 * Whether a guide counts as seen: true when the cache or the synced state
 * says so, null while the synced state is still loading (don't auto-open yet).
 */
export function isPageGuideSeen(
  id: PageGuideId,
  cacheSeen: boolean,
  synced: SyncedPageGuides
): boolean | null {
  if (cacheSeen) return true;
  if (synced === 'loading') return null;
  if (synced === 'unavailable') return false;
  return synced.includes(id);
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
  const cards: readonly string[] = PAGE_GUIDES[id].cards;
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
