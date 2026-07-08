import type { ChatConversation } from '@budgero/core/browser';

/**
 * Tailwind `prose` classes shared by every rendered-markdown chat bubble
 * (assistant/tool messages and streaming responses).
 */
export const MARKDOWN_PROSE_CLASSES =
  'prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-a:text-primary prose-a:no-underline hover:prose-a:underline';

/**
 * Read an image File into a (optionally downscaled) JPEG data URL, keeping the
 * payload small enough to send to a vision model and persist on a chat message.
 */
export async function fileToResizedDataUrl(
  file: File,
  maxDim = 1280,
  quality = 0.8
): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Failed to load image'));
    el.src = dataUrl;
  });

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  // Already small enough — keep the original bytes.
  if (scale === 1 && file.size < 400_000) return dataUrl;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Format a token count for display (e.g., 1500 -> "1.5k")
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
}

/**
 * Format a message timestamp as an absolute clock time (e.g., "3:45 PM").
 * Distinct from formatRelativeTime below — absolute vs relative are not
 * interchangeable.
 */
export function formatMessageTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Format a date string into a relative time (e.g., "5m ago", "2h ago")
 */
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Sort conversations by UpdatedAt descending (most recent first)
 */
export function sortConversationsByRecent(conversations: ChatConversation[]): ChatConversation[] {
  return [...conversations].sort(
    (a, b) => new Date(b.UpdatedAt).getTime() - new Date(a.UpdatedAt).getTime()
  );
}

/**
 * Get the most recently updated conversation from a list
 */
export function getMostRecentConversation(
  conversations: ChatConversation[]
): ChatConversation | null {
  if (conversations.length === 0) return null;
  const sorted = sortConversationsByRecent(conversations);
  return sorted[0];
}

/**
 * Compute context usage percentage and UI flags
 */
export interface ContextUsageFlags {
  percentage: number;
  isWarning: boolean;
  isCritical: boolean;
}

export function computeContextUsageFlags(
  used: number,
  limit: number | null | undefined
): ContextUsageFlags | null {
  if (!limit || limit <= 0) return null;

  const percentage = Math.min((used / limit) * 100, 100);
  return {
    percentage,
    isWarning: percentage > 75,
    isCritical: percentage > 90,
  };
}

export function scrollToBottom(scrollEl: HTMLElement | null): void {
  if (scrollEl) {
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }
}
