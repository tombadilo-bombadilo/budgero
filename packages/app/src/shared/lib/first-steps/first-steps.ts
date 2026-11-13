/**
 * The week-one checklist for a budget set up through "Fresh start", read as a
 * small lesson: set a goal for one category, assign money to fund it, add a
 * transaction (or import one), come back another day, and (optional) invite
 * someone to budget with.
 *
 * Progress is the user's own (synced state, userScope(userId), merge key
 * `firstSteps`), so it follows them to every device and survives cleared site
 * data, and another member of a shared workspace has their own (or none).
 * Entries: `startedOn` (local day it started), one `true` per ticked step
 * (ticks only ever turn on; `assign` and `everyCoin` also mean "announced"),
 * `dismissed` (true/false, newest wins) and `version`. Ticks are worked out
 * from what happens in the budget, never sent anywhere readable: the server
 * can't see budget data, so it couldn't do this anyway.
 *
 * localStorage (`budgero:first-steps`) keeps, per workspace + user, whether
 * the desktop card is folded (layout, this device only) and a copy of the
 * synced value for when the database can't be read. Entries keyed by the
 * workspace alone are checklists from before this was synced (or one started
 * while the synced store couldn't be written): they are moved into the synced
 * state once, by the workspace owner, and then removed.
 */
import { getRuntime } from '@shared/runtime/global';
import {
  mergeSyncedState,
  readSyncedState,
  syncedStateWriteBlocker,
  userScope,
} from '@shared/lib/synced-state/synced-state';

export type FirstStepId = 'assign' | 'goal' | 'transaction' | 'return' | 'share' | 'everyCoin';
/** `share` (optional) and `everyCoin` (Ready to Assign reached 0, announced once) don't count. */
export type CountedFirstStepId = Exclude<FirstStepId, 'share' | 'everyCoin'>;

export interface FirstStepsState {
  /** Local calendar day the checklist started (YYYY-MM-DD). */
  startedOn: string;
  /**
   * `share` is optional: it isn't counted in FIRST_STEP_IDS. `goal` came later,
   * so a checklist stored before it has no key for it (read as not done).
   */
  done: Record<Exclude<CountedFirstStepId, 'goal'>, boolean> & {
    goal?: boolean;
    share?: boolean;
    everyCoin?: boolean;
  };
  /**
   * Hidden on purpose: "Hide first steps", or Close on the finished list.
   * Nothing else sets it (closing a drawer or a dialog never does), and
   * showFirstSteps() brings the list back.
   */
  dismissed: boolean;
  /** Desktop card folded to one row. Still there, just small. This device only. */
  collapsed?: boolean;
  /**
   * Storage version. Until 2 a bare ✕ (on the phone, in the drawer where it
   * reads as "close this sheet") hid the list for good; see migrate().
   */
  v?: number;
}

/** The synced value: one merge entry each, so devices never overwrite each other's ticks. */
export interface SyncedFirstSteps {
  version?: number;
  startedOn?: string;
  dismissed?: boolean;
  goal?: boolean;
  assign?: boolean;
  transaction?: boolean;
  return?: boolean;
  share?: boolean;
  everyCoin?: boolean;
}

export const FIRST_STEPS_KEY = 'firstSteps';
const KEY = 'budgero:first-steps';
/**
 * The steps that count toward "x of 4 done", in the order they are taught:
 * a goal first, then money to fund it. Stored lists keep their ticks; they
 * just show in this order.
 */
export const FIRST_STEP_IDS: CountedFirstStepId[] = ['goal', 'assign', 'transaction', 'return'];
const STEP_ENTRIES: FirstStepId[] = [
  'goal',
  'assign',
  'transaction',
  'return',
  'share',
  'everyCoin',
];

export function isFirstStepDone(state: FirstStepsState, step: FirstStepId): boolean {
  return state.done[step] ?? false;
}

/** Ops that put a transaction in the budget, typed or imported. */
const TRANSACTION_OPS = new Set([
  'transactions.add',
  'transactions.addTransfer',
  'transactions.import',
]);
/** Ops that give a category a goal (goals.restore is only undo). */
const GOAL_OPS = new Set(['goals.create']);
/** Bookkeeping writes, not something the user did in the budget. */
const NOT_ACTIONS = /^(syncedState|pageGuides)\./;

function today(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

/** Last version of the device-only format (entries keyed by workspace). */
const VERSION = 3;
/** The synced format. */
const SYNCED_VERSION = 4;

function allCountedDone(state: FirstStepsState): boolean {
  return FIRST_STEP_IDS.every((id) => isFirstStepDone(state, id));
}

// ---------------------------------------------------------------------------
// Device storage
// ---------------------------------------------------------------------------

/** Per workspace + user: this device's layout and copy of the synced value. */
export interface DeviceEntry {
  collapsed?: boolean;
  synced?: SyncedFirstSteps;
}
type Stored = Record<string, FirstStepsState | DeviceEntry>;

export const firstStepsDeviceKey = (spaceId: string, userId: string) => `${spaceId}|${userId}`;
const isLegacyKey = (key: string) => !key.includes('|');

const listeners = new Set<() => void>();
let cache: Stored | null = null;

/**
 * Before version 2 a bare ✕ hid the list: one hidden before all steps were
 * done was most likely closed by accident, so it shows once more (a finished
 * one that was closed stays closed). Before version 3 "assign" was only
 * ticked once Ready to Assign reached 0, which was announced then, so a
 * ticked one isn't announced again.
 */
function migrate(all: Stored): Stored | null {
  let changed = false;
  const next: Stored = {};
  for (const [key, entry] of Object.entries(all)) {
    const state = entry as FirstStepsState;
    if (!isLegacyKey(key) || !state || typeof state !== 'object' || (state.v ?? 0) >= VERSION) {
      next[key] = entry;
      continue;
    }
    changed = true;
    const v = state.v ?? 0;
    next[key] = {
      ...state,
      dismissed: v < 2 ? state.dismissed && allCountedDone(state) : state.dismissed,
      done:
        state.done?.assign && state.done.everyCoin === undefined
          ? { ...state.done, everyCoin: true }
          : state.done,
      v: VERSION,
    };
  }
  return changed ? next : null;
}

function readAll(): Stored {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    cache = {};
  }
  const migrated = migrate(cache);
  if (migrated) {
    cache = migrated;
    try {
      localStorage.setItem(KEY, JSON.stringify(migrated));
    } catch {
      /* storage blocked: migrate again next time */
    }
  }
  return cache;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function writeAll(next: Stored): void {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: lasts for this visit */
  }
  notify();
}

function legacyEntry(spaceId: string): FirstStepsState | undefined {
  const entry = readAll()[spaceId] as FirstStepsState | undefined;
  return entry && typeof entry === 'object' && entry.startedOn ? entry : undefined;
}

function deviceEntry(spaceId: string, userId: string): DeviceEntry | undefined {
  return readAll()[firstStepsDeviceKey(spaceId, userId)] as DeviceEntry | undefined;
}

function updateDevice(spaceId: string, userId: string, change: Partial<DeviceEntry>): void {
  const all = readAll();
  const key = firstStepsDeviceKey(spaceId, userId);
  const current = (all[key] as DeviceEntry | undefined) ?? {};
  const next = { ...current, ...change };
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  writeAll({ ...all, [key]: next });
}

// ---------------------------------------------------------------------------
// Synced state
// ---------------------------------------------------------------------------

/** Who is signed in, per workspace (set by useFirstSteps), for the non-React calls. */
const users = new Map<string, string>();
/**
 * Entries written here and not yet read back from the database, per workspace
 * + user, so a tick or "Hide" shows at once instead of after the write.
 */
const overlays = new Map<string, SyncedFirstSteps>();
/** Mutations this device's user started (see noteFirstStepsLocalAction). */
let localActions = 0;

function setOverlay(key: string, value: SyncedFirstSteps | undefined): void {
  if (value && Object.keys(value).length > 0) overlays.set(key, value);
  else overlays.delete(key);
  notify();
}

/** Drop overlay entries the database now has (or that were never written). */
function settleOverlay(key: string, entries: SyncedFirstSteps, only?: SyncedFirstSteps): void {
  const overlay = overlays.get(key);
  if (!overlay) return;
  const next: SyncedFirstSteps = { ...overlay };
  let changed = false;
  for (const [entry, value] of Object.entries(only ?? overlay)) {
    const name = entry as keyof SyncedFirstSteps;
    if (overlay[name] !== value) continue;
    if (only || entries[name] === value) {
      delete next[name];
      changed = true;
    }
  }
  if (changed) setOverlay(key, next);
}

/** The user's synced value: the database, or this device's copy when it can't be read. */
function syncedValue(spaceId: string, userId: string): SyncedFirstSteps {
  const read = readSyncedState<SyncedFirstSteps>(userScope(userId), FIRST_STEPS_KEY);
  const base = read.available ? read.value : deviceEntry(spaceId, userId)?.synced;
  return { ...base, ...overlays.get(firstStepsDeviceKey(spaceId, userId)) };
}

function toState(
  synced: SyncedFirstSteps,
  device: DeviceEntry | undefined
): FirstStepsState | null {
  if (!synced.startedOn) return null;
  const done: FirstStepsState['done'] = {
    goal: synced.goal === true,
    assign: synced.assign === true,
    transaction: synced.transaction === true,
    return: synced.return === true,
  };
  if (synced.share) done.share = true;
  if (synced.everyCoin) done.everyCoin = true;
  return {
    startedOn: synced.startedOn,
    done,
    dismissed: synced.dismissed === true,
    ...(device?.collapsed !== undefined ? { collapsed: device.collapsed } : {}),
    ...(synced.version !== undefined ? { v: synced.version } : {}),
  };
}

/**
 * Sends the entries that differ from what is stored (one merge, nothing when
 * nothing changes). Only for the open workspace, never in the demo, and only
 * for a user with a checklist unless this starts one.
 */
function write(spaceId: string, userId: string, entries: SyncedFirstSteps): void {
  if (getRuntime()?.getActiveSpaceId() !== spaceId || syncedStateWriteBlocker()) return;
  const current = syncedValue(spaceId, userId);
  if (!current.startedOn && !entries.startedOn) return;
  const changed = Object.entries(entries).filter(
    ([entry, value]) => current[entry as keyof SyncedFirstSteps] !== value
  );
  if (changed.length === 0) return;
  const patch = Object.fromEntries(changed) as SyncedFirstSteps;
  const key = firstStepsDeviceKey(spaceId, userId);
  setOverlay(key, { ...overlays.get(key), ...patch });
  void mergeSyncedState(userScope(userId), FIRST_STEPS_KEY, { set: { ...patch } })
    .then((sent) => {
      // Refused or already stored: the overlay has nothing left to show.
      if (!sent) settleOverlay(key, {}, patch);
    })
    .catch(() => settleOverlay(key, {}, patch));
}

function forActiveUser(spaceId: string | null, run: (userId: string) => void): void {
  const userId = spaceId ? users.get(spaceId) : undefined;
  if (spaceId && userId) run(userId);
}

/** Who useFirstSteps last saw signed in to a workspace. */
export function setFirstStepsUser(spaceId: string, userId: string): void {
  users.set(spaceId, userId);
}

/**
 * Start the checklist for a workspace just set up from scratch. Also kept on
 * this device under the workspace, so a synced write that couldn't happen
 * yet (no user id, store not ready) is made when the owner next opens it.
 */
export function startFirstSteps(spaceId: string, userId?: string | null, now = new Date()): void {
  const all = readAll();
  if (!all[spaceId]) {
    writeAll({
      ...all,
      [spaceId]: {
        startedOn: today(now),
        done: { assign: false, goal: false, transaction: false, return: false },
        dismissed: false,
        v: VERSION,
      },
    });
  }
  if (!userId) return;
  setFirstStepsUser(spaceId, userId);
  if (syncedValue(spaceId, userId).startedOn) return;
  write(spaceId, userId, { startedOn: today(now), version: SYNCED_VERSION });
}

/**
 * One-time move of a checklist kept only on this device into the user's
 * synced state: writes only what it adds (one merge), then drops it here.
 * Only the workspace owner takes it: the device-only list was started by
 * whoever set the workspace up, and that is the owner.
 */
export function migrateLegacyFirstSteps(spaceId: string, userId: string): void {
  const legacy = legacyEntry(spaceId);
  if (!legacy || getRuntime()?.getActiveSpaceId() !== spaceId || syncedStateWriteBlocker()) return;
  const role = (
    getRuntime() as unknown as { listSpaces?: () => { space_id: string; role?: string }[] } | null
  )
    ?.listSpaces?.()
    .find((space) => space.space_id === spaceId)?.role;
  if (role !== undefined && role !== 'owner') return;
  const read = readSyncedState<SyncedFirstSteps>(userScope(userId), FIRST_STEPS_KEY);
  if (!read.available) return;
  const stored = read.value ?? {};
  const adds: SyncedFirstSteps = {};
  if (!stored.startedOn) adds.startedOn = legacy.startedOn;
  if (stored.version === undefined) adds.version = SYNCED_VERSION;
  for (const step of STEP_ENTRIES) {
    if (legacy.done?.[step] && !stored[step]) adds[step] = true;
  }
  // Hidden here and never shown or hidden on another device.
  if (legacy.dismissed && stored.dismissed === undefined) adds.dismissed = true;
  // Merged and dropped here in one go, so it is written once.
  if (Object.keys(adds).length > 0) write(spaceId, userId, adds);
  const all = { ...readAll() };
  delete all[spaceId];
  const key = firstStepsDeviceKey(spaceId, userId);
  const device = (all[key] as DeviceEntry | undefined) ?? {};
  if (legacy.collapsed !== undefined && device.collapsed === undefined) {
    all[key] = { ...device, collapsed: legacy.collapsed };
  }
  writeAll(all);
}

export function markFirstStep(spaceId: string, step: FirstStepId): void {
  markFirstSteps(spaceId, [step]);
}

/** Ticks several steps with one write. */
export function markFirstSteps(spaceId: string, steps: FirstStepId[]): void {
  forActiveUser(spaceId, (userId) =>
    write(spaceId, userId, Object.fromEntries(steps.map((step) => [step, true])))
  );
}

/** The user's own "Hide first steps" (or Close on the finished list). */
export function hideFirstSteps(spaceId: string): void {
  forActiveUser(spaceId, (userId) => write(spaceId, userId, { dismissed: true }));
}

/** Bring a hidden list back, unfolded. */
export function showFirstSteps(spaceId: string): void {
  forActiveUser(spaceId, (userId) => {
    if (!getFirstSteps(spaceId)) return;
    write(spaceId, userId, { dismissed: false });
    updateDevice(spaceId, userId, { collapsed: false });
  });
}

/** True only for a list this user started here and hid. */
export function isFirstStepsHidden(spaceId: string | null): boolean {
  return getFirstSteps(spaceId)?.dismissed ?? false;
}

export function setFirstStepsCollapsed(spaceId: string, collapsed: boolean): void {
  forActiveUser(spaceId, (userId) => {
    if (getFirstSteps(spaceId)) updateDevice(spaceId, userId, { collapsed });
  });
}

/**
 * Called when a local mutation starts (AppRuntime.executeMutation): a step
 * that turns done after one was done by this user here, and only then is it
 * celebrated (see firstStepsLocalActions).
 */
export function noteFirstStepsLocalAction(op: string): void {
  if (!NOT_ACTIONS.test(op)) localActions += 1;
}

/** How many local mutations have started so far (compare two readings). */
export function firstStepsLocalActions(): number {
  return localActions;
}

/** Called for every local mutation once it succeeded (AppRuntime.executeMutation). */
export function noteFirstStepsMutation(spaceId: string | null, op: string): void {
  if (!spaceId) return;
  if (TRANSACTION_OPS.has(op)) markFirstStep(spaceId, 'transaction');
  else if (GOAL_OPS.has(op)) markFirstStep(spaceId, 'goal');
}

/** Opening the app on a later day than the checklist started (any device) ticks "come back". */
export function noteFirstStepsVisit(spaceId: string, now = new Date()): void {
  const state = getFirstSteps(spaceId);
  if (state && !state.done.return && today(now) > state.startedOn) {
    markFirstStep(spaceId, 'return');
  }
}

/** The signed-in user's checklist in a workspace, read now (non-React callers). */
export function getFirstSteps(spaceId: string | null): FirstStepsState | null {
  const userId = spaceId ? users.get(spaceId) : undefined;
  if (!spaceId || !userId) return null;
  return toState(syncedValue(spaceId, userId), deviceEntry(spaceId, userId));
}

// Another tab folding the card shows up here too.
function onStorage(event: StorageEvent): void {
  if (event.key !== KEY && event.key !== null) return;
  cache = null;
  notify();
}

export function subscribeFirstSteps(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

/** For useFirstSteps: this device's entry for a workspace + user (stable until it changes). */
export function firstStepsDeviceEntry(key: string | null): DeviceEntry | undefined {
  return key ? (readAll()[key] as DeviceEntry | undefined) : undefined;
}

/** For useFirstSteps: entries written here and not read back yet. */
export function firstStepsOverlay(key: string | null): SyncedFirstSteps | undefined {
  return key ? overlays.get(key) : undefined;
}

/**
 * For useFirstSteps, once the synced value is read: keep this device's copy,
 * drop what the database now has from the overlay, move a device-only list
 * in, and tick "come back" on a later day.
 */
export function noteFirstStepsLoaded(
  spaceId: string,
  userId: string,
  stored: SyncedFirstSteps | undefined
): void {
  const value = stored ?? {};
  setFirstStepsUser(spaceId, userId);
  if (JSON.stringify(deviceEntry(spaceId, userId)?.synced ?? {}) !== JSON.stringify(value)) {
    updateDevice(spaceId, userId, { synced: value });
  }
  settleOverlay(firstStepsDeviceKey(spaceId, userId), value);
  migrateLegacyFirstSteps(spaceId, userId);
  noteFirstStepsVisit(spaceId);
}

/** For useFirstSteps: the checklist from a synced value (+ overlay) and this device's entry. */
export function firstStepsFrom(
  synced: SyncedFirstSteps | undefined,
  overlay: SyncedFirstSteps | undefined,
  device: DeviceEntry | undefined
): FirstStepsState | null {
  return toState({ ...synced, ...overlay }, device);
}

/** Test hook. */
export function resetFirstStepsForTests(): void {
  cache = null;
  listeners.clear();
  users.clear();
  overlays.clear();
  localActions = 0;
  if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
}
