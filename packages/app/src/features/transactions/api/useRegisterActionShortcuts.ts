import { useEffect } from 'react';
import { isTypingTarget } from './useClearedShortcut';

/** Shift + this key adds a transaction from the register. */
export const ADD_TRANSACTION_SHORTCUT_KEY = 'N';

/** Shift+N adds a transaction; Delete/Backspace deletes the selected rows. */
export function useRegisterActionShortcuts({
  onAdd,
  onDeleteSelected,
  hasSelection,
}: {
  onAdd: () => void;
  onDeleteSelected: () => void;
  hasSelection: boolean;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (isTypingTarget(event.target)) return;
      if (event.shiftKey && event.key?.toUpperCase() === ADD_TRANSACTION_SHORTCUT_KEY) {
        event.preventDefault();
        onAdd();
      } else if (
        !event.shiftKey &&
        hasSelection &&
        (event.key === 'Delete' || event.key === 'Backspace')
      ) {
        event.preventDefault();
        onDeleteSelected();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onAdd, onDeleteSelected, hasSelection]);
}
