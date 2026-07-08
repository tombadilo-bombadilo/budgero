import { useCallback, useEffect, useRef, useState } from 'react';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { useUiStore } from '@shared/store/useUiStore';
import { useMarkRecurringOccurrenceNotified } from '@entities/recurring/api/useRecurringTransactions';
import {
  getNotificationPermission,
  requestNotificationPermission,
  sendNotification,
} from '@shared/lib/notifications';
import { getTodayISO } from '@shared/lib/date-utils';
import { formatMilli } from '@shared/lib/currency/milli';
import type { RecurringOccurrenceWithTemplate } from '@budgero/core/browser';

const CHECK_INTERVAL_MS = 1000 * 60 * 15; // 15 minutes

interface RecurringNotificationOptions {
  autoCheck?: boolean;
}

export function useRecurringNotifications(options: RecurringNotificationOptions = {}) {
  const autoCheck = options.autoCheck ?? true;
  const runtime = useRuntime();
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const budgetId = selectedBudget?.ID ?? 0;
  const markNotified = useMarkRecurringOccurrenceNotified();
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    getNotificationPermission()
  );
  const lastRunRef = useRef<number>(0);

  const ensurePermission = useCallback(async () => {
    const result = await requestNotificationPermission();
    setPermission(result);
    return result;
  }, []);

  useEffect(() => {
    if (!budgetId) return;
    if (permission !== 'granted') return;
    if (!autoCheck) return;

    let cancelled = false;
    const currency = selectedBudget?.DisplayCurrency || 'USD';
    const currencyFormatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    });

    const notifyForOccurrence = async (occurrence: RecurringOccurrenceWithTemplate) => {
      const { template } = occurrence;
      const title =
        template.direction === 'inflow'
          ? `Incoming: ${template.name}`
          : `Upcoming bill: ${template.name}`;
      const amount = formatMilli(currencyFormatter, template.amount);
      const prefix = template.direction === 'outflow' ? '-' : '';
      const body = `${occurrence.dueDate} • ${prefix}${amount}`;

      const delivered = await sendNotification(title, {
        body,
        tag: `recurring-${occurrence.id}`,
        silent: false,
      });

      if (delivered) {
        try {
          await markNotified.mutateAsync({ id: occurrence.id });
        } catch (error) {
          console.warn('[RecurringNotifications] Failed to mark occurrence notified', error);
        }
      }
    };

    const checkOccurrences = async () => {
      try {
        const now = Date.now();
        if (now - lastRunRef.current < 1000 * 60) {
          return;
        }
        lastRunRef.current = now;

        const today = getTodayISO();
        const services = runtime.services();
        const candidates = services.recurring.listNotificationCandidates(today, budgetId);
        if (!Array.isArray(candidates) || !candidates.length || cancelled) return;

        for (const occurrence of candidates) {
          if (cancelled) break;
          await notifyForOccurrence(occurrence);
        }
      } catch (error) {
        console.warn('[RecurringNotifications] Failed to check notifications', error);
      }
    };

    void checkOccurrences();
    const interval = window.setInterval(checkOccurrences, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [autoCheck, budgetId, markNotified, permission, runtime, selectedBudget?.DisplayCurrency]);

  return {
    permission,
    requestPermission: ensurePermission,
  };
}
