/**
 * Thin wrapper around the Quackback feedback widget loaded in index.html.
 * The widget's floating launcher is hidden (launcher: false) — we open it
 * from our own feedback buttons instead so it has a home on mobile too.
 */

type QuackbackFn = ((command: string, ...args: unknown[]) => void) & {
  q?: unknown[];
};

declare global {
  interface Window {
    Quackback?: QuackbackFn;
  }
}

/** Open the Quackback feedback panel. No-op if the widget never loaded. */
export function openQuackback(): void {
  window.Quackback?.('open');
}
