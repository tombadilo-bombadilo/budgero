// Surfaces invite links the user generated during onboarding once they
// land on the dashboard. The onboarding apply pipeline persists results
// to sessionStorage under PENDING_ONBOARDING_INVITES_KEY; this dialog
// reads them, shows copy + mailto buttons, and clears storage on dismiss.
//
// We intentionally do NOT host this UI inside OnboardingFlow itself —
// flipping the various "you're done" flags during apply (master password
// status, onboarding-completed, intro acknowledged) makes the StartupController
// gate hierarchy unmount the onboarding screen mid-render, racing the
// success state. Persisting to sessionStorage and rendering on the
// dashboard-mounted dialog sidesteps that entirely.

import { useEffect, useState } from 'react';
import { Copy, MailPlus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { buildInviteMailto, buildJoinUrl } from '@features/budget-sharing/lib/workspace-invites';
import { copyWithToast } from '@features/budget-sharing/lib/copy-with-toast';

export const PENDING_ONBOARDING_INVITES_KEY = 'pendingOnboardingInvites';
// Apply pipeline dispatches this on window after writing to sessionStorage,
// so a dashboard-mounted dialog that pre-mounted to empty storage can
// still pick up the invites without a page reload.
export const PENDING_ONBOARDING_INVITES_EVENT = 'budgero:onboarding-invites-ready';

interface PendingInvite {
  email: string;
  secret: string;
  url: string;
}

function readPending(): PendingInvite[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(PENDING_ONBOARDING_INVITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is PendingInvite =>
        typeof x?.email === 'string' && typeof x?.secret === 'string' && typeof x?.url === 'string'
    );
  } catch {
    return [];
  }
}

function clearPending() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(PENDING_ONBOARDING_INVITES_KEY);
  } catch {
    /* no-op */
  }
}

function InviteRow({ invite }: { invite: PendingInvite }) {
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const url = invite.url || buildJoinUrl(invite.secret);
  const mailto = buildInviteMailto({ to: invite.email, secret: invite.secret, url });

  const copy = (value: string, kind: 'link' | 'code') =>
    copyWithToast(value, {
      successTitle: kind === 'link' ? 'Link copied' : 'Code copied',
      errorTitle: 'Could not copy. Copy manually from the field above.',
      onCopied: () => {
        setCopied(kind);
        window.setTimeout(() => setCopied(null), 1400);
      },
    });

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-medium">{invite.email}</span>
        <span className="text-xs font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
          Ready
        </span>
      </div>
      <div className="rounded-md border border-dashed border-muted-foreground/30 bg-background px-3 py-2 font-mono text-xs break-all">
        {url}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => void copy(url, 'link')}>
          <Copy className="mr-2 h-3.5 w-3.5" />
          {copied === 'link' ? 'Copied!' : 'Copy link'}
        </Button>
        <Button type="button" size="sm" variant="outline" asChild>
          <a href={mailto}>
            <MailPlus className="mr-2 h-3.5 w-3.5" />
            Open in email
          </a>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void copy(invite.secret, 'code')}
        >
          {copied === 'code' ? 'Code copied!' : 'Copy code only'}
        </Button>
      </div>
    </div>
  );
}

export default function OnboardingInviteShareDialog() {
  // Lazy-init from sessionStorage so a refreshed-tab dashboard immediately
  // shows the dialog without waiting for an effect. For the in-flow case
  // (apply writes after we mount) the effect below subscribes to the
  // custom event the apply pipeline dispatches.
  const [initialInvites] = useState<PendingInvite[]>(readPending);
  const [invites, setInvites] = useState<PendingInvite[]>(initialInvites);
  const [open, setOpen] = useState<boolean>(() => initialInvites.length > 0);

  useEffect(() => {
    const sync = () => {
      const pending = readPending();
      if (pending.length === 0) return;
      setInvites(pending);
      setOpen(true);
    };
    // Also check once after mount — if the apply pipeline finished writing
    // between our state initializer and this effect attaching, we'd miss it
    // otherwise.
    sync();
    window.addEventListener(PENDING_ONBOARDING_INVITES_EVENT, sync);
    return () => window.removeEventListener(PENDING_ONBOARDING_INVITES_EVENT, sync);
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      clearPending();
      setInvites([]);
    }
    setOpen(next);
  };

  if (invites.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share these invite links</DialogTitle>
          <DialogDescription>
            Each link contains a one-time secret that unlocks your shared workspace.{' '}
            <span className="font-medium text-foreground">Budgero never sees it</span> — but
            whatever channel you use to share will. For the strongest privacy, hand the link off in
            person or through an end-to-end encrypted app (Signal, iMessage, WhatsApp). Plain email
            works too — just remember your email provider can read what you send.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {invites.map((invite) => (
            <InviteRow key={invite.secret} invite={invite} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Once you close this dialog the secrets are gone from Budgero. You can regenerate fresh
          invites any time from{' '}
          <span className="font-medium text-foreground">Settings → Workspaces</span>.
        </p>
        <DialogFooter>
          <Button onClick={() => handleOpenChange(false)}>I’ve shared them — done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
