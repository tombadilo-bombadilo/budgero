import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { Progress } from '@shared/ui/progress';
import { Badge } from '@shared/ui/badge';
import { cn } from '@shared/lib/utils';
import { CheckCircle2, RotateCcw, AlertTriangle } from 'lucide-react';
import { Spinner } from '@shared/ui/spinner';
import type { RuleExecutionResult, RuleRunUndoResult, RuleTrigger } from '@budgero/core/browser';

export type RuleRunPhase = 'idle' | 'running' | 'refreshing' | 'done' | 'error';

type Step = {
  id: string;
  label: string;
  description?: string;
};

const executeSteps: Step[] = [
  {
    id: 'run',
    label: 'Applying rule to transactions',
  },
  {
    id: 'refresh',
    label: 'Refreshing budget data',
    description: 'Updating cached queries so everything reflects the new changes',
  },
];

const undoSteps: Step[] = [
  {
    id: 'run',
    label: 'Restoring previous values',
  },
  {
    id: 'refresh',
    label: 'Refreshing budget data',
    description: 'Updating cached queries so everything reflects the new changes',
  },
];

function stepState(
  phase: RuleRunPhase,
  stepId: string
): 'pending' | 'active' | 'complete' | 'error' {
  if (phase === 'error') {
    if (stepId === 'run') return 'error';
    return 'pending';
  }

  if (phase === 'running') {
    return stepId === 'run' ? 'active' : 'pending';
  }

  if (phase === 'refreshing') {
    return stepId === 'run' ? 'complete' : 'active';
  }

  if (phase === 'done') {
    return 'complete';
  }

  return 'pending';
}

function StepIcon({ state }: { state: ReturnType<typeof stepState> }) {
  switch (state) {
    case 'active':
      return <Spinner className="text-primary" />;
    case 'complete':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'error':
      return <AlertTriangle className="h-4 w-4 text-destructive" />;
    default:
      return <RotateCcw className="h-4 w-4 text-muted-foreground" />;
  }
}

function StepRow({ step, state }: { step: Step; state: ReturnType<typeof stepState> }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-border/40 bg-muted/30 p-3">
      <StepIcon state={state} />
      <div className="space-y-1">
        <p
          className={cn('text-sm font-medium', {
            'text-muted-foreground': state === 'pending',
            'text-primary': state === 'active',
            'text-foreground': state === 'complete',
            'text-destructive': state === 'error',
          })}
        >
          {step.label}
        </p>
        {step.description ? (
          <p className="text-xs text-muted-foreground">{step.description}</p>
        ) : null}
      </div>
    </div>
  );
}

type RuleRunOverlayProps = {
  open: boolean;
  mode: 'execute' | 'undo';
  phase: RuleRunPhase;
  trigger: RuleTrigger | 'undo';
  executionResult: RuleExecutionResult | null;
  undoResult: RuleRunUndoResult | null;
  error?: string | null;
  onClose: () => void;
};

export function RuleRunOverlay({
  open,
  mode,
  phase,
  trigger,
  executionResult,
  undoResult,
  error,
  onClose,
}: RuleRunOverlayProps) {
  const progressValue = (() => {
    switch (phase) {
      case 'running':
        return 33;
      case 'refreshing':
        return 66;
      case 'done':
        return 100;
      case 'error':
        return 33;
      default:
        return 0;
    }
  })();

  const matchedCount = executionResult?.matchedCount ?? 0;
  const restoredCount = undoResult?.restoredTransactions ?? 0;

  const disableClose = phase === 'running' || phase === 'refreshing';

  const steps = mode === 'undo' ? undoSteps : executeSteps;

  const summaryText = (() => {
    if (phase === 'error') {
      return error || 'We could not apply this rule. Try again in a moment.';
    }

    if (mode === 'undo') {
      if (phase === 'running') return 'Restoring transactions to their previous values...';
      if (phase === 'refreshing') return 'Updating cached data...';
      return `Restored ${restoredCount} transaction${restoredCount === 1 ? '' : 's'}.`;
    }

    if (phase === 'running') return 'Evaluating matching transactions...';
    if (phase === 'refreshing') return 'Updating cached data...';
    return `${matchedCount} transaction${matchedCount === 1 ? '' : 's'} updated.`;
  })();

  const handleOpenChange = (next: boolean) => {
    if (disableClose) return;
    if (!next) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader className="space-y-2">
          <DialogTitle>
            {phase === 'error'
              ? 'Rule execution failed'
              : phase === 'done'
                ? mode === 'undo'
                  ? 'Undo completed'
                  : 'Rule execution completed'
                : mode === 'undo'
                  ? 'Undoing automation run'
                  : 'Running automation rule'}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="uppercase">
              {mode === 'undo' ? 'UNDO' : trigger}
            </Badge>
            <span>{summaryText}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Progress value={progressValue} className="h-2" />

          <div className="space-y-2">
            {steps.map((step) => (
              <StepRow key={step.id} step={step} state={stepState(phase, step.id)} />
            ))}
          </div>

          {phase === 'done' ? (
            <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3 text-sm text-foreground">
              <p>
                {mode === 'undo'
                  ? `Restored ${restoredCount} transaction${restoredCount === 1 ? '' : 's'} across this budget.`
                  : `Updated ${matchedCount} transaction${matchedCount === 1 ? '' : 's'} across this budget.`}
              </p>
            </div>
          ) : null}

          {phase === 'error' && error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {(phase === 'done' || phase === 'error') && (
            <div className="flex justify-end">
              <Button
                variant={phase === 'error' ? 'destructive' : 'default'}
                onClick={onClose}
                autoFocus
              >
                Close
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
