import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Separator } from '@shared/ui/separator';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@shared/ui/dialog';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Loader2, Plus, RefreshCw } from 'lucide-react';
import { WorkspaceSharingPanel } from '@features/budget-sharing/ui/WorkspaceSharingPanel';
import { useActiveSpaceId, useAvailableSpaces, useRuntime } from '@shared/runtime/runtime-provider';
import {
  switchWorkspaceAndSyncBudgetState,
  syncBudgetStateFromRuntime,
} from '@shared/runtime/budget-gate';
import {
  BUDGET_SPACES_QUERY_KEY,
  getBudgetSpacesQueryOptions,
} from '@features/budget-sharing/lib/workspaces/queries';
import type { BudgetSpaceSummary } from '@shared/model/budget-spaces';
import { spaceApi } from '@shared/api/api-client';
import {
  getStoredDefaultSpaceId,
  setStoredDefaultSpaceId,
} from '@shared/runtime/workspace-preferences';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/ui/tooltip';
import { getErrorMessage } from '@shared/lib/errors';
import { toast } from 'sonner';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { useProfile } from '@entities/user/api/useAuth';
import { AccessLevel, canCreateWorkspace, getUserAccessStatus } from '@shared/model/access';
import { WorkspaceRow } from './components';

export default function WorkspaceSettingsPage() {
  // All hooks must be called before any early returns
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const activeSpaceId = useActiveSpaceId();
  const runtimeSpaces = useAvailableSpaces();
  const { data: profile } = useProfile();
  const accessStatus = useMemo(() => (profile ? getUserAccessStatus(profile) : null), [profile]);
  const isSelfHost = IS_SELF_HOSTABLE_BUILD;
  const isCollaboratorOnly = !isSelfHost && accessStatus?.level === AccessLevel.COLLABORATOR;
  const canCreateNewWorkspace = isSelfHost || canCreateWorkspace(accessStatus);
  const createWorkspaceTooltip = useMemo(() => {
    if (isSelfHost) {
      return null;
    }
    if (!accessStatus) {
      return 'Loading account access details…';
    }
    if (accessStatus.level === AccessLevel.COLLABORATOR) {
      return 'Shared collaborators can view the workspaces they are invited to. Upgrade to a paid plan to create your own.';
    }
    if (!canCreateNewWorkspace) {
      return 'Create or import your own workspace once you have an active subscription, trial, or free access.';
    }
    return null;
  }, [accessStatus, canCreateNewWorkspace, isSelfHost]);
  const [loadingSpaceId, setLoadingSpaceId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [editingSpace, setEditingSpace] = useState<BudgetSpaceSummary | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isUpdatingName, setIsUpdatingName] = useState(false);
  const [deletingSpace, setDeletingSpace] = useState<BudgetSpaceSummary | null>(null);
  const [isDeletingSpace, setIsDeletingSpace] = useState(false);
  const [defaultSpaceId, setDefaultSpaceId] = useState<string | null>(() =>
    getStoredDefaultSpaceId()
  );
  const spacesQuery = useQuery({
    ...getBudgetSpacesQueryOptions(),
    placeholderData: runtimeSpaces,
    enabled: true,
  });
  const spaces = spacesQuery.data ?? runtimeSpaces;

  useEffect(() => {
    if (editingSpace && !spaces.some((space) => space.space_id === editingSpace.space_id)) {
      setEditingSpace(null);
      setEditingName('');
    }
  }, [spaces, editingSpace]);

  useEffect(() => {
    if (
      defaultSpaceId &&
      !spaces.some(
        (space) =>
          space.space_id === defaultSpaceId &&
          space.invitation_status === 'accepted' &&
          space.is_accessible !== false
      )
    ) {
      setDefaultSpaceId(null);
      setStoredDefaultSpaceId(null);
    }
  }, [spaces, defaultSpaceId]);

  const { activeSpace, accessibleOtherSpaces, lockedAcceptedSpaces } = useMemo(() => {
    const accepted = spaces.filter((space) => space.invitation_status === 'accepted');
    const accessible = accepted.filter((space) => space.is_accessible !== false);
    const locked = accepted.filter((space) => space.is_accessible === false);
    const active = accessible.find((space) => space.space_id === activeSpaceId) ?? null;
    const others = accessible.filter((space) => space.space_id !== activeSpaceId);
    return { activeSpace: active, accessibleOtherSpaces: others, lockedAcceptedSpaces: locked };
  }, [spaces, activeSpaceId]);

  const pendingSpaces = spaces.filter((space) => space.invitation_status !== 'accepted');

  const handleSwitchSpace = async (spaceId: string) => {
    if (!spaceId || spaceId === activeSpaceId) return;
    try {
      setLoadingSpaceId(spaceId);
      await switchWorkspaceAndSyncBudgetState({
        runtime,
        queryClient,
        spaceId,
      });
      toast.success('Workspace switched', {
        description: 'You are now viewing this workspace.',
      });
    } catch (error) {
      const message = getErrorMessage(error, 'Unable to switch workspace. Please try again.');
      toast.error('Unable to switch workspace', {
        description: message,
      });
    } finally {
      setLoadingSpaceId(null);
    }
  };

  const handleRefreshSpaces = async () => {
    try {
      setIsRefreshing(true);
      await runtime.refreshSpaces();
      await spacesQuery.refetch();
      if (activeSpaceId) {
        await queryClient.invalidateQueries({ queryKey: ['space-invites', activeSpaceId] });
        await queryClient.invalidateQueries({ queryKey: ['space-members', activeSpaceId] });
      }
      toast.success('Workspace list refreshed', {
        description: 'Latest workspace information has been loaded.',
      });
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to refresh workspaces. Please try again.');
      toast.error('Refresh failed', {
        description: message,
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCreateSpace = async () => {
    const trimmed = newSpaceName.trim();
    if (!trimmed) {
      toast.error('Name required', {
        description: 'Enter a name before creating the workspace.',
      });
      return;
    }
    try {
      setIsCreating(true);
      const summary = await spaceApi.createSpace(trimmed);
      await runtime.refreshSpaces();
      await spacesQuery.refetch();
      toast.success('Workspace created', {
        description: 'We switched you to the new workspace automatically.',
      });
      setCreateDialogOpen(false);
      setNewSpaceName('');
      if (summary?.space_id) {
        await switchWorkspaceAndSyncBudgetState({
          runtime,
          queryClient,
          spaceId: summary.space_id,
        });
      }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to create workspace. Please try again.');
      toast.error('Creation failed', {
        description: message,
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleDefault = (space: BudgetSpaceSummary) => {
    if (space.invitation_status !== 'accepted' || space.is_accessible === false) return;
    const nextId = defaultSpaceId === space.space_id ? null : space.space_id;
    setDefaultSpaceId(nextId);
    setStoredDefaultSpaceId(nextId);
    if (nextId) {
      toast.success('Default workspace set', {
        description: 'We will open this workspace first next time.',
      });
    } else {
      toast.success('Default workspace cleared', {
        description: 'We will follow your workspace list order.',
      });
    }
  };

  const handleDeleteSpace = async () => {
    if (!deletingSpace) return;

    const spaceId = deletingSpace.space_id;
    const deletingActive = activeSpaceId === spaceId;
    const deletingDefault = defaultSpaceId === spaceId;

    try {
      setIsDeletingSpace(true);
      await spaceApi.deleteSpace(spaceId);

      if (deletingDefault) {
        setDefaultSpaceId(null);
        setStoredDefaultSpaceId(null);
      }

      await runtime.refreshSpaces();
      const refreshed = await spacesQuery.refetch();
      const refreshedSpaces = refreshed.data ?? [];

      await queryClient.invalidateQueries({ queryKey: BUDGET_SPACES_QUERY_KEY });
      queryClient.removeQueries({ queryKey: ['space-members', spaceId] });
      queryClient.removeQueries({ queryKey: ['space-invites', spaceId] });

      if (deletingActive) {
        const nextAccessibleSpace = refreshedSpaces.find(
          (space) =>
            space.space_id !== spaceId &&
            space.invitation_status === 'accepted' &&
            space.is_accessible !== false
        );

        if (nextAccessibleSpace) {
          await switchWorkspaceAndSyncBudgetState({
            runtime,
            queryClient,
            spaceId: nextAccessibleSpace.space_id,
          });
        } else {
          syncBudgetStateFromRuntime({
            runtime,
            queryClient,
            spaceId: null,
            candidateSelectedBudget: null,
          });
        }
      }

      toast.success('Workspace deleted', {
        description: deletingActive
          ? 'The workspace was deleted and your session was updated.'
          : 'The workspace and its data were deleted permanently.',
      });
      setDeletingSpace(null);
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to delete workspace. Please try again.');
      toast.error('Delete failed', {
        description: message,
      });
    } finally {
      setIsDeletingSpace(false);
    }
  };

  const handleStartEdit = (space: BudgetSpaceSummary) => {
    setEditingSpace(space);
    setEditingName(space.display_name || '');
  };

  const handleCancelEdit = () => {
    setEditingSpace(null);
    setEditingName('');
  };

  const handleSaveRename = async (space: BudgetSpaceSummary) => {
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === space.display_name) {
      setEditingSpace(null);
      setEditingName('');
      return;
    }
    try {
      setIsUpdatingName(true);
      await spaceApi.updateSpace(space.space_id, { display_name: trimmed });
      await runtime.refreshSpaces();
      await spacesQuery.refetch();
      toast.success('Workspace renamed', {
        description: 'The workspace name was updated successfully.',
      });
      setEditingSpace(null);
      setEditingName('');
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to rename workspace. Please try again.');
      toast.error('Rename failed', {
        description: message,
      });
    } finally {
      setIsUpdatingName(false);
    }
  };

  const renderSpaceRow = (space: BudgetSpaceSummary, isActive = false) => (
    <WorkspaceRow
      key={space.space_id}
      space={space}
      isActive={isActive}
      isDefault={defaultSpaceId === space.space_id}
      isLoading={loadingSpaceId === space.space_id}
      isEditing={editingSpace?.space_id === space.space_id}
      editingName={editingName}
      isUpdatingName={isUpdatingName}
      onEditingNameChange={setEditingName}
      onStartEdit={() => handleStartEdit(space)}
      onCancelEdit={handleCancelEdit}
      onSaveEdit={() => handleSaveRename(space)}
      onDelete={() => setDeletingSpace(space)}
      onSwitch={() => handleSwitchSpace(space.space_id)}
      onToggleDefault={() => handleToggleDefault(space)}
    />
  );

  return (
    <div className="container max-w-5xl mx-auto p-4 sm:p-6 pb-24 sm:pb-12 space-y-6 sm:space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Workspaces & Sharing</h1>
        <p className="text-sm text-muted-foreground">
          Switch between workspaces, review locked spaces, and manage invite access for the ones you
          can use right now.
        </p>
      </div>

      {!isSelfHost &&
      accessStatus &&
      !accessStatus.details.canAccessOwnedWorkspaces &&
      spaces.some(
        (space) =>
          space.role === 'owner' &&
          space.invitation_status === 'accepted' &&
          space.is_accessible === false
      ) ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200">
          Your own workspaces are locked because your Budgero plan is inactive. Subscribe again to
          regain access.
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Workspaces</CardTitle>
            <CardDescription>Switch to a different workspace or create a new one.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshSpaces}
              disabled={isRefreshing}
            >
              {isRefreshing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
            {!canCreateNewWorkspace ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="secondary" disabled>
                    <Plus className="mr-2 h-4 w-4" /> New Workspace
                  </Button>
                </TooltipTrigger>
                {createWorkspaceTooltip ? (
                  <TooltipContent align="end" className="max-w-xs text-sm">
                    {createWorkspaceTooltip}
                  </TooltipContent>
                ) : null}
              </Tooltip>
            ) : (
              <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="mr-2 h-4 w-4" /> New Workspace
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create workspace</DialogTitle>
                    <DialogDescription>
                      Give your workspace a descriptive name so collaborators know what it includes.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="workspace-name" className="text-sm font-medium">
                        Workspace name
                      </Label>
                      <Input
                        id="workspace-name"
                        value={newSpaceName}
                        onChange={(event) => setNewSpaceName(event.target.value)}
                        placeholder="Family budget"
                        autoFocus
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setCreateDialogOpen(false)}
                      disabled={isCreating}
                    >
                      Cancel
                    </Button>
                    <Button onClick={handleCreateSpace} disabled={isCreating} loading={isCreating}>
                      Create workspace
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {activeSpace ? renderSpaceRow(activeSpace, true) : null}
          {accessibleOtherSpaces.map((space) => renderSpaceRow(space))}
          {lockedAcceptedSpaces.length > 0 && (
            <div className="space-y-2">
              <Separator />
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Locked workspaces
              </p>
              <div className="space-y-2">
                {lockedAcceptedSpaces.map((space) => renderSpaceRow(space, false))}
              </div>
            </div>
          )}
          {pendingSpaces.length > 0 && (
            <div className="space-y-2">
              <Separator />
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Pending invitations
              </p>
              <div className="space-y-2">
                {pendingSpaces.map((space) => renderSpaceRow(space, false))}
              </div>
            </div>
          )}
          {spaces.length === 0 && (
            <div className="rounded-md border border-dashed border-border/80 p-4 text-sm text-muted-foreground">
              {isCollaboratorOnly
                ? 'No shared workspaces yet. Ask the workspace owner to send you an invite.'
                : 'No workspaces yet. Use the button above to create your first workspace.'}
            </div>
          )}
          {spacesQuery.isError ? (
            <div className="rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-800 dark:text-amber-200">
              Workspace access details may be stale right now. Refresh once you&apos;re back online.
            </div>
          ) : null}
        </CardContent>
      </Card>

      {activeSpace ? (
        <Card>
          <CardHeader>
            <CardTitle>Sharing & invitations</CardTitle>
            <CardDescription>
              Invite collaborators, manage pending invites, and control access for the active
              workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WorkspaceSharingPanel activeSpace={activeSpace} spaces={spaces} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Select or create a workspace to manage sharing options.
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(deletingSpace)}
        onOpenChange={(open) => {
          if (!open && !isDeletingSpace) {
            setDeletingSpace(null);
          }
        }}
        title="Delete workspace"
        description={
          deletingSpace ? (
            <>
              Delete{' '}
              <span className="font-semibold text-foreground">{deletingSpace.display_name}</span>{' '}
              permanently. This removes its data, members, invites, and backups. This action cannot
              be undone.
            </>
          ) : null
        }
        confirmText="Delete workspace"
        loadingText="Deleting..."
        variant="destructive"
        isLoading={isDeletingSpace}
        onConfirm={handleDeleteSpace}
      />
    </div>
  );
}
