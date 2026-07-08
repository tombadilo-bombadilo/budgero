// Landing page for workspace-invite URLs shaped like `/join#code=budg-xxxx`.
// The secret lives in the fragment, which browsers never send to servers —
// so the URL can travel through whatever channel the owner chose (mailto,
// SMS, carrier pigeon) without leaking the secret to our backend even when
// it's later loaded.
//
// Flow:
//   1. Extract the secret from window.location.hash, then scrub it from
//      the visible URL + history entry so back/forward doesn't expose it.
//   2. If the visitor isn't signed in, stash the secret and bounce to /auth.
//      A companion <SpaceInviteRedirect /> in StartupController re-routes
//      them back here once Clerk hands them off.
//   3. Sits inside StartupController so by the time we render, master
//      password is already unlocked and runtime is initialized — we just
//      need a one-click confirmation to redeem.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Loader2 } from 'lucide-react';
import { useOptionalClerkAuth, useProfile } from '@entities/user/api/useAuth';
import { useRedeemSpaceInvite } from '@features/budget-sharing/api/useBudgetSpaceSharing';
import { useSelfHostAuth } from '@shared/model/useSelfHostAuth';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { getErrorMessage } from '@shared/lib/errors';
import {
  clearPendingSpaceInvite,
  readPendingSpaceInvite,
  writePendingSpaceInvite,
} from '@features/budget-sharing/lib/pending-space-invite';
import { toast } from 'sonner';

function readCodeFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const code = params.get('code');
  return code && code.trim().length > 0 ? code.trim() : null;
}

function scrubFragment() {
  if (typeof window === 'undefined') return;
  try {
    window.history.replaceState(null, '', window.location.pathname);
  } catch {
    /* no-op */
  }
}

export default function JoinWorkspacePage() {
  const navigate = useNavigate();
  const { data: profile, isLoading: profileLoading } = useProfile();
  // Auth-loaded gate: useProfile is disabled until the user is signed in,
  // so we can't lean on profileLoading alone — for SaaS we have to wait
  // for Clerk to settle, otherwise we'd race-redirect a signed-in user to
  // /auth before their session resolves.
  const clerkAuth = useOptionalClerkAuth();
  const selfHostToken = useSelfHostAuth((state) => state.token);
  const authLoaded = IS_SELF_HOSTABLE_BUILD ? true : (clerkAuth?.isLoaded ?? false);
  const isSignedIn = IS_SELF_HOSTABLE_BUILD
    ? Boolean(selfHostToken)
    : Boolean(clerkAuth?.isSignedIn);

  // Resolve the secret once, on first mount. Fragment gets scrubbed so a
  // back-navigation or share of the current tab URL won't expose it.
  const [secret, setSecret] = useState<string | null>(() => {
    const fromHash = readCodeFromHash();
    if (fromHash) {
      scrubFragment();
      writePendingSpaceInvite(fromHash);
      return fromHash;
    }
    return readPendingSpaceInvite();
  });

  const [localError, setLocalError] = useState<string | null>(null);
  const redeemInvite = useRedeemSpaceInvite();

  // If the visitor isn't signed in yet, bounce them to /auth. The secret is
  // already in sessionStorage from the setState above, so the redirect
  // companion will bring them back here after login/signup. Wait for the
  // auth provider to actually settle before deciding — otherwise an
  // already-signed-in user gets bounced to /auth during Clerk's load.
  useEffect(() => {
    if (!secret) return;
    if (!authLoaded) return;
    if (!isSignedIn) {
      void navigate('/auth', { replace: true });
    }
  }, [authLoaded, isSignedIn, secret, navigate]);

  const handleRedeem = async () => {
    if (!secret) return;
    setLocalError(null);
    try {
      // Master password is already unlocked at this point (StartupController
      // gates upstream guarantee it). useRedeemSpaceInvite reads it from
      // MasterPasswordManager.get() when no override is passed.
      await redeemInvite.mutateAsync({ inviteSecret: secret });
      toast.success('Workspace joined', {
        description: 'You now have access to the shared budget space.',
      });
      clearPendingSpaceInvite();
      void navigate('/', { replace: true });
    } catch (err) {
      const message = getErrorMessage(err, 'Could not join workspace. Try again.');
      setLocalError(message);
    }
  };

  if (!secret) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>No invite code</CardTitle>
            <CardDescription>
              This join link is missing its invite code. Ask the workspace owner to resend the full
              link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate('/')}>Back to Budgero</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Wait for: auth to settle, profile fetch to finish (when signed in), and
  // a profile id to be present. We've already redirected to /auth above if
  // the user is unsigned, so reaching here without a profile means we're
  // mid-fetch.
  if (!authLoaded || (isSignedIn && (profileLoading || !profile?.id))) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Preparing your invite…</span>
        </div>
      </div>
    );
  }
  if (!isSignedIn || !profile?.id) {
    // Effect above is already navigating to /auth; render a minimal loader
    // for the brief window before the redirect resolves.
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Join a shared workspace</CardTitle>
          <CardDescription>
            Someone shared their Budgero workspace with you. Decrypt the space key on this device
            and add it to your account — the secret never leaves your browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Invite code
            </div>
            <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 p-3 font-mono text-xs break-all">
              {secret}
            </div>
          </div>
          {localError ? (
            <Alert variant="destructive">
              <AlertDescription>{localError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={() => {
                clearPendingSpaceInvite();
                setSecret(null);
                void navigate('/');
              }}
              disabled={redeemInvite.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleRedeem} disabled={redeemInvite.isPending} autoFocus>
              {redeemInvite.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Joining…
                </>
              ) : (
                'Join workspace'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
