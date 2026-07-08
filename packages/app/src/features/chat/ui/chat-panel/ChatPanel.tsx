import { Dialog, DialogContent, DialogTitle } from '@shared/ui/dialog';
import { cn } from '@shared/lib/utils';
import { useChatPanelState } from './useChatPanelState';
import { ChatHeader } from './ChatHeader';
import { ChatMessageList } from './ChatMessageList';
import { ChatComposer } from './ChatComposer';
import { ChatConversationList } from './ChatConversationList';

export function ChatPanel() {
  const {
    isOpen,
    setIsOpen,
    sidebarOpen,
    toggleSidebar,
    activeConversationId,
    setActiveConversationId,
    conversations,
    messages,
    pendingTools,
    isGenerating,
    streamingText,
    streamingToolEvents,
    inputText,
    setInputText,
    tokenUsage,
    llmSettings,
    attachedImages,
    handleAddImages,
    handleRemoveImage,

    scrollRef,

    handleSend,
    handleKeyDown,
    handleConfirmTool,
    handleRejectTool,
    handleNewChat,
    handleDeleteChat,
  } = useChatPanelState();

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex h-[85vh] max-h-[85vh] w-[calc(100%-2rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0 lg:max-w-6xl xl:max-w-7xl"
      >
        <DialogTitle className="sr-only">Chat Assistant</DialogTitle>
        {/* Header */}
        <ChatHeader
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
          onClose={() => setIsOpen(false)}
          tokenUsage={tokenUsage}
          contextLength={llmSettings?.ContextLength}
        />

        {/* Main content area */}
        <div className="flex min-h-0 flex-1">
          {/* Sidebar */}
          <div
            className={cn(
              'shrink-0 border-r bg-muted/30 transition-all duration-200',
              sidebarOpen ? 'w-64' : 'w-0 overflow-hidden'
            )}
          >
            {sidebarOpen && (
              <ChatConversationList
                conversations={conversations}
                activeId={activeConversationId}
                onSelect={setActiveConversationId}
                onDelete={handleDeleteChat}
                onNew={handleNewChat}
              />
            )}
          </div>

          {/* Chat area */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Messages */}
            <ChatMessageList
              ref={scrollRef}
              messages={messages}
              pendingTools={pendingTools}
              isGenerating={isGenerating}
              streamingText={streamingText}
              streamingToolEvents={streamingToolEvents}
              onConfirmTool={handleConfirmTool}
              onRejectTool={handleRejectTool}
            />

            {/* Input */}
            <ChatComposer
              inputText={inputText}
              onInputChange={setInputText}
              onKeyDown={handleKeyDown}
              onSend={handleSend}
              isGenerating={isGenerating}
              disabled={!activeConversationId}
              attachedImages={attachedImages}
              onAddImages={handleAddImages}
              onRemoveImage={handleRemoveImage}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
