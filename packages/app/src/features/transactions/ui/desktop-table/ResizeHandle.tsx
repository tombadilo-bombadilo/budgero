import { useLingui } from '@lingui/react/macro';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@shared/lib/utils';
import { createResizeTracker } from './resize-tracker';
import type { ColumnWidths } from './useColumnResize';

/** Width delta (px) applied per arrow-key press when resizing via keyboard. */
const KEYBOARD_RESIZE_STEP = 10;
interface ResizeHandleProps {
  column: keyof ColumnWidths;
  onResize: (column: keyof ColumnWidths, delta: number) => void;
}

/**
 * Drag handle on a header's right edge. Pointer events cover mouse, pen and
 * touch: the handle captures the pointer and opts out of touch panning
 * (touch-action: none), so a finger drag resizes the column while a swipe
 * anywhere else still scrolls the table. Coarse pointers get a wider target.
 */
export function ResizeHandle({ column, onResize }: ResizeHandleProps) {
  const { t } = useLingui();
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    tracker: ReturnType<typeof createResizeTracker>;
  } | null>(null);

  const endDrag = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  // Unmounting mid-drag (the column was hidden) must not leave the page locked.
  useEffect(() => endDrag, [endDrag]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail for a pointer that is already gone; moves still arrive.
    }
    dragRef.current = { pointerId: e.pointerId, tracker: createResizeTracker(e.clientX) };
    setDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      e.preventDefault();
      const delta = drag.tracker.move(e.clientX);
      if (delta !== null) onResize(column, delta);
    },
    [column, onResize]
  );

  const handlePointerEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragRef.current?.pointerId !== e.pointerId) return;
      endDrag();
    },
    [endDrag]
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
      aria-label={t`Resize column`}
      data-resizing={dragging || undefined}
      className={cn(
        'group/resize absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize touch-none select-none',
        // Touch: a 24px target centred on the column edge.
        'pointer-coarse:-right-3 pointer-coarse:w-6'
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 w-1 group-hover:bg-border/50 group-hover/resize:bg-primary/50 group-active/resize:bg-primary',
          // Touch: a thin 1px line (the 24px target stays invisible); 2px while dragging.
          'pointer-coarse:inset-y-2 pointer-coarse:right-1/2 pointer-coarse:w-px pointer-coarse:translate-x-1/2 pointer-coarse:bg-border',
          dragging && 'bg-primary pointer-coarse:w-0.5 pointer-coarse:bg-primary'
        )}
      />
    </div>
  );
}
