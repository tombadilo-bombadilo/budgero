import { CSS, type Transform } from '@dnd-kit/utilities';

/**
 * The CSS transform of a sortable dashboard card: movement only. dnd-kit's
 * grid strategy also scales an item to the size of the slot it passes over,
 * which squashes or stretches cards of different widths and heights; a card
 * must keep its own size while it moves.
 */
export function sortableTransform(transform: Transform | null): string | undefined {
  return CSS.Translate.toString(transform);
}
