import { cn } from '@shared/lib/utils';
import { Bot, User, Wrench } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage as ChatMessageType } from '@budgero/core/browser';
import type { ChatChartSpec } from '@features/ai/lib/tools';
import type { ToolEvent } from '@features/ai/lib/chat-client';
import { ChartViewer } from '@features/analytics/ui/chart-viewer/ChartViewer';
import { ToolCallLog } from './ToolCallLog';
import { MARKDOWN_PROSE_CLASSES, formatMessageTime } from './chat-panel/chat-panel.utils';

interface ChatMessageProps {
  message: ChatMessageType;
}

/** Pull persisted chart specs / image attachments / tool calls out of ToolResultJSON. */
function parseToolResult(toolResultJson: string | null): {
  charts: ChatChartSpec[];
  images: string[];
  toolEvents: ToolEvent[];
} {
  if (!toolResultJson) return { charts: [], images: [], toolEvents: [] };
  try {
    const parsed = JSON.parse(toolResultJson) as {
      result?: { charts?: ChatChartSpec[]; images?: string[]; toolEvents?: ToolEvent[] };
    };
    return {
      charts: Array.isArray(parsed?.result?.charts) ? parsed.result.charts : [],
      images: Array.isArray(parsed?.result?.images) ? parsed.result.images : [],
      toolEvents: Array.isArray(parsed?.result?.toolEvents) ? parsed.result.toolEvents : [],
    };
  } catch {
    return { charts: [], images: [], toolEvents: [] };
  }
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.Role === 'user';
  const isTool = message.Role === 'tool';
  const isAssistant = message.Role === 'assistant';
  const { charts, images, toolEvents } = parseToolResult(message.ToolResultJSON);

  return (
    <div className={cn('flex gap-3 px-4 py-3', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser && 'bg-primary text-primary-foreground',
          isAssistant && 'bg-muted',
          isTool && 'bg-blue-100 dark:bg-blue-900'
        )}
      >
        {isUser && <User className="h-4 w-4" />}
        {isAssistant && <Bot className="h-4 w-4" />}
        {isTool && <Wrench className="h-4 w-4" />}
      </div>

      {/* Message content */}
      <div className={cn('flex-1 space-y-1', isUser && 'text-right')}>
        {images.length > 0 && (
          <div className={cn('flex flex-wrap gap-2', isUser ? 'justify-end' : 'justify-start')}>
            {images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`attachment ${i + 1}`}
                className="h-24 w-24 rounded-md border object-cover"
              />
            ))}
          </div>
        )}
        {message.Content.trim() && (
          <div
            className={cn(
              'inline-block rounded-lg px-3 py-2 text-sm',
              isUser && 'bg-primary text-primary-foreground',
              isAssistant && 'bg-muted',
              isTool && 'bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800'
            )}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap">{message.Content}</p>
            ) : (
              <div className={MARKDOWN_PROSE_CLASSES}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.Content}</ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {toolEvents.length > 0 && <ToolCallLog events={toolEvents} />}

        {charts.length > 0 && (
          <div className="space-y-3 pt-1">
            {charts.map((chart, i) => (
              <div
                key={`${chart.config.id}-${i}`}
                className="w-full max-w-xl rounded-lg border bg-card p-2 text-left"
              >
                {chart.config.title && (
                  <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">
                    {chart.config.title}
                  </p>
                )}
                <div className="h-72 sm:h-80">
                  <ChartViewer
                    queryResult={chart.queryResult}
                    chartConfig={chart.config}
                    fitHeight
                    compactToolbar
                    showLegendSummary={false}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">{formatMessageTime(message.CreatedAt)}</p>
      </div>
    </div>
  );
}
