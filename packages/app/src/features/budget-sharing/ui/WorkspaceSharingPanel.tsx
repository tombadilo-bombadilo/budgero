import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  MailPlus,
  ShieldCheck,
  Trash2,
  UserMinus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import { Separator } from '@shared/ui/separator';
import type { BudgetSpaceSummary, BudgetSpaceInvite } from '@shared/model/budget-spaces';
import {
  useCancelSpaceInvite,
  useCreateSpaceInvite,
  useOwnedWorkspaceSeatUsage,
  useRemoveSpaceMember,
  useSpaceInvites,
  useSpaceMembers,
} from '@features/budget-sharing/api/useBudgetSpaceSharing';
import { trackSharedBudget } from '@shared/lib/analytics/analytics';
import { buildInviteMailto, buildJoinUrl } from '@features/budget-sharing/lib/workspace-invites';
import { copyWithToast } from '@features/budget-sharing/lib/copy-with-toast';
import { toastError } from '@shared/lib/errors';
import { RedeemInviteDialog } from '@features/budget-sharing/ui/RedeemInviteDialog';

const DEFAULT_INVITE_EXPIRY_DAYS = 7;

interface WorkspaceSharingPanelProps {
  activeSpace: BudgetSpaceSummary | null;
  spaces: BudgetSpaceSummary[];
}

export function WorkspaceSharingPanel({ activeSpace, spaces }: WorkspaceSharingPanelProps) {
  const spaceId = activeSpace?.space_id ?? null;
  const isOwner = activeSpace?.role === 'owner';

  const { data: membersData, isLoading: membersLoading } = useSpaceMembers(spaceId);
  const { data: invitesData, isLoading: invitesLoading } = useSpaceInvites(spaceId, isOwner);

  const members = useMemo(() => (Array.isArray(membersData) ? membersData : []), [membersData]);
  const invites = useMemo(() => (Array.isArray(invitesData) ? invitesData : []), [invitesData]);

  const createInvite = useCreateSpaceInvite(spaceId);
  const cancelInvite = useCancelSpaceInvite(spaceId);
  const removeMember = useRemoveSpaceMember(spaceId);
  const [latestInvite, setLatestInvite] = useState<BudgetSpaceInvite | null>(null);
  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false);

  // Reset invite when space changes - use setState during render pattern
  const prevSpaceIdRef = useRef(activeSpace?.space_id);
  if (prevSpaceIdRef.current !== activeSpace?.space_id) {
    prevSpaceIdRef.current = activeSpace?.space_id;
    if (!activeSpace?.space_id && latestInvite !== null) {
      setLatestInvite(null);
    }
  }

  const handleCreateInvite = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!spaceId) return;

    const expiresAt = new Date(
      Date.now() + DEFAULT_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    try {
      const invite = await createInvite.mutateAsync({ expiresAt });
      setLatestInvite(invite);
      trackSharedBudget();
      toast.success('Invite ready', {
        description: 'Copy the link or open it in your email client to share.',
      });
    } catch (error) {
      toastError('Invite failed', error, 'Failed to create invite. Please try again.');
    }
  };

  const handleCopySecret = (secret: string) =>
    copyWithToast(secret, {
      successTitle: 'Copied!',
      successDescription: 'Invite secret copied to clipboard.',
      errorTitle: 'Copy failed',
      errorDescription: 'Unable to copy the invite secret. Copy it manually.',
    });

  const handleCopyLink = (secret: string) =>
    copyWithToast(buildJoinUrl(secret), {
      successTitle: 'Link copied',
      successDescription: 'Share it with your collaborator. The secret never reaches our server.',
      errorTitle: 'Copy failed',
      errorDescription: 'Unable to copy the invite link. Copy it manually.',
    });

  const handleCancelInvite = async (inviteId: string) => {
    try {
      await cancelInvite.mutateAsync(inviteId);
      toast.success('Invite cancelled', {
        description: 'The invite has been revoked.',
      });
    } catch (error) {
      toastError('Unable to cancel invite', error, 'Unable to cancel invite right now.');
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    try {
      await removeMember.mutateAsync(memberId);
      toast.success('Member removed', {
        description: 'The member no longer has access to this workspace.',
      });
    } catch (error) {
      toastError('Unable to remove member', error, 'Unable to remove member right now.');
    }
  };

  const pendingInvites = useMemo(
    () => invites.filter((invite) => invite.status === 'pending'),
    [invites]
  );
  const ownedSpaceIds = useMemo(
    () =>
      spaces
        .filter(
          (space) =>
            space.role === 'owner' &&
            space.invitation_status === 'accepted' &&
            space.is_accessible !== false
        )
        .map((space) => space.space_id),
    [spaces]
  );
  const seatUsage = useOwnedWorkspaceSeatUsage(ownedSpaceIds, spaceId, members, invites, isOwner);

  const invitesNeedingBundles = useMemo(
    () => pendingInvites.filter((invite) => !invite.encrypted_bundle),
    [pendingInvites]
  );

  return (
    <div className="space-y-4">
      <RedeemInviteDialog open={redeemDialogOpen} onOpenChange={setRedeemDialogOpen} />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <span>Workspace Sharing</span>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setRedeemDialogOpen(true)}>
          Redeem Invite
        </Button>
      </div>

      {isOwner ? (
        <div className="space-y-4 rounded-lg border border-border/60 bg-muted/10 p-3">
          <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-3 py-2 text-xs text-muted-foreground">
            <span>
              Collaborator seats used across your owned workspaces:{' '}
              <span className="font-medium text-foreground">
                {seatUsage.isLoading ? 'Loading…' : `${seatUsage.occupiedSlots}/5`}
              </span>
            </span>
            <span>
              {seatUsage.isLoading ? 'Checking…' : `${seatUsage.remainingSlots} remaining`}
            </span>
          </div>
          <form className="space-y-3" onSubmit={handleCreateInvite}>
            <p className="text-xs text-muted-foreground">
              Generate a fresh invite secret. Invites expire automatically after{' '}
              {DEFAULT_INVITE_EXPIRY_DAYS} days. You can use up to 5 collaborator seats across all
              of your owned workspaces, counting accepted members and pending invites together.
            </p>
            <Button
              type="submit"
              disabled={createInvite.isPending || seatUsage.sharingLimitReached}
              loading={createInvite.isPending}
              className="w-full"
            >
              {createInvite.isPending ? (
                'Generating invite…'
              ) : (
                <>
                  <MailPlus className="h-4 w-4" />
                  Create Invite
                </>
              )}
            </Button>
          </form>

          {seatUsage.sharingLimitReached ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              Your account has reached the 5-person collaborator limit across owned workspaces.
              Remove a member or cancel a pending invite before creating another one.
            </div>
          ) : null}

          {latestInvite && (
            <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-3 text-xs">
              <div className="mb-2 flex items-center gap-2 font-medium text-primary">
                <CheckCircle2 className="h-4 w-4" />
                <span>Invite ready — share the link below</span>
              </div>
              <div className="rounded-md bg-background px-3 py-2 font-mono text-xs break-all">
                {buildJoinUrl(latestInvite.invite_secret)}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  onClick={() => handleCopyLink(latestInvite.invite_secret)}
                >
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Copy link
                </Button>
                <Button type="button" size="sm" variant="outline" asChild>
                  <a
                    href={buildInviteMailto({
                      secret: latestInvite.invite_secret,
                      url: buildJoinUrl(latestInvite.invite_secret),
                    })}
                  >
                    <MailPlus className="mr-2 h-3.5 w-3.5" />
                    Open in email
                  </a>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => handleCopySecret(latestInvite.invite_secret)}
                >
                  Copy code only
                </Button>
              </div>
              <p className="mt-2 text-muted-foreground">
                Budgero never sees this secret — but whatever channel you share through will. For
                the strongest privacy, hand it over in person or via an end-to-end encrypted app
                (Signal, iMessage, WhatsApp). We can’t show this code again, so capture it now.
              </p>
            </div>
          )}

          {invitesNeedingBundles.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                <span>Pending invites still need their encrypted bundle.</span>
              </div>
              <p className="mt-1">
                Try cancelling and re-creating the invite if this warning persists.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/20 p-3 text-sm text-muted-foreground">
          Only workspace owners can create new invites. Ask an owner to share access with teammates.
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <MailPlus className="h-4 w-4" />
          <span>Pending invites</span>
        </div>
        <Separator />
        {invitesLoading ? (
          <div className="text-xs text-muted-foreground">Loading invites…</div>
        ) : pendingInvites.length === 0 ? (
          <div className="text-xs text-muted-foreground">No pending invitations.</div>
        ) : (
          <div className="space-y-2">
            {pendingInvites.map((invite) => (
              <div
                key={invite.id}
                className="rounded-md border border-border/60 bg-background px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                    <Badge
                      variant="outline"
                      className="font-mono text-[11px] break-all !whitespace-pre-wrap !shrink text-muted-foreground"
                    >
                      ••••••••••••••••
                    </Badge>
                    <Badge variant={invite.encrypted_bundle ? 'secondary' : 'destructive'}>
                      {invite.encrypted_bundle ? 'Bundle ready' : 'Missing bundle'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive"
                      onClick={() => handleCancelInvite(invite.id)}
                      disabled={cancelInvite.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-muted-foreground">
                  {invite.invitee_email && <span>{invite.invitee_email}</span>}
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {invite.expires_at ? new Date(invite.expires_at).toLocaleString() : 'No expiry'}
                  </span>
                  <span>Status: {invite.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Users className="h-4 w-4" />
          <span>Members</span>
        </div>
        <Separator />
        {membersLoading ? (
          <div className="text-xs text-muted-foreground">Loading members…</div>
        ) : members.length === 0 ? (
          <div className="text-xs text-muted-foreground">No members yet.</div>
        ) : (
          <div className="space-y-2">
            {members.map((member) => {
              return (
                <div
                  key={member.user_id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium break-words">
                      {member.user_name || member.user_email}
                    </div>
                    <div className="text-xs text-muted-foreground break-all">
                      {member.user_email} • {member.role}
                    </div>
                    {member.role !== 'owner' ? (
                      <div className="text-xs text-muted-foreground">
                        Status: {member.invitation_status}
                      </div>
                    ) : null}
                  </div>

                  {isOwner && member.role !== 'owner' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive"
                      onClick={() => handleRemoveMember(member.user_id)}
                    >
                      <UserMinus className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Badge variant="outline" className="shrink-0 text-[11px]">
                      {member.role === 'owner' ? 'Owner' : member.role}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
