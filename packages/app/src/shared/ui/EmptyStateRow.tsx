import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * A muted, dashed-border empty-state row with a leading icon and a message.
 * Shared by dashboard cards (upcoming transactions, uncategorized, …).
 */
export function EmptyStateRow({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-muted-foreground/40 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
      <Icon className="h-5 w-5 text-muted-foreground/70" />
      <span>{children}</span>
    </div>
  );
}
