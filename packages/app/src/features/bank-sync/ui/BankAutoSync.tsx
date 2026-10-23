import { plural, t } from '@lingui/core/macro';
import { parseEnableBankingConfig, type BankConnection } from '@budgero/core/browser';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { useUiStore } from '@shared/store/useUiStore';
import { formatDateISO } from '@shared/lib/date-utils';
import { invalidateAfterBankSync, useBankConnections, useBankLinks } from '../api/useBankSync';
import { isSyncDue, runBankSync } from '../model/run-bank-sync';
import { isSessionExpired, sessionExpiresSoon } from '../lib/provider';

const REMINDER_KEY = 'budgero.bankSync.expiryReminder';

/** Nags at most once a day per bank while consent is about to run out. */
function remindExpiringSessions(connection: BankConnection) {
  const config = parseEnableBankingConfig(connection);
  if (!config) return;
  const today = formatDateISO(new Date());
  let shown: Record<string, string> = {};
  try {
    shown = JSON.parse(localStorage.getItem(REMINDER_KEY) ?? '{}') as Record<string, string>;
  } catch {
    /* fall through with nothing shown */
  }
  for (const session of config.sessions) {
    if (!sessionExpiresSoon(session) || shown[session.sessionId] === today) continue;
    shown[session.sessionId] = today;
    const bank = session.aspsp.name;
    const expired = isSessionExpired(session.validUntil);
    toast.warning(
      expired
        ? t`Access to ${bank} expired. Reconnect it in Settings › Bank sync.`
        : t`Access to ${bank} expires soon. Reconnect it in Settings › Bank sync.`,
      { duration: 10_000 }
    );
  }
  try {
    localStorage.setItem(REMINDER_KEY, JSON.stringify(shown));
  } catch {
    /* storage unavailable */
  }
}

/** Pulls linked bank feeds on app open and on refocus, at most every few hours across devices. */
export function BankAutoSync() {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const budgetId = useUiStore((state) => state.selectedBudget?.ID);
  const { data: connections } = useBankConnections(budgetId);
  const { data: links } = useBankLinks(budgetId);
  const enabled = Boolean(budgetId && connections?.length && links?.length);

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
    for (const connection of runtime.services().bankSync.listConnections(budgetId)) {
      remindExpiringSessions(connection);
    }
    void maybeSync();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, budgetId, runtime, queryClient]);

  return null;
}
