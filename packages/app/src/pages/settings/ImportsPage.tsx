'use client';

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
          toast.info('Import already undone');
        } else {
          toast.success('Import undone', {
            description: `Removed ${result.transactionsRemoved} transactions${
              result.accountsRemoved
                ? `, ${result.accountsRemoved} account${result.accountsRemoved === 1 ? '' : 's'}`
                : ''
            }${
              result.categoriesRemoved
                ? `, ${result.categoriesRemoved} categor${
                    result.categoriesRemoved === 1 ? 'y' : 'ies'
                  }`
                : ''
            }`,
          });
        }
      } else if (pendingAction.type === 'delete') {
        await deleteMutation.mutateAsync({ id: pendingAction.id, budgetId });
        toast.success('Import entry removed');
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Action failed');
      toast.error(message);
    } finally {
      setPendingAction(null);
    }
  };

  const disableActions = undoMutation.isPending || deleteMutation.isPending;

  return (
    <div className="container max-w-5xl mx-auto p-4 sm:p-6 pb-20 sm:pb-6 space-y-6 sm:space-y-8">
      <SettingsPageHeader
        title="Imports"
        description={`Import transactions from ${SUPPORTED_IMPORT_FORMATS_LABEL} files and manage previous imports.`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UploadIcon size={20} />
            New Import
          </CardTitle>
          <CardDescription>
            Map your file columns, preview the data, and bring transactions into your budget.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <CSVPDFImportDialog />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Inbox size={20} />
            Import History
          </CardTitle>
          <CardDescription>
            Review recent imports and undo or archive them if something looks off.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {budgetId === 0 ? (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Select a budget to view its import history.
            </div>
          ) : isLoading ? (
            <InlineLoadingRow label="Loading import history..." />
          ) : history.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No imports yet. When you import transactions they will appear here for quick undo or
              cleanup.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">Imported</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-center">Transactions</TableHead>
                    <TableHead className="text-center">Accounts Created</TableHead>
                    <TableHead className="text-center">Categories Created</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
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
                        {run.sourceName || run.sourceType}
                      </TableCell>
                      <TableCell className="text-center">
                        {run.summary.transactionsImported}
                      </TableCell>
                      <TableCell className="text-center">
                        {run.summary.accountsCreated > 0 ? run.summary.accountsCreated : '—'}
                      </TableCell>
                      <TableCell className="text-center">
                        {run.summary.categoriesCreated > 0 ? run.summary.categoriesCreated : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={run.status === 'undone' ? 'outline' : 'secondary'}>
                          {run.status === 'undone' ? 'Undone' : 'Completed'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
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
                            <Undo2 className="h-4 w-4 mr-1" /> Undo
                          </Button>
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
                            <Trash2 className="h-4 w-4 mr-1" /> Delete
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
        title={pendingAction?.type === 'undo' ? 'Undo this import?' : 'Delete history entry?'}
        description={
          <>
            {pendingAction?.label && (
              <span className="block font-medium text-foreground mb-2">{pendingAction.label}</span>
            )}
            {pendingAction?.type === 'undo'
              ? 'This will remove transactions (and any empty accounts or categories created by this import).'
              : 'This removes the history entry only. Your transactions remain untouched.'}
          </>
        }
        loadingText="Working..."
        isLoading={disableActions}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
