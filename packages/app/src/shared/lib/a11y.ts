import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';

/** Event union for an activation handler shared between click and keyboard. */
export type ActivationEvent<T extends HTMLElement = HTMLElement> =
  | ReactMouseEvent<T>
  | ReactKeyboardEvent<T>;

/**
 * Returns a keydown handler that mirrors a click action for Enter and Space,
 * matching native button activation semantics (Space is prevented from
 * scrolling the page). Events originating from focusable descendants (e.g. a
 * nested button) are ignored so activating a child control never also
 * activates the row/card itself.
 */
export function activateOnEnterOrSpace<T extends HTMLElement = HTMLElement>(
  onActivate: (event: ActivationEvent<T>) => void
): (event: ReactKeyboardEvent<T>) => void {
  return (event) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.key === ' ') event.preventDefault();
    onActivate(event);
  };
}

/**
 * Spreadable props that make a non-interactive element (div/span row, card,
 * cell) behave like a button for pointer, keyboard, and assistive tech:
 * `role="button"`, focusability, click, and Enter/Space activation. Use on
 * layout-sensitive clickables that cannot become a native `<button>`.
 */
export function buttonizeProps<T extends HTMLElement = HTMLElement>(
  onActivate: (event: ActivationEvent<T>) => void
) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onActivate as (event: ReactMouseEvent<T>) => void,
    onKeyDown: activateOnEnterOrSpace(onActivate),
  };
}
