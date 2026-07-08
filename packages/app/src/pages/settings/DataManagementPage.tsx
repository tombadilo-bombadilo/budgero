import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Download, Database, FileText, AlertTriangle, Inbox, Upload, BellRing } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useRuntime, useActiveSpace } from '@shared/runtime/runtime-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { Link } from 'react-router-dom';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { useProfile, useRecordBackup, useUpdateBackupSettings } from '@entities/user/api/useAuth';
import type { User } from '@shared/model/auth';
import type { BudgetSpaceSummary } from '@shared/model/budget-spaces';
import { getUserAccessStatus } from '@shared/model/access';
import { spaceApi } from '@shared/api/api-client';
import ExportDataCard from '@features/subscription/ui/ExportDataCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { FullScreenLoadingOverlay } from '@shared/ui/full-screen-loading-overlay';
import { getTodayISO, formatDateISO } from '@shared/lib/date-utils';
import { downloadBlob } from '@shared/lib/download';
import { getErrorMessage } from '@shared/lib/errors';
import { notifyUpdateRequired } from '@shared/lib/update-required';
import { formatBytes } from '@shared/lib/format-bytes';
import { SettingsPageHeader } from '@pages/settings/SettingsPageHeader';

export default function DataManagementPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const runtime = useRuntime();
  const activeSpace = useActiveSpace();
  const isOwner = activeSpace?.role === 'owner';
  const { data: profile } = useProfile();
  const accessStatus = profile ? getUserAccessStatus(profile) : null;
  const ownedRecoverySpacesQuery = useQuery({
    queryKey: ['data-management', 'spaces'],
    queryFn: () => spaceApi.listSpaces(),
    enabled: true,
    staleTime: 30_000,
  });
  const dbSizeQuery = useQuery({
    queryKey: ['data-management', 'db-size'],
    queryFn: async () => {
      const db = runtime.getDatabase();
      if (!db) return null;
      const data = await db.backup();
      return data.byteLength;
    },
    staleTime: 30_000,
  });
  const updateBackupSettings = useUpdateBackupSettings();
  const recordBackup = useRecordBackup();
  const [backupFrequency, setBackupFrequency] = useState(
    String(profile?.backup_reminder_frequency_days ?? 7)
  );
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedExportSpaceId, setSelectedExportSpaceId] = useState<string | null>(null);

  const ownedRecoverySpaces = (ownedRecoverySpacesQuery.data ?? []).filter(
    (space) => space.invitation_status === 'accepted' && space.role === 'owner'
  );
  const lockedOwnerRecoveryMode =
    accessStatus?.details.canAccessOwnedWorkspaces === false && ownedRecoverySpaces.length > 0;

  useEffect(() => {
    if (typeof profile?.backup_reminder_frequency_days === 'number') {
      setBackupFrequency(String(profile.backup_reminder_frequency_days));
    }
  }, [profile?.backup_reminder_frequency_days]);

  useEffect(() => {
    if (!lockedOwnerRecoveryMode) {
      setSelectedExportSpaceId(null);
      return;
    }

    const preferredSpaceId =
      (activeSpace?.role === 'owner' ? activeSpace.space_id : null) ??
      profile?.primary_space_id ??
      ownedRecoverySpaces[0]?.space_id ??
      null;
    const hasCurrentSelection = selectedExportSpaceId
      ? ownedRecoverySpaces.some((space) => space.space_id === selectedExportSpaceId)
      : false;

    if (!hasCurrentSelection && preferredSpaceId) {
      setSelectedExportSpaceId(preferredSpaceId);
    }
  }, [
    activeSpace,
    lockedOwnerRecoveryMode,
    ownedRecoverySpaces,
    profile?.primary_space_id,
    selectedExportSpaceId,
  ]);

  const lastBackupDisplay = (() => {
    const last = profile?.last_user_db_backup;
    return last ? new Date(last).toLocaleString() : 'No backups yet';
  })();
  const isSavingFrequency = updateBackupSettings.isPending;
  const disableFrequencyControls = isSavingFrequency || isExporting || isRestoring;
  const canRestoreWorkspace = isOwner && accessStatus?.details.canAccessOwnedWorkspaces === true;

  const selectedExportSpace =
    ownedRecoverySpaces.find((space) => space.space_id === selectedExportSpaceId) ?? null;

  const workspaceFilenameTag = (space: { display_name?: string; space_id: string } | null) => {
    const raw = space?.display_name?.trim() || space?.space_id || 'workspace';
    const slug = raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return slug || 'workspace';
  };

  const handleSaveFrequency = async () => {
    const parsed = parseInt(backupFrequency, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      toast.error('Reminder frequency must be at least 1 day');
      return;
    }
    const normalized = Math.min(parsed, 365);
    try {
      await updateBackupSettings.mutateAsync({ frequency_days: normalized });
      setBackupFrequency(String(normalized));
      toast.success('Backup reminder updated');
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to update backup reminder');
      toast.error(message);
    }
  };

  const handleDownloadDatabase = async () => {
    setIsExporting(true);
    try {
      const services = runtime.services();
      const dbData = await services.export.exportDatabase();

      const backupAt = new Date();
      const timestamp = formatDateISO(backupAt);
      const filename = `budgero-${workspaceFilenameTag(activeSpace)}-${timestamp}.db`;

      downloadBlob(dbData, filename, 'application/x-sqlite3');
      toast.success('Database exported successfully');
      try {
        await recordBackup.mutateAsync();
      } catch (recordError) {
        console.warn('Failed to record database backup time', recordError);
        queryClient.setQueryData<User | undefined>(['profile'], (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            last_user_db_backup: backupAt.toISOString(),
          };
        });
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error, 'Failed to export database');
      toast.error(errorMessage);
      console.error('Database export error:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadCSV = async () => {
    setIsExporting(true);
    try {
      const services = runtime.services();
      const csvFiles = await services.export.exportCSV();

      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();

      Object.entries(csvFiles).forEach(([filename, content]) => {
        if (content) {
          zip.file(filename, content);
        }
      });

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const timestamp = getTodayISO();
      const filename = `budgero-${workspaceFilenameTag(activeSpace)}-csv-${timestamp}.zip`;

      downloadBlob(zipBlob, filename, 'application/zip');
      toast.success('CSV files exported successfully');
    } catch (error) {
      const errorMessage = getErrorMessage(error, 'Failed to export CSV files');
      toast.error(errorMessage);
      console.error('CSV export error:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!canRestoreWorkspace) {
      toast.error('Restore is unavailable while your workspace access is locked.');
      return;
    }
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.db') && !file.name.endsWith('.sqlite')) {
        toast.error('Please select a valid database file (.db or .sqlite)');
        return;
      }
      setSelectedFile(file);
      setShowRestoreDialog(true);
    }
  };

  const handleRestoreDatabase = async () => {
    if (!canRestoreWorkspace) {
      toast.error('Restore is unavailable while your workspace access is locked.');
      return;
    }
    if (!selectedFile) return;

    setShowRestoreDialog(false);
    setIsRestoring(true);

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);

      const db = runtime.getDatabase();
      if (!db) {
        throw new Error('Database is not available');
      }

      // Hot swap the database, then bring an older backup up to the current
      // schema (raw restore would leave the app operating on a stale schema).
      if (!db.restoreAndMigrate) {
        throw new Error('This build cannot migrate restored backups');
      }
      await db.restoreAndMigrate(data);

      await queryClient.invalidateQueries();

      // Finalize restore as out-of-band snapshot replacement.
      try {
        await runtime.finalizeOutOfBandMutation({ uploadSnapshot: true });
      } catch (uploadError) {
        console.warn('Failed to finalize out-of-band restore sync:', uploadError);
        // Continue anyway - local restore was successful
      }

      toast.success('Database restored successfully!');
    } catch (error) {
      // Backup file from a newer app version — its schema is ahead of this
      // build; prompt for an update instead of a generic failure.
      if ((error as { code?: string })?.code === 'DB_NEWER_THAN_APP') {
        notifyUpdateRequired('restore-newer-than-app');
      }
      const errorMessage = getErrorMessage(error, 'Failed to restore database');
      toast.error(errorMessage);
      console.error('Database restore error:', error);
    } finally {
      setIsRestoring(false);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="container max-w-4xl mx-auto p-4 sm:p-6 pb-20 sm:pb-6 space-y-6 sm:space-y-8">
      <SettingsPageHeader
        title="Data Management"
        description="Export backups, restore snapshots, and manage your budget data"
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5" />
            Backup Reminders
          </CardTitle>
          <CardDescription>
            Stay covered if data ever corrupts or you lose your master password—we&apos;ll remind
            you to keep a fresh backup on hand.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Last backup</p>
                <p className="font-semibold text-foreground">{lastBackupDisplay}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Database size</p>
                <p className="font-semibold text-foreground">
                  {dbSizeQuery.isLoading
                    ? 'Calculating…'
                    : dbSizeQuery.data != null
                      ? formatBytes(dbSizeQuery.data)
                      : 'Unavailable'}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="backup-frequency">Reminder frequency (days)</Label>
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  id="backup-frequency"
                  type="number"
                  min={1}
                  max={365}
                  value={backupFrequency}
                  onChange={(event) => setBackupFrequency(event.target.value)}
                  disabled={disableFrequencyControls}
                  className="sm:max-w-[160px]"
                />
                <Button
                  type="button"
                  onClick={handleSaveFrequency}
                  disabled={disableFrequencyControls}
                >
                  {isSavingFrequency ? 'Saving…' : 'Save'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                We&apos;ll prompt you again when a backup is overdue.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Import Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-4 w-4" />
            Import Data
          </CardTitle>
          <CardDescription>
            Imports now live on their own page so you can manage history and undo runs.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <p className="text-sm text-muted-foreground">
            Head to the Imports page to upload CSV/PDF files, review past imports, and undo anything
            that looks off.
          </p>
          <Button asChild variant="outline">
            <Link to="/settings/imports">Open Imports</Link>
          </Button>
        </CardContent>
      </Card>

      {/* Export Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export Data
          </CardTitle>
          <CardDescription>Download your data for backup or analysis</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {lockedOwnerRecoveryMode ? (
            <LockedOwnerExportRecovery
              spaces={ownedRecoverySpaces}
              selectedSpaceId={selectedExportSpaceId}
              onSelectSpace={setSelectedExportSpaceId}
            />
          ) : (
            <div className="flex flex-col sm:flex-row gap-4">
              {(['sqlite', 'csv'] as const).map((type) => {
                const disabled = !isOwner || isExporting || isRestoring;
                const label = isExporting
                  ? 'Exporting...'
                  : type === 'sqlite'
                    ? 'Download SQLite Database'
                    : 'Download CSV Files';

                if (!disabled) {
                  return (
                    <Button
                      key={type}
                      variant="outline"
                      className="flex-1"
                      onClick={type === 'sqlite' ? handleDownloadDatabase : handleDownloadCSV}
                    >
                      {type === 'sqlite' ? (
                        <Database className="h-4 w-4 mr-2" />
                      ) : (
                        <FileText className="h-4 w-4 mr-2" />
                      )}
                      {label}
                    </Button>
                  );
                }

                return (
                  <Popover key={type}>
                    <PopoverTrigger asChild>
                      <span className="flex-1 block" tabIndex={0} role="button">
                        <Button variant="outline" className="pointer-events-none w-full" disabled>
                          {type === 'sqlite' ? (
                            <Database className="h-4 w-4 mr-2" />
                          ) : (
                            <FileText className="h-4 w-4 mr-2" />
                          )}
                          {label}
                        </Button>
                      </span>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="text-sm max-w-xs">
                      Shared collaborators can’t export workspace data. Ask the workspace owner to
                      download it for you.
                    </PopoverContent>
                  </Popover>
                );
              })}
            </div>
          )}
          {lockedOwnerRecoveryMode && selectedExportSpace ? (
            <div className="rounded-lg border p-4">
              <ExportDataCard embedded spaceId={selectedExportSpace.space_id} />
            </div>
          ) : null}
          <div className="text-sm text-muted-foreground space-y-2">
            <p>
              Exports cover only the currently active workspace
              {activeSpace?.display_name ? (
                <>
                  {' '}
                  (<strong>{activeSpace.display_name}</strong>)
                </>
              ) : null}
              . Switch workspaces and export again to back up the others.
            </p>
            <p>
              <strong>SQLite Database:</strong> Downloads the complete database file that can be
              imported into other SQLite-compatible tools or used as a backup.
            </p>
            <p>
              <strong>CSV Files:</strong> Downloads individual CSV files for each table (budgets,
              accounts, transactions, etc.) that can be opened in spreadsheet applications.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Restore Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Restore Database
          </CardTitle>
          <CardDescription>Restore from a database backup file</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".db,.sqlite"
            onChange={handleFileSelect}
            className="hidden"
          />
          {(() => {
            const disabled = !canRestoreWorkspace || isRestoring || isExporting;
            const label = isRestoring ? 'Restoring...' : 'Restore from Database File';

            if (!disabled) {
              return (
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {label}
                </Button>
              );
            }

            return (
              <Popover>
                <PopoverTrigger asChild>
                  <span className="block w-full sm:w-auto" tabIndex={0} role="button">
                    <Button
                      variant="outline"
                      className="pointer-events-none w-full"
                      type="button"
                      disabled
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      {label}
                    </Button>
                  </span>
                </PopoverTrigger>
                <PopoverContent align="start" className="text-sm max-w-xs">
                  {!isOwner
                    ? 'Only the workspace owner can restore a Budgero Core backup into this workspace.'
                    : 'Restore is unavailable while your workspace access is locked. Subscribe again to unlock owned workspace changes.'}
                </PopoverContent>
              </Popover>
            );
          })()}
          <div className="text-sm text-muted-foreground space-y-2">
            <p className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
              <span>
                <strong>Warning:</strong> Restore replaces the data in the currently active
                workspace
                {activeSpace?.display_name ? (
                  <>
                    {' '}
                    (<strong>{activeSpace.display_name}</strong>)
                  </>
                ) : null}{' '}
                — on this device and on the server. Other workspaces are not affected. This action
                cannot be undone, so export this workspace first if you want a backup.
              </span>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Restore Confirmation Dialog */}
      <ConfirmDialog
        open={showRestoreDialog}
        onOpenChange={setShowRestoreDialog}
        icon={<AlertTriangle className="h-5 w-5 text-destructive" />}
        title="Confirm Database Restore"
        description={
          <span className="block space-y-3">
            <p className="font-semibold text-foreground">
              This will permanently replace the data in{' '}
              {activeSpace?.display_name ? (
                <>
                  workspace <span className="font-semibold">{activeSpace.display_name}</span>
                </>
              ) : (
                'the currently active workspace'
              )}
              .
            </p>
            <p>
              You are about to restore from:{' '}
              <span className="font-mono text-xs">{selectedFile?.name}</span>
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>
                Budgets, accounts, transactions, and categories in this workspace will be replaced
              </li>
              <li>The change will also be pushed to the server for this workspace</li>
              <li>Your other workspaces are not affected</li>
              <li>This action CANNOT be undone</li>
            </ul>
            <p className="font-semibold text-destructive">
              Are you absolutely sure you want to continue?
            </p>
          </span>
        }
        confirmText="Yes, Replace All Data"
        variant="destructive"
        onConfirm={() => {
          void handleRestoreDatabase();
        }}
      />

      {/* Loading Overlay */}
      {isRestoring && (
        <FullScreenLoadingOverlay
          title="Restoring Database"
          description="Please wait while we restore your data..."
          footnote="Do not close this window"
        />
      )}
    </div>
  );
}

function LockedOwnerExportRecovery({
  spaces,
  selectedSpaceId,
  onSelectSpace,
}: {
  spaces: BudgetSpaceSummary[];
  selectedSpaceId: string | null;
  onSelectSpace: (spaceId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-dashed p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          Your owned workspaces are locked for edits until you resubscribe, but you can still export
          their data here for recovery or migration.
        </p>
        <div className="space-y-2 max-w-md">
          <Label htmlFor="export-workspace">Workspace to export</Label>
          <Select value={selectedSpaceId ?? ''} onValueChange={onSelectSpace}>
            <SelectTrigger id="export-workspace" className="w-full">
              <SelectValue placeholder="Choose a workspace" />
            </SelectTrigger>
            <SelectContent>
              {spaces.map((space) => (
                <SelectItem key={space.space_id} value={space.space_id}>
                  {space.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          Export stays available. Restore and other workspace changes remain locked until access is
          active again.
        </p>
      </div>
    </div>
  );
}
