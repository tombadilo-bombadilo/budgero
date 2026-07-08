'use client';

import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { useActiveSpaceId } from '@shared/runtime/runtime-provider';
import { useUiStore } from '@shared/store/useUiStore';
import {
  useMutationHistory,
  useMutationHistoryCount,
  useUndoMutationHistoryEntry,
  useClearMutationHistory,
  formatOpCode,
  getOpColorClass,
} from '@shared/mutations/useMutationHistory';
import { useBudgets } from '@entities/budget/api/useBudgets';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { toast } from 'sonner';
import {
  AlertTriangle,
  AlertCircle,
  History,
  Trash2,
  Undo2,
  Clock,
  Globe,
  Monitor,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@shared/ui/tooltip';
import type { ParsedMutationHistoryEntry } from '@budgero/core/browser';
import { formatUtcTimestamp, normalizeUtcString } from '@shared/lib/date-utils';
import { getErrorMessage } from '@shared/lib/errors';
import { InlineLoadingRow } from '@shared/ui/InlineLoadingRow';
import { SettingsPageHeader } from '@pages/settings/SettingsPageHeader';

type PendingAction = { type: 'undo'; entry: ParsedMutationHistoryEntry } | { type: 'clear' } | null;

function formatRelativeTime(value: string): string {
  const normalized = normalizeUtcString(value);
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function PayloadPreview({ payload }: { payload: Record<string, unknown> }) {
  const preview = React.useMemo(() => {
    const keys = Object.keys(payload).filter(
      (k) => !['budgetId', 'budget_id', 'BudgetID'].includes(k)
    );
    if (keys.length === 0) return '{}';

    const snippets: string[] = [];
    for (const key of keys.slice(0, 3)) {
      const val = payload[key];
      if (typeof val === 'string') {
        snippets.push(`${key}: "${val.slice(0, 20)}${val.length > 20 ? '...' : ''}"`);
      } else if (typeof val === 'number' || typeof val === 'boolean') {
        snippets.push(`${key}: ${val}`);
      } else if (val === null) {
        snippets.push(`${key}: null`);
      } else if (Array.isArray(val)) {
        snippets.push(`${key}: [${val.length} items]`);
      } else if (typeof val === 'object') {
        snippets.push(`${key}: {...}`);
      }
    }
    const result = snippets.join(', ');
    if (keys.length > 3) {
      return `${result}, +${keys.length - 3} more`;
    }
    return result;
  }, [payload]);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="font-mono text-xs text-muted-foreground truncate max-w-[200px] block cursor-help">
            {preview}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-md">
          <pre className="text-xs whitespace-pre-wrap break-all">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const PAGE_SIZE = 25;

export default function AuditLogPage() {
  const queryClient = useQueryClient();
  const spaceId = useActiveSpaceId();
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const [page, setPage] = React.useState(0);
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  const { data: history = [], isLoading } = useMutationHistory(spaceId, {
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const { data: totalCount = 0 } = useMutationHistoryCount(spaceId);
  const { data: budgets = [] } = useBudgets();
  const undoMutation = useUndoMutationHistoryEntry();
  const clearMutation = useClearMutationHistory();

  const budgetNameMap = React.useMemo(() => {
    const map = new Map<number, string>();
    for (const budget of budgets) {
      map.set(budget.ID, budget.Name);
    }
    return map;
  }, [budgets]);
  const [pendingAction, setPendingAction] = React.useState<PendingAction>(null);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['mutationHistory'] });
    await queryClient.invalidateQueries({ queryKey: ['mutationHistoryCount'] });
    setIsRefreshing(false);
  };

  const handleConfirm = async () => {
    if (!pendingAction || !spaceId) {
      setPendingAction(null);
      return;
    }

    try {
      if (pendingAction.type === 'undo') {
        await undoMutation.mutateAsync({ entry: pendingAction.entry });
        toast.success('Action undone', {
          description: `Reverted: ${formatOpCode(pendingAction.entry.op)}`,
        });
      } else if (pendingAction.type === 'clear') {
        await clearMutation.mutateAsync({ spaceId });
        toast.success('Audit log cleared');
        setPage(0);
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Action failed');
      toast.error(message);
    } finally {
      setPendingAction(null);
    }
  };

  const disableActions = undoMutation.isPending || clearMutation.isPending;

  return (
    <div className="container max-w-6xl mx-auto p-4 sm:p-6 pb-20 sm:pb-6 space-y-6 sm:space-y-8">
      <SettingsPageHeader
        title="Audit Log"
        description="View all changes made to your budget with the ability to undo recent actions."
      />

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <History size={20} />
                Mutation History
              </CardTitle>
              <CardDescription>
                {totalCount > 0
                  ? `${totalCount} recorded action${totalCount !== 1 ? 's' : ''} (showing ${Math.min(PAGE_SIZE, history.length)} per page)`
                  : 'No actions recorded yet'}
              </CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing || isLoading}
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              {totalCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPendingAction({ type: 'clear' })}
                  disabled={disableActions}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Clear History
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!spaceId ? (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              No workspace selected.
            </div>
          ) : isLoading ? (
            <InlineLoadingRow label="Loading audit log..." />
          ) : history.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No actions recorded yet. Changes you make will appear here for review and undo.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[140px]">Time</TableHead>
                      <TableHead className="w-[120px]">Budget</TableHead>
                      <TableHead className="w-[180px]">Action</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead className="w-[80px] text-center">Origin</TableHead>
                      <TableHead className="w-[100px]">Status</TableHead>
                      <TableHead className="w-[100px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((entry) => {
                      const canUndo = entry.undoOps && entry.undoOps.length > 0 && !entry.undoneAt;
                      const isCurrentBudget = selectedBudget?.ID === entry.budgetId;
                      return (
                        <TableRow key={entry.id} className={isCurrentBudget ? 'bg-primary/5' : ''}>
                          <TableCell>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-1.5 cursor-help">
                                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="text-sm">
                                      {formatRelativeTime(entry.timestamp)}
                                    </span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {formatUtcTimestamp(entry.timestamp)}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground truncate max-w-[120px] block">
                              {budgetNameMap.get(entry.budgetId) || '—'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={`font-medium text-sm ${getOpColorClass(entry.op)}`}>
                              {formatOpCode(entry.op)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <PayloadPreview payload={entry.payload} />
                          </TableCell>
                          <TableCell className="text-center">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center justify-center">
                                    {entry.origin === 'local' ? (
                                      <Monitor className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                      <Globe className="h-4 w-4 text-muted-foreground" />
                                    )}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {entry.origin === 'local'
                                    ? 'Local change (made on this device)'
                                    : 'Remote change (synced from another device)'}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </TableCell>
                          <TableCell>
                            {entry.status === 'failed' ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge
                                      variant="destructive"
                                      className="cursor-help flex items-center gap-1"
                                    >
                                      <AlertCircle className="h-3 w-3" />
                                      Failed
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent side="left" className="max-w-xs">
                                    <div className="space-y-1">
                                      {entry.errorCode && (
                                        <p className="font-mono text-xs text-muted-foreground">
                                          {entry.errorCode}
                                        </p>
                                      )}
                                      <p className="text-sm">
                                        {entry.errorMessage || 'Unknown error'}
                                      </p>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : entry.undoneAt ? (
                              <Badge variant="outline" className="text-muted-foreground">
                                Undone
                              </Badge>
                            ) : canUndo ? (
                              <Badge variant="secondary">Active</Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground">
                                No Undo
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canUndo || disableActions}
                              onClick={() => setPendingAction({ type: 'undo', entry })}
                            >
                              <Undo2 className="h-4 w-4 mr-1" /> Undo
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <span className="text-sm text-muted-foreground">
                    Page {page + 1} of {totalPages}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pendingAction !== null}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title={pendingAction?.type === 'undo' ? 'Undo this action?' : 'Clear audit log?'}
        description={
          pendingAction?.type === 'undo' ? (
            <>
              <span className="block font-medium text-foreground mb-2">
                {formatOpCode(pendingAction.entry.op)}
              </span>
              This will revert the changes made by this action. Make sure this is what you want.
            </>
          ) : (
            'This will permanently delete all audit log entries. Your actual data will not be affected.'
          )
        }
        loadingText="Working..."
        isLoading={disableActions}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
