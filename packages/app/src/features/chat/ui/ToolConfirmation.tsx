import { Check, X, Wrench, Loader2 } from 'lucide-react';
import { Button } from '@shared/ui/button';
import type { PendingToolExecution } from '@features/ai/lib/tools/types';

interface ToolConfirmationProps {
  tool: PendingToolExecution;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  isExecuting?: boolean;
}

export function ToolConfirmation({
  tool,
  onConfirm,
  onReject,
  isExecuting = false,
}: ToolConfirmationProps) {
  const isPending = tool.status === 'pending';
  const isRejected = tool.status === 'rejected';
  const isExecuted = tool.status === 'executed';

  return (
    <div className="mx-4 my-2 rounded-lg border bg-muted/50 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Wrench className="h-4 w-4 text-muted-foreground" />
        <span className="capitalize">{tool.toolName.replace(/_/g, ' ')}</span>
        {isExecuting && <Loader2 className="h-3 w-3 animate-spin" />}
        {isExecuted && tool.result?.success && <Check className="h-3 w-3 text-green-500" />}
        {isExecuted && !tool.result?.success && <X className="h-3 w-3 text-red-500" />}
        {isRejected && <X className="h-3 w-3 text-red-500" />}
      </div>

      <p className="mt-1 text-sm text-muted-foreground">{tool.preview}</p>

      {isPending && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => onConfirm(tool.id)} disabled={isExecuting}>
            <Check className="mr-1 h-3 w-3" />
            Confirm
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onReject(tool.id)}
            disabled={isExecuting}
          >
            <X className="mr-1 h-3 w-3" />
            Cancel
          </Button>
        </div>
      )}

      {isExecuted && tool.result && (
        <p
          className={`mt-2 text-xs ${tool.result.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
        >
          {tool.result.message}
        </p>
      )}

      {isRejected && <p className="mt-2 text-xs text-muted-foreground">Cancelled</p>}
    </div>
  );
}
