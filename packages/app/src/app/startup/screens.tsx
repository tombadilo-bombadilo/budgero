import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Alert, AlertDescription } from '@shared/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@shared/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@shared/ui/accordion';
import SharedWorkspaceAccessRequired from '@features/subscription/ui/SharedWorkspaceAccessRequired';
import BudgetWizard from '@features/budget-management';
import {
  Loader2,
  ShieldCheck,
  NotebookPen,
  UploadCloud,
  HardDriveDownload,
  Wifi,
  AlertTriangle,
  CheckCircle,
  Circle,
  ArrowRightLeft,
  Users,
} from 'lucide-react';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { getErrorMessage } from '@shared/lib/errors';
import { useLogout, useUpdateOnboarding } from '@entities/user/api/useAuth';
import { useRedeemSpaceInvite } from '@features/budget-sharing/api/useBudgetSpaceSharing';
import { useUiStore } from '@shared/store/useUiStore';
import { useOnboardingState } from '@features/onboarding/api/useOnboardingState';
import { spaceApi } from '@shared/api/api-client';
import { BUDGET_SPACES_QUERY_KEY } from '@features/budget-sharing/lib/workspaces/queries';
import { toast } from 'sonner';
import { AccessLevel, type AccessStatus } from '@shared/model/access';
import type { User } from '@shared/model/auth';
import type { BudgetSpaceSummary } from '@shared/model/budget-spaces';
import OnboardingFlow from '@pages/onboarding/OnboardingFlow';
import type { MasterPasswordStartupSnapshot, WorkspaceStartupSnapshot } from './hooks';
import { StartupLayout } from './StartupLayout';

interface StartupSplashScreenProps {
  message?: string;
  detail?: string;
}

export function StartupSplashScreen({ message, detail }: StartupSplashScreenProps) {
  return (
    <div className="budgero-route-loader">
      <img className="budgero-route-loader__logo" src="/logo_128.png" alt="Budgero logo" />
      <p className="budgero-route-loader__text">{message ?? 'Preparing Budgero…'}</p>
      <div className="budgero-route-loader__progress" aria-hidden="true" />
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

export function AccessBlockedScreen({ mode }: { mode: 'shared-locked' | 'subscription-required' }) {
  return <SharedWorkspaceAccessRequired mode={mode} />;
}

export function IntroRequiredScreen({ acknowledgeIntro }: { acknowledgeIntro: () => void }) {
  return <OnboardingFlow onComplete={acknowledgeIntro} />;
}

const PASSWORD_RULES = [
  { key: 'length', label: 'At least 12 characters', test: (p: string) => p.length >= 12 },
  { key: 'upper', label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { key: 'lower', label: 'One lowercase letter', test: (p: string) => /[a-z]/.test(p) },
  { key: 'number', label: 'One number', test: (p: string) => /\d/.test(p) },
  {
    key: 'special',
    label: 'One special character (!@#$%...)',
    test: (p: string) => /[^A-Za-z0-9]/.test(p),
  },
] as const;

function PasswordRequirement({ met, label }: { met: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      {met ? (
        <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
      ) : (
        <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
      )}
      <span className={met ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}>
        {label}
      </span>
    </li>
  );
}

function MasterPasswordForm({ snapshot }: { snapshot: MasterPasswordStartupSnapshot }) {
  const showSetup = !snapshot.isOffline && snapshot.isFirstTimeSetup;
  const password = snapshot.inputPassword;
  const allRulesMet = showSetup && PASSWORD_RULES.every((r) => r.test(password));
  const passwordsMatch = password.length > 0 && password === snapshot.confirmPassword;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void snapshot.submit();
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="startup-master-password">Master Password</Label>
        <Input
          id="startup-master-password"
          type="password"
          value={snapshot.inputPassword}
          onChange={(event) => snapshot.setInputPassword(event.target.value)}
          placeholder="Enter your master password"
          autoFocus
        />
      </div>
      {showSetup ? (
        <>
          <ul className="space-y-1.5 rounded-lg border border-border/60 bg-muted/30 p-3">
            {PASSWORD_RULES.map((rule) => (
              <PasswordRequirement key={rule.key} met={rule.test(password)} label={rule.label} />
            ))}
          </ul>
          <div className="space-y-2">
            <Label htmlFor="startup-master-password-confirm">Confirm Master Password</Label>
            <Input
              id="startup-master-password-confirm"
              type="password"
              value={snapshot.confirmPassword}
              onChange={(event) => snapshot.setConfirmPassword(event.target.value)}
              placeholder="Confirm your master password"
            />
            {snapshot.confirmPassword.length > 0 ? (
              <div className="flex items-center gap-2 text-xs">
                {passwordsMatch ? (
                  <>
                    <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="text-emerald-600 dark:text-emerald-400">Passwords match</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-amber-600 dark:text-amber-400">
                      Passwords do not match
                    </span>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
      {snapshot.error ? (
        <Alert variant="destructive">
          <AlertDescription>{snapshot.error}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        type="submit"
        className="w-full"
        disabled={showSetup && (!allRulesMet || !passwordsMatch)}
      >
        {showSetup ? 'Set Master Password' : 'Unlock'}
      </Button>
    </form>
  );
}

function MasterPasswordResetDialog({ snapshot }: { snapshot: MasterPasswordStartupSnapshot }) {
  return (
    <Dialog
      open={snapshot.showResetDialog}
      onOpenChange={(open) => {
        if (snapshot.isResetting) return;
        snapshot.setShowResetDialog(open);
        if (!open) snapshot.setResetConfirmation('');
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" type="button" className="w-full text-destructive">
          Reset Budgero
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset Budgero?</DialogTitle>
          <DialogDescription>
            This permanently deletes your encrypted budgets and queued sync state. This cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Type RESET to confirm that you want to wipe local and server state.
            </AlertDescription>
          </Alert>
          <div className="space-y-2">
            <Label htmlFor="startup-reset-confirm">Type RESET to confirm</Label>
            <Input
              id="startup-reset-confirm"
              value={snapshot.resetConfirmation}
              onChange={(event) => snapshot.setResetConfirmation(event.target.value.toUpperCase())}
              placeholder="RESET"
              disabled={snapshot.isResetting}
            />
          </div>
          {snapshot.resetError ? (
            <Alert variant="destructive">
              <AlertDescription>{snapshot.resetError}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => snapshot.setShowResetDialog(false)}
            disabled={snapshot.isResetting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void snapshot.confirmReset()}
            disabled={snapshot.isResetting || snapshot.resetConfirmation !== 'RESET'}
          >
            {snapshot.isResetting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Resetting...
              </>
            ) : (
              'Delete everything'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MasterPasswordRequiredScreen({
  snapshot,
}: {
  snapshot: MasterPasswordStartupSnapshot;
}) {
  const logout = useLogout();

  if (!snapshot.isOffline && snapshot.isFirstTimeSetup) {
    return (
      <StartupLayout currentStep={1}>
        <Card>
          <CardHeader>
            <CardTitle>Create Your Master Password</CardTitle>
            <CardDescription>
              This is the encryption key for all your financial data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <MasterPasswordForm snapshot={snapshot} />
            <Accordion
              type="single"
              collapsible
              className="rounded-lg border border-border/60 bg-muted/30 px-4"
            >
              <AccordionItem value="why">
                <AccordionTrigger>Why do I need a master password?</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  Your master password encrypts all your financial data before it ever leaves your
                  device. We never see or store it, only you can unlock your budgets. Even if our
                  servers were compromised, your data stays completely private.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="login">
                <AccordionTrigger>How is this different from my login?</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  Your login credentials verify your identity with our server. Your master password
                  is a separate encryption key that scrambles your data on your device. You can
                  reset your master password, but doing so permanently destroys all existing
                  encrypted data, there is no way to carry it over.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="forget">
                <AccordionTrigger>What happens if I forget it?</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  Your encrypted data is permanently lost. You can reset your master password to
                  start fresh, but all previous budgets and history will be wiped. Choose something
                  strong and store it safely, a password manager is a great option.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      </StartupLayout>
    );
  }

  const title = 'Enter Master Password';
  const description = snapshot.isOffline
    ? 'Unlock to decrypt your budget data (offline mode)'
    : 'Your master password is required to decrypt your budget data';

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
            <Button onClick={() => logout.mutate()} variant="ghost" className="text-gray-500">
              Sign Out
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {snapshot.passwordChangedRemotely ? (
            <Alert className="mb-4">
              <ShieldCheck className="h-4 w-4" />
              <AlertDescription>
                Your master password changed on another device. Enter the new password to continue.
              </AlertDescription>
            </Alert>
          ) : null}
          <MasterPasswordForm snapshot={snapshot} />
          <MasterPasswordResetDialog snapshot={snapshot} />
        </CardContent>
      </Card>
    </div>
  );
}

function workspaceMessage(accessStatus: AccessStatus | null, isSelfHost: boolean) {
  if (isSelfHost) {
    return 'Create your first workspace to start storing budgets on this instance.';
  }
  if (accessStatus?.level === AccessLevel.COLLABORATOR) {
    return 'Redeem a shared invite or upgrade to create your own workspace.';
  }
  return 'You need an active subscription, trial, or free access before creating a workspace.';
}

export function WorkspaceRequiredScreen({
  snapshot,
  profile,
  accessStatus,
}: {
  snapshot: WorkspaceStartupSnapshot;
  profile: User | undefined;
  accessStatus: AccessStatus | null;
}) {
  const logout = useLogout();
  const queryClient = useQueryClient();
  const isSelfHost = IS_SELF_HOSTABLE_BUILD;
  const { allowWorkspaceCreation } = snapshot;
  const [inviteDialogOpen, setInviteDialogOpen] = React.useState(false);
  const [inviteSecret, setInviteSecret] = React.useState('');
  const [masterPassword, setMasterPassword] = React.useState('');
  const [redeemError, setRedeemError] = React.useState<string | null>(null);
  const [userEditedName, setUserEditedName] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const redeemInvite = useRedeemSpaceInvite();
  const defaultWorkspaceName = React.useMemo(() => {
    const rawName = (profile?.name ?? '').trim();
    if (!rawName) return 'Personal Budget Space';
    const first = rawName.split(/\s+/)[0] ?? 'My';
    return `${first}'s Budget Space`;
  }, [profile?.name]);
  const workspaceName = userEditedName ?? defaultWorkspaceName;
  const createWorkspace = useMutation({
    mutationFn: (displayName: string) => spaceApi.createSpace(displayName),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: BUDGET_SPACES_QUERY_KEY });
      toast.success('Workspace created');
    },
    onError: (error: Error) => {
      setFormError(error.message || 'Unable to create workspace.');
    },
  });

  const handleCreate = async () => {
    const trimmed = workspaceName.trim();
    if (!trimmed) {
      setFormError('Enter a name for your workspace.');
      return;
    }
    setFormError(null);
    await createWorkspace.mutateAsync(trimmed);
  };

  const handleRedeemInvite = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const trimmedSecret = inviteSecret.trim();
    if (!trimmedSecret) {
      setRedeemError('Enter the invite secret you received.');
      return;
    }

    setRedeemError(null);
    try {
      await redeemInvite.mutateAsync({
        inviteSecret: trimmedSecret,
        masterPassword: masterPassword || undefined,
      });
      toast.success('Workspace joined');
      setInviteDialogOpen(false);
      setInviteSecret('');
      setMasterPassword('');
      await queryClient.invalidateQueries({ queryKey: BUDGET_SPACES_QUERY_KEY });
    } catch (error) {
      setRedeemError(
        getErrorMessage(error, 'Unable to redeem invite. Double-check the secret and try again.')
      );
    }
  };

  if (snapshot.status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Unable to load workspaces</CardTitle>
            <CardDescription>{snapshot.error}</CardDescription>
          </CardHeader>
          <CardFooter className="flex gap-3">
            <Button onClick={() => void snapshot.spacesQuery.refetch()}>Retry</Button>
            <Button variant="ghost" onClick={() => logout.mutate()}>
              Sign Out
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (!allowWorkspaceCreation) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>No workspace available</CardTitle>
            <CardDescription>{workspaceMessage(accessStatus, isSelfHost)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>Redeem a shared invite to regain access instantly.</p>
          </CardContent>
          <CardFooter className="flex flex-col gap-3 sm:flex-row">
            <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="secondary">Redeem invite</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Redeem shared workspace access</DialogTitle>
                  <DialogDescription>
                    Enter the invite secret you received from the workspace owner.
                  </DialogDescription>
                </DialogHeader>
                <form className="space-y-4" onSubmit={handleRedeemInvite}>
                  <div className="space-y-2">
                    <Label htmlFor="workspace-invite-secret">Invite secret</Label>
                    <Input
                      id="workspace-invite-secret"
                      value={inviteSecret}
                      onChange={(event) => setInviteSecret(event.target.value)}
                      placeholder="budg-xxxx-xxxx"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="workspace-invite-master">Master password</Label>
                    <Input
                      id="workspace-invite-master"
                      type="password"
                      value={masterPassword}
                      onChange={(event) => setMasterPassword(event.target.value)}
                      placeholder="Your Budgero master password"
                    />
                  </div>
                  {redeemError ? <p className="text-sm text-destructive">{redeemError}</p> : null}
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setInviteDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={redeemInvite.isPending || !inviteSecret.trim()}>
                      {redeemInvite.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Redeem invite
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
            <Button variant="ghost" onClick={() => logout.mutate()}>
              Sign Out
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <StartupLayout currentStep={2}>
      <Card>
        <CardHeader>
          <CardTitle>Create Your Workspace</CardTitle>
          <CardDescription>
            A workspace keeps your budgets, accounts, and collaborators organized in one place.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
            <Users className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="font-medium text-foreground">One subscription, up to 5 people</p>
              <p className="mt-1 text-muted-foreground">
                Invite your partner, family, or friends to share a workspace, they get full access
                without needing their own subscription.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="workspace-name">Workspace name</Label>
            <Input
              id="workspace-name"
              value={workspaceName}
              onChange={(event) => setUserEditedName(event.target.value)}
              placeholder="Personal Budget Space"
            />
          </div>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <Accordion
            type="single"
            collapsible
            className="rounded-lg border border-border/60 bg-muted/30 px-4"
          >
            <AccordionItem value="what">
              <AccordionTrigger>What is a workspace?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                A workspace organizes your budgets and lets you share them with others. Think of it
                as a shared folder, everything inside is accessible to anyone you invite.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="share">
              <AccordionTrigger>How do I invite someone?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                We&apos;ll walk you through sharing your workspace once you&apos;ve set up your
                first budget. You can always find it later under{' '}
                <span className="font-medium text-foreground">Settings &rarr; Workspaces</span>.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="multiple">
              <AccordionTrigger>Can I have more than one workspace?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                Absolutely. You might keep a personal workspace and a shared household one. Each
                workspace is independently encrypted and completely separate.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            onClick={() => void handleCreate()}
            disabled={createWorkspace.isPending}
          >
            {createWorkspace.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating workspace...
              </>
            ) : (
              'Create Workspace'
            )}
          </Button>
        </CardFooter>
      </Card>
    </StartupLayout>
  );
}

const BUDGET_SOURCES = [
  {
    key: 'manual' as const,
    icon: NotebookPen,
    title: 'Start fresh',
    description: 'Create a new budget from scratch',
  },
  {
    key: 'import' as const,
    icon: UploadCloud,
    title: 'Import from YNAB',
    description: 'Bring your categories, accounts, and history',
  },
  {
    key: 'core' as const,
    icon: HardDriveDownload,
    title: 'Restore backup',
    description: 'Upload a Budgero database backup',
  },
] as const;

export function BudgetRequiredScreen({
  alternativeWorkspaces,
  switchingWorkspaceId,
  onSwitchWorkspace,
}: {
  alternativeWorkspaces: BudgetSpaceSummary[];
  switchingWorkspaceId: string | null;
  onSwitchWorkspace: (spaceId: string) => void;
}) {
  const { status: onboardingStatus } = useOnboardingState();
  const { mutateAsync: updateOnboardingAsync } = useUpdateOnboarding();
  const isBudgetImporting = useUiStore((state) => state.isBudgetImporting);
  const notifiedYnabIntentRef = React.useRef(false);
  const [selectedSource, setSelectedSource] = React.useState<'manual' | 'core' | 'import' | null>(
    null
  );

  const handleBudgetModeChange = React.useCallback(
    (mode: 'manual' | 'core' | 'import') => {
      if (mode !== 'import' || notifiedYnabIntentRef.current) {
        return;
      }
      if (onboardingStatus === 'completed' || onboardingStatus === 'dismissed') {
        notifiedYnabIntentRef.current = true;
        return;
      }
      notifiedYnabIntentRef.current = true;
      void updateOnboardingAsync({ status: 'dismissed', snoozed_until: null }).catch(() => {
        notifiedYnabIntentRef.current = false;
      });
    },
    [onboardingStatus, updateOnboardingAsync]
  );

  const handleBudgetCreated = React.useCallback(() => {
    toast.success('Budget created');
  }, []);

  if (!selectedSource) {
    return (
      <StartupLayout currentStep={3}>
        <Card>
          <CardHeader>
            <CardTitle>Create Your First Budget</CardTitle>
            <CardDescription>How would you like to get started?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {BUDGET_SOURCES.map((source) => {
              const Icon = source.icon;
              return (
                <button
                  key={source.key}
                  type="button"
                  onClick={() => setSelectedSource(source.key)}
                  className="flex w-full items-center gap-4 rounded-lg border border-border/60 bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{source.title}</p>
                    <p className="text-xs text-muted-foreground">{source.description}</p>
                  </div>
                </button>
              );
            })}
            {alternativeWorkspaces.length > 0 ? (
              <div className="space-y-2 border-t border-border/60 pt-3">
                <p className="text-xs text-muted-foreground">
                  Or open one of your other workspaces instead:
                </p>
                {alternativeWorkspaces.map((workspace) => {
                  const isSwitching = switchingWorkspaceId === workspace.space_id;
                  return (
                    <div
                      key={workspace.space_id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {workspace.display_name || 'Unnamed workspace'}
                        </div>
                        <div className="text-xs text-muted-foreground">Role: {workspace.role}</div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isSwitching}
                        onClick={() => onSwitchWorkspace(workspace.space_id)}
                      >
                        {isSwitching ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <ArrowRightLeft className="mr-2 h-4 w-4" />
                        )}
                        Switch
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </StartupLayout>
    );
  }

  return (
    <StartupLayout currentStep={3}>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>
                {selectedSource === 'manual' && 'Create a New Budget'}
                {selectedSource === 'import' && 'Import from YNAB'}
                {selectedSource === 'core' && 'Restore Budgero Backup'}
              </CardTitle>
              <CardDescription>
                {selectedSource === 'manual' &&
                  'Fill in the details below to set up your first budget.'}
                {selectedSource === 'import' &&
                  'Bring your YNAB data into Budgero without re-entering anything.'}
                {selectedSource === 'core' &&
                  'Upload a Budgero database file to restore your data.'}
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 text-muted-foreground"
              onClick={() => setSelectedSource(null)}
            >
              Back
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <BudgetWizard
            onCreated={handleBudgetCreated}
            onModeChange={handleBudgetModeChange}
            defaultTab={selectedSource}
            hideHeader
          />
          {isBudgetImporting ? (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Importing your budget...
            </div>
          ) : null}
        </CardContent>
      </Card>
    </StartupLayout>
  );
}

export function BudgetBlockedScreen({
  alternativeWorkspaces,
  switchingWorkspaceId,
  onSwitchWorkspace,
}: {
  alternativeWorkspaces: BudgetSpaceSummary[];
  switchingWorkspaceId: string | null;
  onSwitchWorkspace: (spaceId: string) => void;
}) {
  const logout = useLogout();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>This workspace has no budgets yet</CardTitle>
          <CardDescription>
            Only a workspace owner can create the first budget here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border/70 bg-muted/30 p-4 text-sm text-muted-foreground">
            Ask an owner to create a budget in this workspace, or switch to another workspace you
            can already access.
          </div>
          {alternativeWorkspaces.length > 0 ? (
            <div className="space-y-3">
              <div className="text-sm font-medium text-foreground">Other available workspaces</div>
              <div className="space-y-2">
                {alternativeWorkspaces.map((workspace) => {
                  const isSwitching = switchingWorkspaceId === workspace.space_id;
                  return (
                    <div
                      key={workspace.space_id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {workspace.display_name || 'Unnamed workspace'}
                        </div>
                        <div className="text-xs text-muted-foreground">Role: {workspace.role}</div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isSwitching}
                        onClick={() => onSwitchWorkspace(workspace.space_id)}
                      >
                        {isSwitching ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <ArrowRightLeft className="mr-2 h-4 w-4" />
                        )}
                        Switch
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No other accessible workspaces are available right now.
            </p>
          )}
        </CardContent>
        <CardFooter className="flex gap-3">
          <Button variant="ghost" onClick={() => logout.mutate()}>
            Sign Out
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export function StartupErrorScreen({ error, onRetry }: { error: string; onRetry: () => void }) {
  const logout = useLogout();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Budgero couldn&apos;t finish starting</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardFooter className="flex gap-3">
          <Button onClick={onRetry}>Retry startup</Button>
          <Button variant="ghost" onClick={() => logout.mutate()}>
            Sign Out
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export function StartupSyncStatus({
  phase,
  message,
}: {
  phase: 'hidden' | 'syncing' | 'warning' | 'complete';
  message: string;
}) {
  if (phase === 'hidden') return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 rounded-full border bg-background/95 px-4 py-2 shadow-sm backdrop-blur">
      <div className="flex items-center gap-2 text-sm">
        {phase === 'complete' ? (
          <CheckCircle className="h-4 w-4 text-emerald-500" />
        ) : phase === 'warning' ? (
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        ) : (
          <Wifi className="h-4 w-4 animate-pulse text-primary" />
        )}
        <span>{message}</span>
      </div>
    </div>
  );
}
