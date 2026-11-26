/**
 * Key (no modifiers) that shows or hides the sidebar. Ctrl/⌘+B is the
 * browser's bookmarks shortcut (Firefox, Vivaldi, Safari), so the app no
 * longer takes it.
 */
export const SIDEBAR_SHORTCUT_KEY = '[';

/**
 * Keys (no modifiers) that work while editing an amount field. Ctrl/⌘ + H, D,
 * T and Z belong to the browser (history, bookmark, new tab) or to text undo,
 * and letters can't be typed into an amount anyway.
 */
export const AMOUNT_SHORTCUT_KEYS = {
  half: 'H',
  double: 'D',
  zero: 'Z',
  tenPercent: 'T',
} as const;

/** True when the key event comes from a field, dialog or menu the user is typing in. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' ||
    element.isContentEditable ||
    Boolean(element.closest('.cm-editor, [role="dialog"], [role="menu"], [role="listbox"]'))
  );
}

export function isApplePlatform(): boolean {
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform;
  // iPadOS can identify itself as MacIntel when requesting desktop websites.
  return /^(Mac|iPhone|iPad|iPod)/i.test(platform);
}

/** Display labels only; shortcut handlers accept both Control and Command. */
export function getKeyboardShortcutLabels() {
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform;

  if (isApplePlatform()) {
    return {
      search: '⌘K',
      addTransaction: '⌥⌘T',
      mod: (key: string) => `⌘${key}`,
      shift: (key: string) => `⇧${key}`,
      redo: '⇧⌘Z',
    };
  }

  if (!platform) {
    return {
      search: 'Ctrl/⌘ K',
      addTransaction: 'Ctrl/⌘ + Alt/⌥ + T',
      mod: (key: string) => `Ctrl/⌘ ${key}`,
      shift: (key: string) => `Shift+${key}`,
      redo: 'Ctrl/⌘ + Shift + Z',
    };
  }

  return {
    search: 'Ctrl+K',
    addTransaction: 'Ctrl+Alt+T',
    mod: (key: string) => `Ctrl+${key}`,
    shift: (key: string) => `Shift+${key}`,
    redo: 'Ctrl+Y',
  };
}
