import { Trans } from '@lingui/react/macro';
import { useCallback, useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useProfile } from '@entities/user/api/useAuth';
import { resolveSpaceKey } from '@shared/lib/query-utils';
import { userScope, useSyncedState } from '@shared/lib/synced-state';
import { useActiveSpaceId } from '@shared/runtime/runtime-provider';
import {
  cachedSchedulingGuideEntries,
  cacheSchedulingGuideSeen,
  SCHEDULING_GUIDES_SEEN_KEY,
  schedulingGuideEntry,
  useSchedulingGuideStore,
} from '@shared/store/useSchedulingGuideStore';
import { Button } from '@shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';

type SeenGuides = Record<string, true>;
const NONE_SEEN: SeenGuides = {};

/** Writes in flight, per workspace + user + entry, so a refetch doesn't send them twice. */
const inFlight = new Set<string>();

/**
 * Explains, once per budget, where a future-dated transaction went: registers
 * follow the date range, and its presets end today. Recurring transactions
 * are covered by the Recurring page guide instead.
 */
export function SchedulingGuideDialog() {
  const request = useSchedulingGuideStore((state) => state.request);
  const pending = useSchedulingGuideStore((state) => state.pending);
  const dismissGuide = useSchedulingGuideStore((state) => state.dismiss);
  const requestShowUpcoming = useSchedulingGuideStore((state) => state.requestShowUpcoming);
  const location = useLocation();
  const navigate = useNavigate();

  const accountId = useSchedulingGuideStore((state) => state.accountId);

  // "Seen" is per user, synced through the workspace's encrypted database; the
  // device cache (localStorage) also counts, so nothing shows twice while it
  // loads. Without a profile (offline) the cache alone decides.
  const profile = useProfile();
  const userId = profile.data?.id ?? null;
  const spaceId = useActiveSpaceId();
  const seen = useSyncedState<SeenGuides>(
    userId ? userScope(userId) : null,
    SCHEDULING_GUIDES_SEEN_KEY
  );
  const ready = userId ? seen.loaded : !profile.isLoading;
  const { merge, canWrite } = seen;

  const write = useCallback(
    (entries: string[]) => {
      const keys = entries.map((entry) => `${spaceId}|${userId}|${entry}`);
      const fresh = entries.filter((_, i) => !inFlight.has(keys[i]!));
      if (!canWrite || fresh.length === 0) return;
      keys.forEach((key) => inFlight.add(key));
      void merge({ set: Object.fromEntries(fresh.map((entry) => [entry, true])) })
        .catch(() => {
          /* the cache still has it; the next load writes it again */
        })
        .finally(() => keys.forEach((key) => inFlight.delete(key)));
    },
    [canWrite, merge, spaceId, userId]
  );

  // Guides seen on this device before "seen" synced (or while it couldn't be
  // written) → one synced write. Nothing is written when nothing is missing.
  const synced = seen.available ? (seen.value ?? NONE_SEEN) : null;
  useEffect(() => {
    if (!synced || !canWrite) return;
    const missing = cachedSchedulingGuideEntries(resolveSpaceKey(spaceId)).filter(
      (entry) => !synced[entry]
    );
    if (missing.length > 0) write(missing);
  }, [synced, canWrite, spaceId, write]);

  // Rule on a request once the synced list is known: seen anywhere → drop it;
  // otherwise remember it as seen (cache now, synced write) and show it.
  useEffect(() => {
    if (!request || !ready) return;
    const entry = schedulingGuideEntry(request.kind, request.budgetId);
    cacheSchedulingGuideSeen(request);
    if (synced?.[entry]) {
      useSchedulingGuideStore.setState({ request: null });
      return;
    }
    write([entry]);
    useSchedulingGuideStore.setState({ request: null, pending: request.kind });
  }, [request, ready, synced, write]);

  // The trigger usually fires while the dialog that created the transaction is
  // still open (or stays open, e.g. Quick Add). Stacking a second modal on a
  // closing one locks the page, so wait until no other dialog is open.
  const [readyFor, setReadyFor] = useState<typeof pending>(null);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => {
      if (!document.querySelector('[role="dialog"][data-state="open"]')) {
        window.clearInterval(timer);
        setReadyFor(pending);
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [pending]);

  const dismiss = () => {
    setReadyFor(null);
    dismissGuide();
  };

  const showUpcoming = () => {
    setReadyFor(null);
    requestShowUpcoming();
    const target = accountId ? `/accounts/${accountId}` : '/accounts/all';
    if (location.pathname !== target) void navigate(target);
  };

  return (
    <Dialog
      open={pending !== null && readyFor === pending}
      onOpenChange={(open) => !open && dismiss()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            <Trans>Your transaction is dated in the future</Trans>
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>
                <Trans>
                  Registers show the date range at the top of the page, and the usual presets end
                  today, so future transactions are out of view. Pick <strong>Next 30 days</strong>{' '}
                  or <strong>Next 3 months</strong> in the date range to see them.
                </Trans>
              </p>
              <p>
                <Trans>
                  They don’t count toward today’s balance until their date, and the dashboard’s
                  Upcoming transactions card lists them as Scheduled.
                </Trans>
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={showUpcoming}>
            <Trans>Show the next 30 days</Trans>
          </Button>
          <Button onClick={dismiss}>
            <Trans>Got it</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
