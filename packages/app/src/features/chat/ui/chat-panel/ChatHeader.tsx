import { Button } from '@shared/ui/button';
import { X, PanelLeftClose, PanelLeft } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import type { TokenUsage } from '@features/ai/lib/chat-client';
import { formatTokenCount, computeContextUsageFlags } from './chat-panel.utils';

interface ContextUsageIndicatorProps {
  used: number;
  limit?: number | null;
}

function ContextUsageIndicator({ used, limit }: ContextUsageIndicatorProps) {
  const flags = computeContextUsageFlags(used, limit);

  // If we have a limit, show progress bar
  if (flags) {
    return (
      <div
        className="flex items-center gap-2 text-xs text-muted-foreground"
        title={`Context: ${used.toLocaleString()} / ${(limit ?? 0).toLocaleString()} tokens (${flags.percentage.toFixed(0)}%)`}
      >
        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              flags.isCritical ? 'bg-red-500' : flags.isWarning ? 'bg-yellow-500' : 'bg-green-500'
            )}
            style={{ width: `${flags.percentage}%` }}
          />
        </div>
        <span
          className={cn(
            flags.isCritical && 'text-red-500',
            flags.isWarning && !flags.isCritical && 'text-yellow-600'
          )}
        >
          {formatTokenCount(used)}/{formatTokenCount(limit ?? 0)}
        </span>
      </div>
    );
  }

  // No limit known - just show current usage
  return (
    <div
      className="text-xs text-muted-foreground"
      title={`Context used: ${used.toLocaleString()} tokens`}
    >
      {formatTokenCount(used)} tokens
    </div>
  );
}

interface ChatHeaderProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onClose: () => void;
  tokenUsage: TokenUsage | null;
  contextLength?: number | null;
}

export function ChatHeader({
  sidebarOpen,
  onToggleSidebar,
  onClose,
  tokenUsage,
  contextLength,
}: ChatHeaderProps) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onToggleSidebar}
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        >
          {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
        </Button>
        <h2 className="text-base font-semibold">Chat Assistant</h2>
      </div>
      <div className="flex items-center gap-3">
        {/* Context usage indicator */}
        {tokenUsage && (
          <ContextUsageIndicator used={tokenUsage.promptTokens ?? 0} limit={contextLength} />
        )}
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
