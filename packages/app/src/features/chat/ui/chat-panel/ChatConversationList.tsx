import { Button } from '@shared/ui/button';
import { Plus, Trash2, MessageSquare, MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { cn } from '@shared/lib/utils';
import { buttonizeProps } from '@shared/lib/a11y';
import type { ChatConversation } from '@budgero/core/browser';
import { formatRelativeTime, sortConversationsByRecent } from './chat-panel.utils';

interface ChatConversationListProps {
  conversations: ChatConversation[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onNew: () => void;
}

export function ChatConversationList({
  conversations,
  activeId,
  onSelect,
  onDelete,
  onNew,
}: ChatConversationListProps) {
  const sorted = sortConversationsByRecent(conversations);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">Chats</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onNew} title="New chat">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-2 space-y-1">
          {sorted.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              No conversations yet
            </div>
          ) : (
            sorted.map((conv) => (
              <div
                key={conv.ID}
                className={cn(
                  'group flex items-center gap-2 rounded-md px-2 py-2 text-sm cursor-pointer transition-colors',
                  activeId === conv.ID ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
                )}
                {...buttonizeProps(() => onSelect(conv.ID))}
              >
                <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{conv.Title || 'New Chat'}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatRelativeTime(conv.UpdatedAt)}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(conv.ID);
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
