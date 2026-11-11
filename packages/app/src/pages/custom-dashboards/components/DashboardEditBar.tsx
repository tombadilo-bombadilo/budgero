import { Trans, useLingui } from '@lingui/react/macro';
import { Pencil, Plus, Redo2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useUndoStore } from '@shared/mutations/UndoStore';
import { toastError } from '@shared/lib/errors';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';

interface DashboardEditBarProps {
  isMobile: boolean;
  onAdd: () => void;
  onDone: () => void;
  /** Undo what was changed since editing started, then leave edit mode. */
  onCancel: () => Promise<void>;
}

/**
 * The controls of a dashboard in edit mode, always on screen: fixed above the
 * bottom navigation on a phone, stuck to the top of the page on desktop. Its
 * "Editing" label tells at any scroll position that the page is being edited.
 */
export function DashboardEditBar({ isMobile, onAdd, onDone, onCancel }: DashboardEditBarProps) {
  const { t } = useLingui();
  const canUndo = useUndoStore((s) => s.canUndo());
  const canRedo = useUndoStore((s) => s.canRedo());
  const undo = useUndoStore((s) => s.undo);
  const redo = useUndoStore((s) => s.redo);
  const [cancelling, setCancelling] = useState(false);

  const cancel = async () => {
    setCancelling(true);
    try {
      await onCancel();
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div
      data-edit-bar
      className={cn(
        'flex items-center gap-1.5 rounded-xl border border-primary/40 bg-card/95 px-2 py-1.5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/85',
        isMobile
          ? // Above the page, below the bottom navigation's own layer.
            'fixed inset-x-2 bottom-[calc(var(--mobile-bottom-nav-height,96px)+0.5rem)] z-40'
          : // Just under the app's sticky header (z-30), which stays on top.
            'sticky top-[4.25rem] z-20'
      )}
    >
      <span
        role="status"
        className="mr-auto inline-flex min-w-0 items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary"
      >
        <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">
          <Trans>Editing</Trans>
        </span>
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled={!canUndo || cancelling}
        aria-label={t`Undo`}
        title={t`Undo`}
        onClick={() =>
          void undo().catch((error: unknown) => toastError(t`Failed to undo last action`, error))
        }
      >
        <Undo2 className="h-4 w-4" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled={!canRedo || cancelling}
        aria-label={t`Redo`}
        title={t`Redo`}
        onClick={() =>
          void redo().catch((error: unknown) => toastError(t`Failed to redo action`, error))
        }
      >
        <Redo2 className="h-4 w-4" aria-hidden />
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-8 px-2"
        onClick={onAdd}
        disabled={cancelling}
        aria-label={t`Add a card`}
      >
        <Plus className="h-4 w-4" aria-hidden />
        <span className={isMobile ? 'hidden min-[400px]:inline' : undefined}>
          <Trans>Add a card</Trans>
        </span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2"
        onClick={() => void cancel()}
        disabled={cancelling}
        title={t`Undo the changes made while editing`}
      >
        <Trans>Cancel</Trans>
      </Button>
      <Button size="sm" className="h-8 px-3" onClick={onDone} disabled={cancelling}>
        <Trans>Done</Trans>
      </Button>
    </div>
  );
}
