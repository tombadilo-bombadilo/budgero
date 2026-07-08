import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useRules,
  useCreateRule,
  useUpdateRule,
  useDeleteRule,
  useExecuteRule,
  useUndoRuleRun,
} from '@entities/rule/api/useRules';
import { useUiStore } from '@shared/store/useUiStore';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Badge } from '@shared/ui/badge';
import { Switch } from '@shared/ui/switch';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { Separator } from '@shared/ui/separator';
import { Skeleton } from '@shared/ui/skeleton';
import { toast } from 'sonner';
import { RuleEditorDialog, type RuleFormValues } from '@features/rules/ui/rule-editor';
import { RuleHistoryDrawer } from '@features/rules/ui/RuleHistoryDrawer';
import { RuleRunOverlay, type RuleRunPhase } from '@features/rules/ui/RuleRunOverlay';
import type {
  TransactionRule,
  RuleTrigger,
  RuleExecutionResult,
  RuleRunUndoResult,
} from '@budgero/core/browser';
import { formatDistanceToNow } from 'date-fns';
import {
  Bot,
  Clock,
  History,
  Layers2,
  Loader2,
  Play,
  Rocket,
  ShieldOff,
  Sparkles,
  Trash2,
  Pencil,
} from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { getErrorMessage, toastError } from '@shared/lib/errors';

export default function AutomationRulesPage() {
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const budgetId = selectedBudget?.ID ?? 0;

  const { data: rules = [], isLoading } = useRules(budgetId);
  const createRule = useCreateRule();
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();
  const executeRule = useExecuteRule();
  const undoRuleRun = useUndoRuleRun();
  const queryClient = useQueryClient();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editingRule, setEditingRule] = useState<TransactionRule | null>(null);
  const [historyRule, setHistoryRule] = useState<TransactionRule | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [executingRuleId, setExecutingRuleId] = useState<number | null>(null);
  const [executingTrigger, setExecutingTrigger] = useState<RuleTrigger>('manual');
  const [runOverlay, setRunOverlay] = useState<{
    open: boolean;
    mode: 'execute' | 'undo';
    phase: RuleRunPhase;
    trigger: RuleTrigger | 'undo';
    executionResult: RuleExecutionResult | null;
    undoResult: RuleRunUndoResult | null;
    error: string | null;
  }>({
    open: false,
    mode: 'execute',
    phase: 'idle',
    trigger: 'manual',
    executionResult: null,
    undoResult: null,
    error: null,
  });
  const [undoingRunId, setUndoingRunId] = useState<number | null>(null);

  const refreshAllQueries = async () => {
    await queryClient.cancelQueries();
    await queryClient.invalidateQueries({ predicate: () => true });
    await queryClient.refetchQueries({ predicate: () => true, type: 'active' });
  };

  const waitForNextFrame = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

  const openCreateDialog = () => {
    setEditorMode('create');
    setEditingRule(null);
    setEditorOpen(true);
  };

  const openEditDialog = (rule: TransactionRule) => {
    setEditorMode('edit');
    setEditingRule(rule);
    setEditorOpen(true);
  };

  const handleSaveRule = async (values: RuleFormValues) => {
    if (!budgetId) return;

    try {
      if (editorMode === 'create') {
        await createRule.mutateAsync({
          budgetId,
          name: values.name,
          description: values.description,
          conditions: values.conditions,
          actions: values.actions,
          mode: values.mode,
          enabled: values.enabled,
          runOrder: values.runOrder,
        });
        toast.success('Rule created', { description: 'Your automation rule is ready to run.' });
      } else if (editingRule) {
        await updateRule.mutateAsync({
          id: editingRule.id,
          budgetId,
          patch: {
            name: values.name,
            description: values.description,
            conditions: values.conditions,
            actions: values.actions,
            mode: values.mode,
            enabled: values.enabled,
            runOrder: values.runOrder,
          },
        });
        toast.success('Rule updated', { description: 'Changes saved successfully.' });
      }

      setEditorOpen(false);
    } catch (error) {
      toastError('Something went wrong', error, 'Unable to save rule.');
    }
  };

  const handleToggleEnabled = async (rule: TransactionRule, nextEnabled: boolean) => {
    if (!budgetId) return;
    try {
      await updateRule.mutateAsync({
        id: rule.id,
        budgetId,
        patch: { enabled: nextEnabled },
      });
      toast.success(nextEnabled ? 'Rule enabled' : 'Rule paused', {
        description: nextEnabled
          ? 'New matching transactions will run through this rule.'
          : 'Automation paused until you re-enable it.',
      });
    } catch (error) {
      toastError('Unable to update rule', error, 'Toggle failed. Try again.');
    }
  };

  const handleExecute = async (rule: TransactionRule, trigger: RuleTrigger) => {
    if (!budgetId) return;
    setExecutingRuleId(rule.id);
    setExecutingTrigger(trigger);
    setRunOverlay({
      open: true,
      mode: 'execute',
      phase: 'running',
      trigger,
      executionResult: null,
      undoResult: null,
      error: null,
    });
    await waitForNextFrame();
    try {
      const result = await executeRule.mutateAsync({
        ruleId: rule.id,
        budgetId,
        options: { trigger },
      });
      setRunOverlay((prev) => ({ ...prev, phase: 'refreshing', executionResult: result }));
      try {
        await refreshAllQueries();
      } catch (refreshError) {
        console.warn('[AutomationRules] Failed to refresh queries after rule run', refreshError);
      }
      setRunOverlay((prev) => ({ ...prev, phase: 'done' }));
    } catch (error) {
      const message = getErrorMessage(error, 'Unable to run the rule.');
      setRunOverlay((prev) => ({ ...prev, phase: 'error', error: message }));
      toast.error('Execution failed', {
        description: message,
      });
    } finally {
      setExecutingRuleId(null);
    }
  };

  const handleDelete = async (rule: TransactionRule) => {
    if (!budgetId) return;
    try {
      await deleteRule.mutateAsync({ id: rule.id, budgetId });
      toast.success('Rule deleted', { description: 'Automation removed successfully.' });
    } catch (error) {
      toastError('Unable to delete rule', error, 'Please try again.');
    }
  };

  const openHistoryForRule = (rule: TransactionRule) => {
    setHistoryRule(rule);
    setHistoryOpen(true);
  };

  const isBusy = createRule.isPending || updateRule.isPending;
  const executingCurrent = executeRule.isPending ? executingRuleId : null;

  const orderedRules = useMemo(() => {
    return [...rules].sort((a, b) => a.runOrder - b.runOrder || a.id - b.id);
  }, [rules]);

  const closeRunOverlay = () =>
    setRunOverlay({
      open: false,
      mode: 'execute',
      phase: 'idle',
      trigger: 'manual',
      executionResult: null,
      undoResult: null,
      error: null,
    });

  const handleUndoRun = async ({
    runId,
    ruleId,
    budgetId,
  }: {
    runId: number;
    ruleId: number;
    budgetId: number;
  }) => {
    if (!budgetId) return;
    setUndoingRunId(runId);
    setRunOverlay({
      open: true,
      mode: 'undo',
      phase: 'running',
      trigger: 'undo',
      executionResult: null,
      undoResult: null,
      error: null,
    });
    await waitForNextFrame();
    try {
      const result = await undoRuleRun.mutateAsync({ runId, ruleId, budgetId });
      setRunOverlay((prev) => ({ ...prev, phase: 'refreshing', undoResult: result }));
      try {
        await refreshAllQueries();
      } catch (refreshError) {
        console.warn('[AutomationRules] Failed to refresh queries after undoing run', refreshError);
      }
      setRunOverlay((prev) => ({ ...prev, phase: 'done', undoResult: result }));
      toast.success('Run undone', {
        description: 'Transactions were restored to their previous values.',
      });
    } catch (error) {
      const message = getErrorMessage(error, 'Unable to undo run.');
      setRunOverlay((prev) => ({ ...prev, phase: 'error', error: message }));
      toast.error('Unable to undo run', {
        description: message,
      });
    } finally {
      setUndoingRunId(null);
    }
  };

  return (
    <div className="space-y-6 p-4 sm:space-y-8 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Automation rules</h1>
          <p className="text-sm text-muted-foreground">
            Create powerful rules that categorise, clean up, and reroute transactions the moment
            they appear.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Button onClick={openCreateDialog} className="w-full sm:w-auto">
            <Sparkles className="mr-2 h-4 w-4" /> New rule
          </Button>
        </div>
      </div>

      {!budgetId ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>No budget selected</CardTitle>
            <CardDescription>
              Select or create a budget to configure automation rules.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-60 w-full rounded-xl" />
          ))}
        </div>
      ) : orderedRules.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="space-y-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Bot className="h-5 w-5 text-muted-foreground" />
              Let Budgero handle the busywork
            </CardTitle>
            <CardDescription>
              No rules yet. Create your first automation to categorise subscriptions, split income,
              or tidy up imported descriptions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={openCreateDialog}>
              <Sparkles className="mr-2 h-4 w-4" /> Design a rule
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:gap-6 xl:grid-cols-2">
          {orderedRules.map((rule) => {
            const lastRunLabel = rule.lastRunAt
              ? formatDistanceToNow(new Date(rule.lastRunAt), { addSuffix: true })
              : 'Never';
            const isOneTimeConsumed = rule.mode === 'one_time' && rule.oneTimeConsumed;

            return (
              <Card
                key={rule.id}
                className={cn(
                  'relative overflow-hidden transition-shadow hover:shadow-lg',
                  !rule.enabled && 'opacity-80'
                )}
              >
                <CardHeader className="space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                        {rule.name}
                        <Badge variant={rule.mode === 'one_time' ? 'secondary' : 'outline'}>
                          {rule.mode === 'one_time'
                            ? 'One time'
                            : rule.mode === 'autofill'
                              ? 'Autofill'
                              : 'Continuous'}
                        </Badge>
                      </CardTitle>
                      {rule.description ? (
                        <CardDescription>{rule.description}</CardDescription>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-end gap-3 sm:justify-start">
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={(checked) => handleToggleEnabled(rule, checked)}
                        disabled={updateRule.isPending}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Layers2 className="h-3.5 w-3.5" /> Run order {rule.runOrder}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" /> Last run {lastRunLabel}
                    </span>
                    {isOneTimeConsumed ? (
                      <span className="flex items-center gap-1 text-destructive">
                        <ShieldOff className="h-3.5 w-3.5" /> Consumed after retro run
                      </span>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{rule.conditions.length} condition(s)</Badge>
                    <Badge variant="outline">{rule.actions.length} action(s)</Badge>
                  </div>
                  <Separator />
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <Button
                      size="sm"
                      className="w-full justify-center sm:w-auto sm:justify-start"
                      onClick={() => handleExecute(rule, 'manual')}
                      disabled={!!executingCurrent && executingCurrent !== rule.id}
                    >
                      {executeRule.isPending &&
                      executingCurrent === rule.id &&
                      executingTrigger === 'manual' ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="mr-2 h-4 w-4" />
                      )}
                      Run now
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full justify-center sm:w-auto sm:justify-start"
                          disabled={
                            isOneTimeConsumed ||
                            (!!executingCurrent && executingCurrent !== rule.id)
                          }
                        >
                          {executeRule.isPending &&
                          executingCurrent === rule.id &&
                          executingTrigger === 'retroactive' ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Rocket className="mr-2 h-4 w-4" />
                          )}
                          Retro run
                        </Button>
                      }
                      title="Run this rule on past transactions?"
                      description="Budgero will evaluate every transaction in this budget and apply any matching actions. This may take a moment for larger budgets."
                      confirmText="Confirm retro run"
                      confirmDisabled={!!executingCurrent && executingCurrent !== rule.id}
                      onConfirm={() => {
                        void handleExecute(rule, 'retroactive');
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full justify-center sm:w-auto sm:justify-start"
                      onClick={() => openHistoryForRule(rule)}
                    >
                      <History className="mr-2 h-4 w-4" /> History
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full justify-center sm:w-auto sm:justify-start"
                      onClick={() => openEditDialog(rule)}
                    >
                      <Pencil className="mr-2 h-4 w-4" /> Edit
                    </Button>
                    <DeleteRuleButton
                      rule={rule}
                      onDelete={() => handleDelete(rule)}
                      disabled={deleteRule.isPending}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <RuleEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        budgetId={budgetId}
        mode={editorMode}
        initialRule={editingRule}
        isSubmitting={isBusy}
        onSubmit={handleSaveRule}
      />

      <RuleHistoryDrawer
        rule={historyRule}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onUndoRun={handleUndoRun}
        undoingRunId={undoingRunId}
      />

      <RuleRunOverlay
        open={runOverlay.open}
        mode={runOverlay.mode}
        phase={runOverlay.phase}
        trigger={runOverlay.trigger}
        executionResult={runOverlay.executionResult}
        undoResult={runOverlay.undoResult}
        error={runOverlay.error}
        onClose={closeRunOverlay}
      />
    </div>
  );
}

function DeleteRuleButton({
  rule,
  onDelete,
  disabled,
}: {
  rule: TransactionRule;
  onDelete: () => void;
  disabled: boolean;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button
          size="sm"
          variant="ghost"
          className="w-full justify-center text-destructive hover:text-destructive sm:w-auto sm:justify-start"
        >
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </Button>
      }
      title={<>Delete “{rule.name}”?</>}
      description="This rule and its history will be removed. Recent runs can still be undone from the global undo menu."
      confirmText="Delete rule"
      variant="destructive"
      confirmDisabled={disabled}
      onConfirm={onDelete}
    />
  );
}
