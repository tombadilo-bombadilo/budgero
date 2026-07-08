/**
 * Sortable Drag Handle Hook
 *
 * Wraps @dnd-kit's useSortable into the DragHandleProps shape consumed by the
 * desktop table rows. Shared by the sortable group and category row wrappers.
 */

import type { CSSProperties } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import type { DragHandleProps } from './types';

export function useSortableDragHandle(id: string, overId: string | null): DragHandleProps {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style: CSSProperties | undefined =
    transform != null || transition != null
      ? {
          transform:
            transform && typeof transform.x === 'number' && typeof transform.y === 'number'
              ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
              : undefined,
          transition: transition ?? undefined,
        }
      : undefined;

  return {
    setNodeRef,
    style,
    listeners: listeners ?? {},
    attributes: attributes ?? {},
    isDragging,
    isOver: overId === id,
  };
}
