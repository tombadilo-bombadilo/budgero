import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SidebarProvider, useSidebar } from '@shared/ui/sidebar';
import { SIDEBAR_PINNED_STORAGE_KEY, useUiStore } from '@shared/store/useUiStore';
import { SidebarPinToggle } from './SidebarPinToggle';

// Radix tooltips measure themselves with ResizeObserver, which jsdom lacks.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}

    unobserve() {}

    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

function Probe() {
  const { isMobile, pinned, canPin } = useSidebar();
  return <output data-testid="probe">{JSON.stringify({ sheet: isMobile, pinned, canPin })}</output>;
}

function Shell() {
  const sidebarPinned = useUiStore((state) => state.sidebarPinned);
  return (
    <SidebarProvider pinned={sidebarPinned}>
      <SidebarPinToggle />
      <Probe />
    </SidebarProvider>
  );
}

const probe = () => JSON.parse(screen.getByTestId('probe').textContent ?? '{}');

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

const originalWidth = window.innerWidth;

beforeEach(() => {
  localStorage.clear();
  useUiStore.setState({ sidebarPinned: false });
});

afterEach(() => setWidth(originalWidth));

it('slides out below 1600px until pinned, then stays inline and remembers it', async () => {
  setWidth(1440);
  render(<Shell />);
  expect(probe()).toEqual({ sheet: true, pinned: false, canPin: true });

  await userEvent.setup().click(screen.getByRole('button', { name: 'Keep the sidebar open' }));
  expect(probe()).toEqual({ sheet: false, pinned: true, canPin: true });
  expect(localStorage.getItem(SIDEBAR_PINNED_STORAGE_KEY)).toBe('1');

  await userEvent.setup().click(screen.getByRole('button', { name: 'Unpin the sidebar' }));
  expect(probe()).toEqual({ sheet: true, pinned: false, canPin: true });
  expect(localStorage.getItem(SIDEBAR_PINNED_STORAGE_KEY)).toBeNull();
});

it('keeps the slide-out sidebar below the pinning width even when pinned', () => {
  useUiStore.setState({ sidebarPinned: true });
  setWidth(1200);
  render(<Shell />);
  expect(probe()).toEqual({ sheet: true, pinned: false, canPin: false });
  expect(screen.queryByTestId('sidebar-pin-toggle')).toBeNull();
});

it('hides the pin on wide screens, where the sidebar is always inline', () => {
  setWidth(1800);
  render(<Shell />);
  expect(probe()).toEqual({ sheet: false, pinned: false, canPin: false });
  expect(screen.queryByTestId('sidebar-pin-toggle')).toBeNull();
});

it('follows window resizes', () => {
  useUiStore.setState({ sidebarPinned: true });
  setWidth(1440);
  render(<Shell />);
  expect(probe().sheet).toBe(false);
  act(() => {
    setWidth(1100);
    window.dispatchEvent(new Event('resize'));
  });
  expect(probe().sheet).toBe(true);
});
