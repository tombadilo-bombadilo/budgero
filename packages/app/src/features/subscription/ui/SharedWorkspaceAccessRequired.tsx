import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CreditCard, LifeBuoy, LockKeyhole } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { useLogout } from '@entities/user/api/useAuth';

interface SharedWorkspaceAccessRequiredProps {
  mode?: 'shared-locked' | 'subscription-required';
}

export default function SharedWorkspaceAccessRequired({
  mode = 'shared-locked',
}: SharedWorkspaceAccessRequiredProps) {
  const logout = useLogout();
  const isSharedLocked = mode === 'shared-locked';

  const eyebrow = isSharedLocked ? 'Shared Workspace Unavailable' : 'Access Required';
  const title = isSharedLocked
    ? 'The workspace owner needs to renew access'
    : 'Your Budgero plan is inactive';
  const description = isSharedLocked
    ? 'You still have a shared workspace membership, but that workspace is locked because the owner no longer has an active Budgero plan.'
    : 'Your own workspaces are locked because your Budgero plan is no longer active. Subscribe again to regain access.';
  const primaryCardTitle = isSharedLocked
    ? 'Ask the owner to resubscribe'
    : 'Subscribe to unlock your workspaces';
  const primaryCardBody = isSharedLocked
    ? 'Once the workspace owner renews their plan, your shared workspace access comes back automatically.'
    : 'Resubscribing restores access to your owned workspaces immediately and lets you create new ones again.';
  const secondaryCardTitle = isSharedLocked
    ? 'Subscribe to unlock your own workspaces'
    : 'Review workspace status';
  const PrimaryIcon = isSharedLocked ? LifeBuoy : CreditCard;
  const SecondaryIcon = isSharedLocked ? CreditCard : LockKeyhole;
  const stillAvailableTitle = isSharedLocked
    ? 'What you can still do'
    : 'What is still available right now';
  const stillAvailableItems: ReactNode[] = isSharedLocked
    ? [
        <>
          Open{' '}
          <Link to="/settings/workspaces" className="underline underline-offset-2">
            workspace settings
          </Link>{' '}
          to see which shared workspaces are locked.
        </>,
        <>
          Manage your{' '}
          <Link to="/settings/subscription" className="underline underline-offset-2">
            subscription
          </Link>{' '}
          and resubscribe at any time.
        </>,
        <>
          Open{' '}
          <Link to="/settings/account" className="underline underline-offset-2">
            account settings
          </Link>{' '}
          and sign out normally.
        </>,
      ]
    : [
        <>
          Manage your{' '}
          <Link to="/settings/subscription" className="underline underline-offset-2">
            subscription
          </Link>{' '}
          and resubscribe at any time.
        </>,
        <>
          Open{' '}
          <Link to="/settings/workspaces" className="underline underline-offset-2">
            workspace settings
          </Link>{' '}
          to review locked workspaces and any shared access you still have.
        </>,
        <>
          Open{' '}
          <Link to="/settings/account" className="underline underline-offset-2">
            account settings
          </Link>{' '}
          and download your exports from{' '}
          <Link to="/settings/data" className="underline underline-offset-2">
            data management
          </Link>
          .
        </>,
      ];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 pb-20 md:pb-4">
      <Card className="w-full max-w-2xl border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10">
        <CardHeader className="space-y-4">
          <div className="flex items-center gap-3 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-6 w-6" />
            <span className="text-sm font-medium uppercase tracking-[0.2em]">{eyebrow}</span>
          </div>
          <div className="space-y-2">
            <CardTitle className="text-3xl tracking-tight">{title}</CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              {description}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 rounded-xl border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <PrimaryIcon className="h-4 w-4" />
                {primaryCardTitle}
              </div>
              <p>{primaryCardBody}</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <SecondaryIcon className="h-4 w-4" />
                {secondaryCardTitle}
              </div>
              <p>
                {isSharedLocked ? (
                  <>
                    If you subscribe, you can immediately regain access to your own workspaces and
                    create new ones from{' '}
                    <Link to="/settings/subscription" className="underline underline-offset-2">
                      subscription settings
                    </Link>
                    .
                  </>
                ) : (
                  <>
                    Open{' '}
                    <Link to="/settings/workspaces" className="underline underline-offset-2">
                      workspace settings
                    </Link>{' '}
                    to review locked workspaces and any shared access that is still available to
                    you.
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/70 p-4">
            <div className="mb-3 text-sm font-medium text-foreground">{stillAvailableTitle}</div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {stillAvailableItems.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild className="sm:flex-1">
              <Link to="/settings/subscription">Subscribe now</Link>
            </Button>
            <Button asChild variant="outline" className="sm:flex-1">
              <Link to="/settings/workspaces">View workspace status</Link>
            </Button>
          </div>

          <Button
            type="button"
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={() => logout.mutate()}
          >
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
