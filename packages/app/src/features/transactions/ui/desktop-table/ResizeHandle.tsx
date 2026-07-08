import React, { useCallback, useRef } from 'react';
import type { ColumnWidths } from './useColumnResize';

/** Width delta (px) applied per arrow-key press when resizing via keyboard. */
const KEYBOARD_RESIZE_STEP = 10;

interface ResizeHandleProps {
  column: keyof ColumnWidths;
  onResize: (column: keyof ColumnWidths, delta: number) => void;
}

export function ResizeHandle({ column, onResize }: ResizeHandleProps) {
  const startXRef = useRef<number>(0);
  const isDraggingRef = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startXRef.current = e.clientX;
      isDraggingRef.current = true;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const delta = moveEvent.clientX - startXRef.current;
        if (Math.abs(delta) > 2) {
          onResize(column, delta);
          startXRef.current = moveEvent.clientX;
        }
      };

      const handleMouseUp = () => {
        isDraggingRef.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [column, onResize]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      onResize(column, e.key === 'ArrowLeft' ? -KEYBOARD_RESIZE_STEP : KEYBOARD_RESIZE_STEP);
    },
    [column, onResize]
  );

  return (
    <div
      // `role="separator"` would be the ideal semantic, but the a11y lint
      // preset treats separators as non-focusable; a labelled button with
      // arrow-key resizing is the closest accessible equivalent.
      role="button"
      tabIndex={0}
      aria-label="Resize column"
      className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50 active:bg-primary group-hover:bg-border/50"
      onMouseDown={handleMouseDown}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
    />
  );
}
