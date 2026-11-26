import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResizeTracker } from './resize-tracker';
import { ResizeHandle } from './ResizeHandle';

describe('createResizeTracker', () => {
  it('ignores jitter and reports the distance since the last applied move', () => {
    const tracker = createResizeTracker(100);
    expect(tracker.move(101)).toBeNull();
    expect(tracker.move(98)).toBeNull();
    expect(tracker.move(110)).toBe(10);
    expect(tracker.move(112)).toBeNull();
    expect(tracker.move(104)).toBe(-6);
  });
});

function renderHandle() {
  const onResize = vi.fn();
  const onHeaderClick = vi.fn();
  render(
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div onClick={onHeaderClick}>
      <ResizeHandle column="memo" onResize={onResize} />
    </div>
  );
  const handle = screen.getByRole('button', { name: 'Resize column' });
  return { handle, onResize, onHeaderClick };
}

describe('ResizeHandle', () => {
  afterEach(() => {
    cleanup();
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  it('opts out of touch panning so a finger drag resizes instead of scrolling', () => {
    const { handle } = renderHandle();
    expect(handle.className).toContain('touch-none');
    expect(handle.className).toContain('pointer-coarse:w-6');
  });

  it('resizes with a touch drag and captures the pointer', () => {
    const { handle, onResize } = renderHandle();
    const capture = vi.fn();
    handle.setPointerCapture = capture;
    fireEvent.pointerDown(handle, { pointerId: 7, pointerType: 'touch', clientX: 200 });
    expect(capture).toHaveBeenCalledWith(7);
    expect(handle).toHaveAttribute('data-resizing', 'true');
    fireEvent.pointerMove(handle, { pointerId: 7, pointerType: 'touch', clientX: 230 });
    fireEvent.pointerMove(handle, { pointerId: 7, pointerType: 'touch', clientX: 231 });
    fireEvent.pointerMove(handle, { pointerId: 7, pointerType: 'touch', clientX: 220 });
    expect(onResize.mock.calls).toEqual([
      ['memo', 30],
      ['memo', -10],
    ]);
    fireEvent.pointerUp(handle, { pointerId: 7, pointerType: 'touch', clientX: 220 });
    expect(handle).not.toHaveAttribute('data-resizing');
    fireEvent.pointerMove(handle, { pointerId: 7, pointerType: 'touch', clientX: 300 });
    expect(onResize).toHaveBeenCalledTimes(2);
  });

  it('resizes with the left mouse button and locks the page cursor while dragging', () => {
    const { handle, onResize } = renderHandle();
    fireEvent.pointerDown(handle, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 50 });
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.userSelect).toBe('none');
    fireEvent.pointerMove(handle, { pointerId: 1, pointerType: 'mouse', clientX: 80 });
    expect(onResize).toHaveBeenCalledWith('memo', 30);
    fireEvent.pointerUp(handle, { pointerId: 1, pointerType: 'mouse' });
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });

  it('ignores other mouse buttons and other pointers', () => {
    const { handle, onResize } = renderHandle();
    fireEvent.pointerDown(handle, { pointerId: 1, pointerType: 'mouse', button: 2, clientX: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, pointerType: 'mouse', clientX: 90 });
    expect(onResize).not.toHaveBeenCalled();
    fireEvent.pointerDown(handle, { pointerId: 3, pointerType: 'touch', clientX: 50 });
    fireEvent.pointerMove(handle, { pointerId: 4, pointerType: 'touch', clientX: 90 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it('ends the drag when the browser cancels the pointer', () => {
    const { handle, onResize } = renderHandle();
    fireEvent.pointerDown(handle, { pointerId: 2, pointerType: 'touch', clientX: 50 });
    fireEvent.pointerCancel(handle, { pointerId: 2, pointerType: 'touch' });
    fireEvent.pointerMove(handle, { pointerId: 2, pointerType: 'touch', clientX: 90 });
    expect(onResize).not.toHaveBeenCalled();
    expect(handle).not.toHaveAttribute('data-resizing');
  });

  it('does not pass clicks to the header and resizes with arrow keys', () => {
    const { handle, onResize, onHeaderClick } = renderHandle();
    fireEvent.click(handle);
    expect(onHeaderClick).not.toHaveBeenCalled();
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onResize).toHaveBeenCalledWith('memo', -10);
  });

  it('releases the page when unmounted mid-drag', () => {
    const { handle } = renderHandle();
    fireEvent.pointerDown(handle, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 50 });
    cleanup();
    expect(document.body.style.cursor).toBe('');
  });
});
