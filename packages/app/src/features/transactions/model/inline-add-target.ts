/**
 * The desktop account register registers itself here while inline entry is on,
 * so "Add transaction" (button, Ctrl/⌘+Alt+T, command palette) opens its inline
 * row instead of the dialog. Elsewhere nothing is registered and the dialog opens.
 */
let target: (() => void) | null = null;

export function setInlineAddTarget(open: () => void): () => void {
  target = open;
  return () => {
    if (target === open) target = null;
  };
}

/** Opens the registered inline row; false when no register is listening. */
export function requestInlineAdd(): boolean {
  if (!target) return false;
  target();
  return true;
}
