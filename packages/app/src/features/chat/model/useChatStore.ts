import { create } from 'zustand';
import type { PendingToolExecution } from '@features/ai/lib/tools/types';
import type { ToolEvent } from '@features/ai/lib/chat-client';

interface ChatState {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  toggle: () => void;

  activeConversationId: number | null;
  setActiveConversationId: (id: number | null) => void;

  pendingTools: PendingToolExecution[];
  addPendingTool: (tool: PendingToolExecution) => void;
  updatePendingTool: (id: string, updates: Partial<PendingToolExecution>) => void;
  confirmTool: (id: string) => void;
  rejectTool: (id: string) => void;
  removePendingTool: (id: string) => void;

  transcription: string;
  setTranscription: (text: string) => void;
  isGenerating: boolean;
  setIsGenerating: (generating: boolean) => void;

  streamingText: string;
  setStreamingText: (text: string) => void;
  streamingToolEvents: ToolEvent[];
  setStreamingToolEvents: (events: ToolEvent[]) => void;

  inputText: string;
  setInputText: (text: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  isOpen: false,
  setIsOpen: (open) => set({ isOpen: open }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),

  activeConversationId: null,
  setActiveConversationId: (id) => set({ activeConversationId: id }),

  pendingTools: [],
  addPendingTool: (tool) =>
    set((state) => ({
      pendingTools: [...state.pendingTools, tool],
    })),
  updatePendingTool: (id, updates) =>
    set((state) => ({
      pendingTools: state.pendingTools.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),
  confirmTool: (id) =>
    set((state) => ({
      pendingTools: state.pendingTools.map((t) =>
        t.id === id ? { ...t, status: 'confirmed' as const } : t
      ),
    })),
  rejectTool: (id) =>
    set((state) => ({
      pendingTools: state.pendingTools.map((t) =>
        t.id === id ? { ...t, status: 'rejected' as const } : t
      ),
    })),
  removePendingTool: (id) =>
    set((state) => ({
      pendingTools: state.pendingTools.filter((t) => t.id !== id),
    })),

  transcription: '',
  setTranscription: (text) => set({ transcription: text }),
  isGenerating: false,
  setIsGenerating: (generating) => set({ isGenerating: generating }),

  streamingText: '',
  setStreamingText: (text) => set({ streamingText: text }),
  streamingToolEvents: [],
  setStreamingToolEvents: (events) => set({ streamingToolEvents: events }),

  inputText: '',
  setInputText: (text) => set({ inputText: text }),
}));
