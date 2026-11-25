import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as useIsMobileModule from '@shared/hooks/useIsMobile';
import { asMilli } from '@shared/lib/currency/milli';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import { SidebarProvider, useSidebar } from '@shared/ui/sidebar';
import { applyShortcut } from '@shared/ui/calculator-cell/calculator-utils';
import { isApplePlatform } from '@shared/lib/keyboard-shortcuts';
import { GlobalUndoHotkeys } from './GlobalUndoHotkeys';

vi.mock('@shared/hooks/useIsMobile', () => ({ useIsMobile: vi.fn() }));
vi.mock('@shared/lib/haptics', () => ({ triggerHapticFeedback: vi.fn() }));

const redo = vi.fn(() => Promise.resolve());
vi.mock('@shared/mutations/UndoStore', () => {
  const state = {
    undo: vi.fn(() => Promise.resolve(null)),
    redo: () => redo(),
    canUndo: () => false,
    canRedo: () => true,
    redoItem: vi.fn(),
    retryFailed: vi.fn(),
  };
  return { useUndoStore: (pick: (s: typeof state) => unknown) => pick(state) };
});

/** Fires a keydown and reports whether the app called preventDefault. */
function press(target: EventTarget, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

function SidebarState() {
  const { open } = useSidebar();
  return (
    <>
      <span data-testid="state">{open ? 'open' : 'closed'}</span>
      <input aria-label="field" />
    </>
  );
}

describe('sidebar shortcut', () => {
  beforeEach(() => {
    vi.spyOn(useIsMobileModule, 'useIsMobile').mockReturnValue(false);
  });

  it('toggles on [ and leaves Ctrl/Cmd+B to the browser', () => {
    render(
      <SidebarProvider>
        <SidebarState />
      </SidebarProvider>
    );
    const state = screen.getByTestId('state');
    expect(state).toHaveTextContent('open');

    expect(press(document.body, { key: 'b', ctrlKey: true })).toBe(false);
    expect(press(document.body, { key: 'b', metaKey: true })).toBe(false);
    expect(state).toHaveTextContent('open');

    expect(press(document.body, { key: '[' })).toBe(true);
    expect(state).toHaveTextContent('closed');
    // AltGr (Ctrl+Alt on Windows) is how many layouts type "[".
    expect(press(document.body, { key: '[', ctrlKey: true, altKey: true })).toBe(true);
    expect(state).toHaveTextContent('open');
  });

  it('ignores [ while typing in a field', () => {
    render(
      <SidebarProvider>
        <SidebarState />
      </SidebarProvider>
    );
    expect(press(screen.getByLabelText('field'), { key: '[' })).toBe(false);
    expect(screen.getByTestId('state')).toHaveTextContent('open');
  });
});

describe('amount field shortcuts', () => {
  beforeEach(() => {
    vi.spyOn(useIsMobileModule, 'useIsMobile').mockReturnValue(false);
  });

  it('maps plain H/D/Z/T to calculations', () => {
    expect(applyShortcut('h', 10)).toBe('10 / 2');
    expect(applyShortcut('d', 10)).toBe('10 * 2');
    expect(applyShortcut('z', 10)).toBe('0');
    expect(applyShortcut('t', 10)).toBe('10 * 0.1');
    expect(applyShortcut('x', 10)).toBeNull();
  });

  function editAmount() {
    render(<CalculatorCell value={asMilli(100_000)} onCommit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    return screen.getByRole('textbox') as HTMLInputElement;
  }

  it('applies a plain letter while editing', () => {
    const input = editAmount();
    expect(press(input, { key: 'h' })).toBe(true);
    expect(input.value).toBe('100 / 2');
  });

  it('leaves Ctrl/Cmd + H, D, T and Z to the browser and text undo', () => {
    const input = editAmount();
    const before = input.value;
    for (const key of ['h', 'd', 't', 'z']) {
      expect(press(input, { key, ctrlKey: true })).toBe(false);
      expect(press(input, { key, metaKey: true })).toBe(false);
    }
    expect(input.value).toBe(before);
  });
});

describe('platform-specific shortcuts', () => {
  const original = navigator.platform;
  const setPlatform = (value: string) =>
    Object.defineProperty(navigator, 'platform', { value, configurable: true });
  afterEach(() => {
    setPlatform(original);
    redo.mockClear();
  });

  it('redoes with Ctrl+Y off Apple, but leaves ⌘Y (History) to the browser on a Mac', () => {
    setPlatform('Win32');
    const { unmount } = render(<GlobalUndoHotkeys />);
    expect(press(document.body, { key: 'y', ctrlKey: true })).toBe(true);
    expect(redo).toHaveBeenCalledTimes(1);
    unmount();

    setPlatform('MacIntel');
    render(<GlobalUndoHotkeys />);
    expect(press(document.body, { key: 'y', metaKey: true })).toBe(false);
    expect(press(document.body, { key: 'z', metaKey: true, shiftKey: true })).toBe(true);
    expect(redo).toHaveBeenCalledTimes(2);
  });

  it('detects Mac and iPad', () => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    expect(isApplePlatform()).toBe(true);
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    expect(isApplePlatform()).toBe(false);
  });
});
