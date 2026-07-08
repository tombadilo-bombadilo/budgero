import { useEffect } from 'react';
import { useUndoStore } from '@shared/mutations/UndoStore';
import { toast } from 'sonner';

export function GlobalUndoHotkeys() {
  const undo = useUndoStore((s) => s.undo);
  const redo = useUndoStore((s) => s.redo);
  const canUndo = useUndoStore((s) => s.canUndo);
  const canRedo = useUndoStore((s) => s.canRedo);

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
            .then(() => {
              toast.success('Undid last action', {
                action: {
                  label: 'Redo',
                  onClick: () => void (canRedo() && redo()),
                },
              });
            })
            .catch(() => {
              toast.error('Failed to undo last action');
            });
        }
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        if (canRedo()) {
          e.preventDefault();
          redo()
            .then(() => {
              toast.success('Redid action');
            })
            .catch(() => {
              toast.error('Failed to redo action');
            });
        }
      }
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [undo, redo, canUndo, canRedo]);

  return null;
}
