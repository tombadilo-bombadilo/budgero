import { Trans } from '@lingui/react/macro';
import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSchedulingGuideStore } from '@shared/store/useSchedulingGuideStore';
import { Button } from '@shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';

/**
 * Explains, once per budget, where a future-dated transaction went: registers
 * follow the date range, and its presets end today. Recurring transactions
 * are covered by the Recurring page guide instead.
 */
export function SchedulingGuideDialog() {
  const pending = useSchedulingGuideStore((state) => state.pending);
  const dismissGuide = useSchedulingGuideStore((state) => state.dismiss);
  const requestShowUpcoming = useSchedulingGuideStore((state) => state.requestShowUpcoming);
  const location = useLocation();
  const navigate = useNavigate();

  const accountId = useSchedulingGuideStore((state) => state.accountId);

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
