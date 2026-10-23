import { useLingui } from '@lingui/react/macro';
import { useEffect } from 'react';
import { useUndoStore } from '@shared/mutations/UndoStore';
import { toast } from 'sonner';
import { getErrorMessage, toastError } from '@shared/lib/errors';

export function GlobalUndoHotkeys() {
  const { t } = useLingui();

  const undo = useUndoStore((s) => s.undo);
  const redo = useUndoStore((s) => s.redo);
  const canUndo = useUndoStore((s) => s.canUndo);
  const canRedo = useUndoStore((s) => s.canRedo);
  const redoItem = useUndoStore((s) => s.redoItem);
  const retryFailed = useUndoStore((s) => s.retryFailed);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;

      const target = e.target instanceof HTMLElement ? e.target : null;
      const inEditable =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          (!!target.closest && !!target.closest('.cm-editor')));
      if (inEditable) return; // don't hijack text editors

      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        if (canUndo()) {
          e.preventDefault();
          undo()
            .then((item) => {
              if (!item) return;
              toast.success(t`Undid last action`, {
                action: {
                  // Redo exactly the entry this toast undid.
                  label: t`Redo`,
                  onClick: () => {
                    redoItem(item.id).catch((error: unknown) =>
                      toastError(t`Failed to redo action`, error)
                    );
                  },
                },
              });
            })
            .catch((error: unknown) => {
              toast.error(t`Failed to undo last action`, {
                description: getErrorMessage(error),
                action: {
                  label: t`Retry`,
                  onClick: () => {
                    retryFailed().catch((retryError: unknown) =>
                      toastError(t`Failed to undo last action`, retryError)
                    );
                  },
                },
              });
            });
        }
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        if (canRedo()) {
          e.preventDefault();
          redo()
            .then(() => {
              toast.success(t`Redid action`);
            })
            .catch((error: unknown) => {
              toast.error(t`Failed to redo action`, {
                description: getErrorMessage(error),
                action: {
                  label: t`Retry`,
                  onClick: () => {
                    retryFailed().catch((retryError: unknown) =>
                      toastError(t`Failed to redo action`, retryError)
                    );
                  },
                },
              });
            });
        }
      }
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [undo, redo, redoItem, retryFailed, canUndo, canRedo, t]);

  return null;
}
