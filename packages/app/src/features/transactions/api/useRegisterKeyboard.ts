import { useCallback, useEffect, useRef, useState } from 'react';
import type { GetTransactionsByAccountRow } from '@budgero/core/browser';
import { isTypingTarget } from './useClearedShortcut';

interface RegisterKeyboardOptions {
  enabled: boolean;
  transactions: GetTransactionsByAccountRow[];
  rowSelection: Record<string, boolean>;
  /** Same contract as the table's checkbox handler. */
  onSelectionChange: (
    rowId: string,
    checked: boolean,
    rangeIds?: string[],
    replaceSelection?: boolean
  ) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  /** Bring a row into view (it may be outside the virtualized window). */
  scrollToRow: (index: number) => void;
}

const selectableIds = (rows: GetTransactionsByAccountRow[]) =>
  rows.filter((row) => !row.IsProjected).map((row) => row.ID.toString());

/**
 * Register keyboard navigation: ↑/↓ move a cursor, Space toggles the cursor
 * row, Shift+↑/↓ extends the selection from where it started, Ctrl/⌘+A selects
 * every row, Esc clears the selection and cursor.
 */
export function useRegisterKeyboard({
  enabled,
  transactions,
  rowSelection,
  onSelectionChange,
  onSelectAll,
  onClearSelection,
  scrollToRow,
}: RegisterKeyboardOptions) {
  const [cursorId, setCursorId] = useState<number | null>(null);
  const anchorIndexRef = useRef<number | null>(null);

  const moveCursor = useCallback(
    (index: number) => {
      const row = transactions[index];
      if (!row) return;
      setCursorId(row.ID);
      scrollToRow(index);
    },
    [transactions, scrollToRow]
  );

  useEffect(() => {
    if (!enabled) return undefined;
    const handler = (event: KeyboardEvent) => {
      if (event.altKey || isTypingTarget(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      const cursorIndex =
        cursorId === null ? -1 : transactions.findIndex((row) => row.ID === cursorId);

      if (mod && !event.shiftKey && event.key?.toLowerCase() === 'a') {
        if (!transactions.length) return;
        event.preventDefault();
        onSelectAll();
        return;
      }
      if (mod) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!transactions.length) return;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next =
          cursorIndex < 0 ? 0 : Math.min(transactions.length - 1, Math.max(0, cursorIndex + step));
        if (event.shiftKey) {
          const anchor = anchorIndexRef.current ?? Math.max(cursorIndex, 0);
          anchorIndexRef.current = anchor;
          const ids = selectableIds(
            transactions.slice(Math.min(anchor, next), Math.max(anchor, next) + 1)
          );
          if (ids.length) onSelectionChange(ids[0], true, ids, true);
        } else {
          anchorIndexRef.current = null;
        }
        moveCursor(next);
        return;
      }

      if (event.key === ' ' && !event.shiftKey) {
        const row = transactions[cursorIndex];
        if (!row) return;
        event.preventDefault();
        anchorIndexRef.current = cursorIndex;
        if (row.IsProjected) return;
        const id = row.ID.toString();
        onSelectionChange(id, !rowSelection[id]);
        return;
      }

      if (event.key === 'Escape' && !event.shiftKey) {
        const hasSelection = Object.values(rowSelection).some(Boolean);
        if (!hasSelection && cursorId === null) return;
        anchorIndexRef.current = null;
        setCursorId(null);
        onClearSelection();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    enabled,
    cursorId,
    transactions,
    rowSelection,
    onSelectionChange,
    onSelectAll,
    onClearSelection,
    moveCursor,
  ]);

  return { cursorId };
}
