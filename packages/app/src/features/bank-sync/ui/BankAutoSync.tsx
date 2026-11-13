import { plural, t } from '@lingui/core/macro';
import { parseEnableBankingConfig, type BankConnection } from '@budgero/core/browser';
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useProfile } from '@entities/user/api/useAuth';
import { userScope, useSyncedState, type SyncedStateMergePatch } from '@shared/lib/synced-state';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { useUiStore } from '@shared/store/useUiStore';
import { formatDateISO } from '@shared/lib/date-utils';
import { invalidateAfterBankSync, useBankConnections, useBankLinks } from '../api/useBankSync';
import { isSyncDue, runBankSync } from '../model/run-bank-sync';
import { isSessionExpired, sessionExpiresSoon } from '../lib/provider';

/** Device cache (and where reminders lived before they synced): session id → day shown. */
const REMINDER_KEY = 'budgero.bankSync.expiryReminder';
/** Synced per user, same shape: the day each bank session's reminder was last shown. */
export const BANK_EXPIRY_REMINDERS_KEY = 'bankExpiryReminders';

type ShownOn = Record<string, string>;

function readCachedReminders(): ShownOn {
  try {
    return JSON.parse(localStorage.getItem(REMINDER_KEY) ?? '{}') as ShownOn;
  } catch {
    return {};
  }
}

function cacheReminders(shown: ShownOn): void {
  try {
    localStorage.setItem(REMINDER_KEY, JSON.stringify(shown));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Nags at most once a day per bank while consent is about to run out, counting
 * a reminder shown on any of the user's devices (`synced`) or this one.
 * Returns the sessions it reminded about (session id → today).
 */
function remindExpiringSessions(connection: BankConnection, synced: ShownOn): ShownOn {
  const config = parseEnableBankingConfig(connection);
  if (!config) return {};
  const today = formatDateISO(new Date());
  const shown = readCachedReminders();
  const reminded: ShownOn = {};
  for (const session of config.sessions) {
    const { sessionId } = session;
    if (!sessionExpiresSoon(session) || shown[sessionId] === today || synced[sessionId] === today) {
      continue;
    }
    shown[sessionId] = today;
    reminded[sessionId] = today;
    const bank = session.aspsp.name;
    const expired = isSessionExpired(session.validUntil);
    toast.warning(
      expired
        ? t`Access to ${bank} expired. Reconnect it in Settings › Bank sync.`
        : t`Access to ${bank} expires soon. Reconnect it in Settings › Bank sync.`,
      { duration: 10_000 }
    );
  }
  cacheReminders(shown);
  return reminded;
}

const NONE_SHOWN: ShownOn = {};

/** Pulls linked bank feeds on app open and on refocus, at most every few hours across devices. */
export function BankAutoSync() {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const budgetId = useUiStore((state) => state.selectedBudget?.ID);
  const { data: connections } = useBankConnections(budgetId);
  const { data: links } = useBankLinks(budgetId);
  const enabled = Boolean(budgetId && connections?.length && links?.length);

  // Reminders shown sync per user through the workspace's encrypted database.
  // Without a profile (offline) this device's cache alone decides.
  const profile = useProfile();
  const userId = profile.data?.id ?? null;
  const reminders = useSyncedState<ShownOn>(
    userId ? userScope(userId) : null,
    BANK_EXPIRY_REMINDERS_KEY
  );
  const remindersReady = userId ? reminders.loaded : !profile.isLoading;
  const syncedShown = reminders.available ? (reminders.value ?? NONE_SHOWN) : null;
  const { merge, canWrite } = reminders;
  // Read by the reminder effect, which runs once per budget, not per sync.
  const latest = useRef({ syncedShown, merge });
  useEffect(() => {
    latest.current = { syncedShown, merge };
  });

  // Days shown on this device but not in the synced state (before reminders
  // synced, or while they couldn't be written) → one synced write.
  useEffect(() => {
    if (!syncedShown || !canWrite) return;
    const cached = readCachedReminders();
    const newer = Object.entries(cached).filter(([id, day]) => day > (syncedShown[id] ?? ''));
    if (newer.length > 0) void merge({ set: Object.fromEntries(newer) }).catch(() => {});
  }, [syncedShown, canWrite, merge]);

  useEffect(() => {
    if (!enabled || !budgetId || !remindersReady) return;
    const { syncedShown: synced, merge: write } = latest.current;
    const patch: SyncedStateMergePatch = { set: {} };
    for (const connection of runtime.services().bankSync.listConnections(budgetId)) {
      Object.assign(patch.set!, remindExpiringSessions(connection, synced ?? NONE_SHOWN));
    }
    if (Object.keys(patch.set!).length > 0) void write(patch).catch(() => {});
  }, [enabled, budgetId, runtime, remindersReady]);

  useEffect(() => {
    if (!enabled || !budgetId) return undefined;
    let cancelled = false;
    // Providers with linked accounts whose last sync is old enough.
    const dueProviders = () => {
      const { bankSync } = runtime.services();
      return bankSync
        .listConnections(budgetId)
        .filter(
          (c) => bankSync.listLinks(budgetId, c.Provider).length > 0 && isSyncDue(c.LastSyncAt)
        )
        .map((c) => c.Provider);
    };
    const due = () => dueProviders().length > 0;
    const maybeSync = async () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine || !due()) return;
      const initial = await runtime.waitForInitialSync({ timeoutMs: 20_000 });
      if (cancelled || (initial.connected && !initial.synced) || !due()) return;
      try {
        const result = await runBankSync(runtime, budgetId, {
          providers: dueProviders(),
          trigger: 'auto',
        });
        if (result.imported) {
          toast.success(
            plural(result.imported, {
              one: 'Imported # bank transaction',
              other: 'Imported # bank transactions',
            })
          );
        }
        if (result.reviews) {
          toast.info(
            plural(result.reviews, {
              one: '# bank transaction needs review',
              other: '# bank transactions need review',
            })
          );
        }
      } catch (error) {
        console.warn('[BankSync] Automatic sync failed', error);
      } finally {
        invalidateAfterBankSync(queryClient);
      }
    };
    const onVisible = () => void maybeSync();
    void maybeSync();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, budgetId, runtime, queryClient]);

  return null;
}
