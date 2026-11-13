import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useState } from 'react';
import type { CustomDashboard } from '@budgero/core/browser';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { getErrorMessage } from '@shared/lib/errors';
import { Download, Home, HousePlus, MoreHorizontal, Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { dashboardDisplayName } from '@widgets/dashboard/builtin/builtin-cards';

interface DashboardSwitcherProps {
  dashboards: CustomDashboard[];
  activeDashboardId: string | null;
  onSelectDashboard: (dashboardId: string) => void;
  onCreateDashboard: (name: string) => Promise<void>;
  onRenameDashboard: (dashboardId: string, name: string) => Promise<void>;
  onDeleteDashboard: (dashboardId: string) => Promise<void>;
  /** Download every widget's CSV (in the "…" menu). */
  onExportAll?: () => void;
  exportDisabled?: boolean;
  /** Show this dashboard on the home page. */
  onUseAsHome?: (dashboardId: string) => Promise<void>;
  /** Stop showing it on the home page (the home goes back to what it was). */
  onStopUsingAsHome?: (dashboardId: string) => Promise<void>;
}

export function DashboardSwitcher({
  dashboards,
  activeDashboardId,
  onSelectDashboard,
  onCreateDashboard,
  onRenameDashboard,
  onDeleteDashboard,
  onExportAll,
  exportDisabled = false,
  onUseAsHome,
  onStopUsingAsHome,
}: DashboardSwitcherProps) {
  const { t } = useLingui();

  const activeDashboard =
    dashboards.find((dashboard) => dashboard.id === activeDashboardId) ?? null;
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [createName, setCreateName] = useState('My Dashboard');
  const [renameName, setRenameName] = useState('');
  const [pendingAction, setPendingAction] = useState<'create' | 'rename' | 'delete' | null>(null);

  useEffect(() => {
    if (!renameOpen) return;
    setRenameName(activeDashboard ? dashboardDisplayName(activeDashboard) : '');
  }, [renameOpen, activeDashboard]);

  useEffect(() => {
    if (!createOpen) return;
    setCreateName('My Dashboard');
  }, [createOpen]);

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name) {
      toast.error(t`Dashboard name cannot be empty`);
      return;
    }
    setPendingAction('create');
    try {
      await onCreateDashboard(name);
      setCreateOpen(false);
    } catch (error) {
      toast.error(getErrorMessage(error, t`Failed to create dashboard`));
    } finally {
      setPendingAction(null);
    }
  };

  const handleRename = async () => {
    if (!activeDashboard) return;
    const nextName = renameName.trim();
    if (!nextName) {
      toast.error(t`Dashboard name cannot be empty`);
      return;
    }
    if (nextName === dashboardDisplayName(activeDashboard)) {
      setRenameOpen(false);
      return;
    }
    setPendingAction('rename');
    try {
      await onRenameDashboard(activeDashboard.id, nextName);
      setRenameOpen(false);
    } catch (error) {
      toast.error(getErrorMessage(error, t`Failed to rename dashboard`));
    } finally {
      setPendingAction(null);
    }
  };

  const handleHome = async (dashboardId: string, makeHome: boolean) => {
    const action = makeHome ? onUseAsHome : onStopUsingAsHome;
    if (!action) return;
    try {
      await action(dashboardId);
      toast.success(
        makeHome
          ? t`The home page now shows this dashboard`
          : t`The home page no longer shows this dashboard`
      );
    } catch {
      // The action already reported it.
    }
  };

  const handleDelete = async () => {
    if (!activeDashboard) return;
    setPendingAction('delete');
    try {
      await onDeleteDashboard(activeDashboard.id);
      setDeleteOpen(false);
    } catch (error) {
      toast.error(getErrorMessage(error, t`Failed to delete dashboard`));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Select
        value={activeDashboardId ?? ''}
        onValueChange={onSelectDashboard}
        disabled={dashboards.length === 0}
      >
        <SelectTrigger className="min-w-0 flex-1 sm:w-[240px] sm:flex-none">
          <SelectValue placeholder={t`Select dashboard`} />
        </SelectTrigger>
        <SelectContent>
          {dashboards.map((dashboard) => (
            <SelectItem key={dashboard.id} value={dashboard.id}>
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="truncate">{dashboardDisplayName(dashboard)}</span>
                {dashboard.isHome && (
                  <>
                    <Home className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                    <span className="sr-only">
                      <Trans>(home page)</Trans>
                    </span>
                  </>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover open={createOpen} onOpenChange={setCreateOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" disabled={pendingAction !== null}>
            <Trans>
              <Plus className="h-4 w-4 mr-1" />
              New
            </Trans>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              <Trans>Create dashboard</Trans>
            </p>
            <p className="text-xs text-muted-foreground">
              <Trans>Name your new custom dashboard.</Trans>
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-dashboard-name">
              <Trans>Name</Trans>
            </Label>
            <Input
              id="new-dashboard-name"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder={t`My Dashboard`}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(false)}
              disabled={pendingAction === 'create'}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              size="sm"
              onClick={() => void handleCreate()}
              disabled={pendingAction === 'create'}
            >
              {pendingAction === 'create' ? t`Creating...` : t`Create`}
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Rename / Delete / Export live in one "…" menu; their forms open next to it. */}
      <Popover open={deleteOpen} onOpenChange={setDeleteOpen}>
        <PopoverAnchor asChild>
          <span className="inline-flex">
            <Popover open={renameOpen} onOpenChange={setRenameOpen}>
              <PopoverAnchor asChild>
                <span className="inline-flex">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-8 p-0"
                        aria-label={t`Dashboard actions`}
                        disabled={!activeDashboard || pendingAction !== null}
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setTimeout(() => setRenameOpen(true), 0)}>
                        <Pencil className="h-4 w-4" aria-hidden />
                        <Trans>Rename</Trans>
                      </DropdownMenuItem>
                      {activeDashboard && !activeDashboard.isHome && onUseAsHome && (
                        <DropdownMenuItem
                          onSelect={() => void handleHome(activeDashboard.id, true)}
                        >
                          <HousePlus className="h-4 w-4" aria-hidden />
                          <Trans>Use as home page</Trans>
                        </DropdownMenuItem>
                      )}
                      {activeDashboard?.isHome && onStopUsingAsHome && (
                        <DropdownMenuItem
                          onSelect={() => void handleHome(activeDashboard.id, false)}
                        >
                          <Home className="h-4 w-4" aria-hidden />
                          <Trans>Stop using as home page</Trans>
                        </DropdownMenuItem>
                      )}
                      {onExportAll && (
                        <DropdownMenuItem disabled={exportDisabled} onSelect={onExportAll}>
                          <Download className="h-4 w-4" aria-hidden />
                          <Trans>Export CSVs</Trans>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => setTimeout(() => setDeleteOpen(true), 0)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                        <Trans>Delete</Trans>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              </PopoverAnchor>
              <PopoverContent align="end" className="w-80 space-y-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    <Trans>Rename dashboard</Trans>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <Trans>
                      Update the name for{' '}
                      <span className="font-medium">
                        {activeDashboard ? dashboardDisplayName(activeDashboard) : ''}
                      </span>
                      .
                    </Trans>
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rename-dashboard-name">
                    <Trans>Name</Trans>
                  </Label>
                  <Input
                    id="rename-dashboard-name"
                    value={renameName}
                    onChange={(event) => setRenameName(event.target.value)}
                    placeholder={t`Dashboard name`}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRenameOpen(false)}
                    disabled={pendingAction === 'rename'}
                  >
                    <Trans>Cancel</Trans>
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void handleRename()}
                    disabled={pendingAction === 'rename'}
                  >
                    {pendingAction === 'rename' ? t`Saving...` : t`Save`}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </span>
        </PopoverAnchor>
        <PopoverContent align="end" className="w-80 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              <Trans>Delete dashboard</Trans>
            </p>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Delete{' '}
                <span className="font-medium">
                  {activeDashboard ? dashboardDisplayName(activeDashboard) : ''}
                </span>
                ? This removes all widgets on it.
              </Trans>
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteOpen(false)}
              disabled={pendingAction === 'delete'}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleDelete()}
              disabled={pendingAction === 'delete'}
            >
              {pendingAction === 'delete' ? t`Deleting...` : t`Delete`}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
