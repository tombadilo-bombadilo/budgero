import { forwardRef } from 'react';
import { Loader2, Bot } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage as ChatMessageType } from '@budgero/core/browser';
import type { PendingToolExecution } from '@features/ai/lib/tools';
import type { ToolEvent } from '@features/ai/lib/chat-client';
import { ChatMessage } from '../ChatMessage';
import { ToolConfirmation } from '../ToolConfirmation';
import { ToolCallLog } from '../ToolCallLog';
import { MARKDOWN_PROSE_CLASSES } from './chat-panel.utils';

interface ChatMessageListProps {
  messages: ChatMessageType[];
  pendingTools: PendingToolExecution[];
  isGenerating: boolean;
  streamingText: string;
  streamingToolEvents: ToolEvent[];
  onConfirmTool: (toolId: string) => void;
  onRejectTool: (toolId: string) => void;
}

export const ChatMessageList = forwardRef<HTMLDivElement, ChatMessageListProps>(
  function ChatMessageList(
    {
      messages,
      pendingTools,
      isGenerating,
      streamingText,
      streamingToolEvents,
      onConfirmTool,
      onRejectTool,
    },
    ref
  ) {
    const activePendingTools = pendingTools.filter(
      (t) => t.status === 'pending' || t.status === 'confirmed'
    );

    return (
      <div className="min-h-0 flex-1 overflow-y-auto" ref={ref}>
        <div className="py-4">
          {messages.length === 0 && !streamingText ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              <p>Hi! I'm your budget assistant.</p>
              <p className="mt-2">
                Try saying "I spent $20 on coffee today" or "What's my biggest expense this month?"
              </p>
            </div>
          ) : (
            messages.map((msg) => <ChatMessage key={msg.ID} message={msg} />)
          )}

          {/* Streaming response — live tool calls + partial text */}
          {(streamingText || (isGenerating && streamingToolEvents.length > 0)) && (
            <div className="flex gap-3 px-4 py-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                <Bot className="h-4 w-4" />
              </div>
              <div className="flex-1 space-y-1">
                {streamingToolEvents.length > 0 && (
                  <ToolCallLog events={streamingToolEvents} defaultOpen />
                )}
                {streamingText && (
                  <div className="inline-block rounded-lg px-3 py-2 text-sm bg-muted">
                    <div className={MARKDOWN_PROSE_CLASSES}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Pending tool confirmations */}
          {activePendingTools.map((tool) => (
            <ToolConfirmation
              key={tool.id}
              tool={tool}
              onConfirm={onConfirmTool}
              onReject={onRejectTool}
              isExecuting={tool.status === 'confirmed'}
            />
          ))}

          {/* Generating indicator — only before any text or tool activity appears */}
          {isGenerating && !streamingText && streamingToolEvents.length === 0 && (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Thinking...
            </div>
          )}
        </div>
      </div>
    );
  }
);
