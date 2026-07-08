import { Terminal } from 'lucide-react';
import type { ToolEvent } from '@features/ai/lib/chat-client';

interface ToolCallLogProps {
  events: ToolEvent[];
  defaultOpen?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  run_analytics_sql: 'SQL query',
  render_chart: 'Chart query',
  query_transactions: 'Transaction query',
  query_budget: 'Budget query',
  search_docs: 'Docs search',
};

/** Render the SQL for sql/chart tools, otherwise the raw args. */
function describeArgs(event: ToolEvent): string {
  const { sql } = event.args;
  if (typeof sql === 'string' && sql.trim()) return sql.trim();
  try {
    return JSON.stringify(event.args, null, 2);
  } catch {
    return '';
  }
}

/**
 * Collapsible, transparent log of the tools the assistant ran this turn — lets
 * the user see the actual SQL/queries behind an answer.
 */
export function ToolCallLog({ events, defaultOpen = false }: ToolCallLogProps) {
  return (
    <details open={defaultOpen} className="mt-1 rounded-md border bg-muted/30 text-left text-xs">
      <summary className="flex cursor-pointer items-center gap-1.5 px-2 py-1 text-muted-foreground select-none">
        <Terminal className="h-3.5 w-3.5" />
        Ran {events.length} {events.length === 1 ? 'query' : 'queries'}
      </summary>
      <div className="space-y-2 px-2 pb-2">
        {events.map((event, i) => (
          <div key={i} className="space-y-1">
            <div className="font-medium text-foreground">
              {TOOL_LABELS[event.toolName] ?? event.toolName}
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-background/60 p-1.5 text-[11px] leading-snug">
              {describeArgs(event)}
            </pre>
            {event.resultPreview && (
              <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-background/40 p-1.5 text-[11px] leading-snug text-muted-foreground">
                {event.resultPreview}
              </pre>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
