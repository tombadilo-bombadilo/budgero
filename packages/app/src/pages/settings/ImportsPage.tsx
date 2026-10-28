'use client';

import { plural } from '@lingui/core/macro';

import { Trans, useLingui } from '@lingui/react/macro';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { CSVPDFImportDialog } from '@features/import/ui/csv-pdf-dialog';
import { useUiStore } from '@shared/store/useUiStore';
import {
  useDeleteImportRun,
  useImportHistory,
  useUndoImportRun,
} from '@features/import/api/useImportHistory';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { toast } from 'sonner';
import { AlertTriangle, Inbox, Trash2, Undo2, Upload as UploadIcon } from 'lucide-react';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { formatUtcTimestamp } from '@shared/lib/date-utils';
import { getErrorMessage } from '@shared/lib/errors';
import { InlineLoadingRow } from '@shared/ui/InlineLoadingRow';
import { SUPPORTED_IMPORT_FORMATS_LABEL } from '@features/import/lib/constants';
import { SettingsPageHeader } from '@pages/settings/SettingsPageHeader';

type PendingAction =
  | { type: 'undo'; id: number; label: string }
  | { type: 'delete'; id: number; label: string }
  | null;

export default function ImportsPage() {
  const { t } = useLingui();

  const { selectedBudget } = useUiStore();
  const budgetId = selectedBudget?.ID ?? 0;
  const { data: history = [], isLoading } = useImportHistory(budgetId);
  const undoMutation = useUndoImportRun();
  const deleteMutation = useDeleteImportRun();
  const [pendingAction, setPendingAction] = React.useState<PendingAction>(null);

  const handleConfirm = async () => {
    if (!pendingAction || budgetId <= 0) {
      setPendingAction(null);
      return;
    }

    try {
      if (pendingAction.type === 'undo') {
        const result = await undoMutation.mutateAsync({ id: pendingAction.id, budgetId });
        if (result.alreadyUndone) {
          toast.info(t`Import already undone`);
        } else {
          toast.success(t`Import undone`, {
            description: t`Removed ${result.transactionsRemoved} transactions${
              result.accountsRemoved
                ? plural(result.accountsRemoved, {
                    one: `, # account`,
                    other: `, # accounts`,
                  })
                : ''
            }${
              result.categoriesRemoved
                ? plural(result.categoriesRemoved, {
                    one: `, # category`,
                    other: `, # categories`,
                  })
                : ''
            }`,
          });
        }
      } else if (pendingAction.type === 'delete') {
        await deleteMutation.mutateAsync({ id: pendingAction.id, budgetId });
        toast.success(t`Import entry removed`);
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error, t`Action failed`);
      toast.error(message);
    } finally {
      setPendingAction(null);
    }
  };

  const disableActions = undoMutation.isPending || deleteMutation.isPending;
  const formats = t(SUPPORTED_IMPORT_FORMATS_LABEL);

  return (
    <div className="container max-w-5xl mx-auto p-4 sm:p-6 pb-20 sm:pb-6 space-y-6 sm:space-y-8">
      <SettingsPageHeader
        title={t`Imports`}
        description={t`Import transactions from ${formats} files and manage previous imports.`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trans>
              <UploadIcon size={20} />
              New Import
            </Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Map your file columns, preview the data, and bring transactions into your budget.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <CSVPDFImportDialog />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trans>
              <Inbox size={20} />
              Import History
            </Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Review recent imports and undo or archive them if something looks off.</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {budgetId === 0 ? (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <Trans>
                <AlertTriangle className="h-4 w-4" />
                Select a budget to view its import history.
              </Trans>
            </div>
          ) : isLoading ? (
            <InlineLoadingRow label={t`Loading import history...`} />
          ) : history.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              <Trans>
                No imports yet. When you import transactions they will appear here for quick undo or
                cleanup.
              </Trans>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">
                      <Trans>Imported</Trans>
                    </TableHead>
                    <TableHead>
                      <Trans>Source</Trans>
                    </TableHead>
                    <TableHead className="text-center">
                      <Trans>Transactions</Trans>
                    </TableHead>
                    <TableHead className="text-center">
                      <Trans>Accounts Created</Trans>
                    </TableHead>
                    <TableHead className="text-center">
                      <Trans>Categories Created</Trans>
                    </TableHead>
                    <TableHead>
                      <Trans>Status</Trans>
                    </TableHead>
                    <TableHead className="text-right">
                      <Trans>Actions</Trans>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-sm text-foreground">
                            {formatUtcTimestamp(run.createdAt)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="capitalize">
                        <div>{run.sourceName || run.sourceType}</div>
                        {run.summary.acceptedWithWarnings && run.summary.verification && (
                          <div className="mt-1 text-[11px] normal-case text-amber-700 dark:text-amber-400">
                            <Trans>
                              {run.summary.verification.readyToAssign.mismatchCount} RTA ·{' '}
                              {run.summary.verification.categories.checked -
                                run.summary.verification.categories.matched}{' '}
                              category differences
                            </Trans>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {run.summary.transactionsImported}
                        <div className="text-xs text-muted-foreground">
                          <Trans>
                            {run.summary.duplicatesSkipped ?? 0} duplicates ·{' '}
                            {run.summary.userSkipped ?? 0} user skipped ·{' '}
                            {run.summary.invalidRows ?? 0} invalid · {run.summary.failedRows ?? 0}{' '}
                            failed
                          </Trans>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {run.summary.accountsCreated > 0 ? run.summary.accountsCreated : '—'}
                      </TableCell>
                      <TableCell className="text-center">
                        {run.summary.categoriesCreated > 0 ? run.summary.categoriesCreated : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={run.status === 'undone' ? 'outline' : 'secondary'}>
                          {run.status === 'undone'
                            ? t`Undone`
                            : run.status === 'completed_with_warnings'
                              ? t`Warning accepted`
                              : run.status === 'in_progress'
                                ? t`In progress / interrupted`
                                : t`Completed`}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {!run.sourceType.startsWith('ynab-') && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={run.status === 'undone' || disableActions}
                              onClick={() =>
                                setPendingAction({
                                  type: 'undo',
                                  id: run.id,
                                  label: run.sourceName || run.sourceType,
                                })
                              }
                            >
                              <Trans>
                                <Undo2 className="h-4 w-4 mr-1" />
                                Undo
                              </Trans>
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={disableActions}
                            onClick={() =>
                              setPendingAction({
                                type: 'delete',
                                id: run.id,
                                label: run.sourceName || run.sourceType,
                              })
                            }
                          >
                            <Trans>
                              <Trash2 className="h-4 w-4 mr-1" />
                              Delete
                            </Trans>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pendingAction !== null}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title={pendingAction?.type === 'undo' ? t`Undo this import?` : t`Delete history entry?`}
        description={
          <>
            {pendingAction?.label && (
              <span className="block font-medium text-foreground mb-2">{pendingAction.label}</span>
            )}
            {pendingAction?.type === 'undo'
              ? t`This will remove transactions (and any empty accounts or categories created by this import).`
              : t`This removes the history entry only. Your transactions remain untouched.`}
          </>
        }
        loadingText="Working..."
        isLoading={disableActions}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
