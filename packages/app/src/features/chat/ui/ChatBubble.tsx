import { Bot } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { useChatStore } from '@features/chat/model/useChatStore';
import { useLLMSettings } from '@features/ai/api/useLLMSettings';
import { useChatSettings } from '@features/chat/api/useChat';
import { useUiStore } from '@shared/store/useUiStore';

export function ChatBubble() {
  const selectedBudget = useUiStore((s) => s.selectedBudget);
  const budgetId = selectedBudget?.ID ?? null;
  const { data: llmSettings } = useLLMSettings(budgetId);
  const { data: chatSettings } = useChatSettings(budgetId);
  const { setIsOpen, isOpen } = useChatStore();

  if (!llmSettings?.Enabled) return null;
  if (chatSettings && !chatSettings.ShowBubble) return null;

  if (isOpen) return null;

  return (
    <Button
      onClick={() => setIsOpen(true)}
      size="icon"
      className="fixed bottom-32 right-4 z-50 h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-shadow md:bottom-16"
      aria-label="Open chat assistant"
    >
      <Bot className="h-6 w-6" />
    </Button>
  );
}
