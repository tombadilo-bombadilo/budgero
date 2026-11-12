/**
 * Closing anything on the Budget page (the page guide, however it was opened
 * and however it is closed, or the phone's first-steps sheet) must leave the
 * first-steps list where it is. Only "Hide first steps" (also on the
 * finished list) takes it away.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GetMonthlyBudgetRow } from '@budgero/core/browser';
import { PageGuideButton, PageGuideHost } from '@features/page-guides';
import { usePageGuideStore } from '@features/page-guides/model/page-guides';
import {
  getFirstSteps,
  markFirstStep,
  resetFirstStepsForTests,
  startFirstSteps,
} from '@shared/lib/first-steps/first-steps';
import { FirstStepsCard } from './FirstStepsCard';

const { profile } = vi.hoisted(() => ({
  profile: { current: { id: 'u1', created_at: new Date().toISOString() } },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
vi.mock('@shared/lib/analytics/track', () => ({ track: vi.fn() }));
vi.mock('@entities/user/api/useAuth', () => ({ useProfile: () => ({ data: profile.current }) }));
vi.mock('@features/demo-budget/lib/useIsDemoSpace', () => ({
  useDemoSpaceStatus: () => ({ isDemo: false, checking: false }),
}));
vi.mock('@shared/runtime/runtime-provider', () => ({ useActiveSpaceId: () => 'space-1' }));

const rows = [
  { Assigned: 0, CategoryID: 11, Category: 'Rent' },
] as unknown as GetMonthlyBudgetRow[];

function Page({ variant }: { variant: 'card' | 'bar' }) {
  return (
    <MemoryRouter initialEntries={['/budgeting']}>
      <PageGuideButton />
      <FirstStepsCard
        readyToAssign={2_340_000}
        readyToAssignLabel="€2,340.00"
        rows={rows}
        variant={variant}
      />
      <PageGuideHost />
    </MemoryRouter>
  );
}

/** Press on the dimmed backdrop around the open dialog or sheet. */
function clickOutside() {
  const overlays = document.querySelectorAll(
    '[data-slot="dialog-overlay"], [data-slot="drawer-overlay"]'
  );
  const overlay = overlays[overlays.length - 1] ?? document.body;
  fireEvent.pointerDown(overlay, { button: 0, pointerType: 'mouse' });
  fireEvent.pointerUp(overlay, { button: 0, pointerType: 'mouse' });
  fireEvent.click(overlay);
}

const settle = () => act(() => vi.advanceTimersByTime(1500));
const guide = () => screen.queryByTestId('page-guide');

/** The list is on the page, not hidden in storage, and still there after a reload. */
function expectListStays(variant: 'card' | 'bar', unmount: () => void) {
  expect(screen.getByTestId('first-steps')).toBeInTheDocument();
  expect(getFirstSteps('space-1')?.dismissed).toBe(false);
  unmount();
  resetFirstStepsForTests();
  render(<Page variant={variant} />);
  settle();
  expect(screen.getByTestId('first-steps')).toBeInTheDocument();
}

type Closer = (variant: 'card' | 'bar') => void;
const closers: Record<string, Closer> = {
  Skip: () => fireEvent.click(screen.getByRole('button', { name: 'Skip' })),
  Escape: () => fireEvent.keyDown(guide()!, { key: 'Escape' }),
  'a click outside': () => clickOutside(),
  'Next … Done': () => {
    for (let i = 0; i < 6 && !screen.queryByRole('button', { name: 'Done' }); i++)
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  },
  // The desktop dialog's own ✕ (the phone sheet has none).
  'the ✕': (variant) => {
    if (variant === 'bar') return closers.Skip(variant);
    const close = [...guide()!.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Close'
    )!;
    fireEvent.click(close);
  },
};

const openers: Record<string, (variant: 'card' | 'bar') => void> = {
  'on the first visit': () => {
    settle();
    settle();
  },
  'from "How this works"': (variant) => {
    settle();
    if (guide()) closers.Skip(variant);
    fireEvent.click(screen.getByTestId('page-guide-button'));
    settle();
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetFirstStepsForTests();
  usePageGuideStore.setState({ request: null });
  startFirstSteps('space-1');
});

afterEach(() => {
  vi.useRealTimers();
  window.innerWidth = 1024;
});

describe.each([
  ['desktop', 'card', 1280],
  ['phone', 'bar', 390],
] as const)('on %s', (_, variant, width) => {
  beforeEach(() => {
    window.innerWidth = width;
  });

  describe.each(Object.keys(openers))('the Budget guide opened %s', (opener) => {
    it.each(Object.keys(closers))('closed with %s leaves the list', (closer) => {
      const { unmount } = render(<Page variant={variant} />);
      openers[opener](variant);
      expect(guide()).not.toBeNull();
      closers[closer](variant);
      settle();
      expect(guide()).toBeNull();
      expectListStays(variant, unmount);
    });
  });
});

describe('the phone sheet', () => {
  beforeEach(() => {
    window.innerWidth = 390;
  });

  const openSheet = () => {
    fireEvent.click(screen.getByTestId('first-steps'));
    expect(screen.getByRole('dialog', { name: 'Your first steps' })).toBeInTheDocument();
  };
  const sheet = () => screen.queryByRole('dialog', { name: 'Your first steps' });

  it.each([
    ['its ✕', () => fireEvent.click(screen.getByRole('button', { name: 'Close' }))],
    ['Escape', () => fireEvent.keyDown(sheet()!, { key: 'Escape' })],
    ['a tap outside', () => clickOutside()],
    // Each step's button closes the sheet on its way somewhere else.
    [
      'the goal\'s "Show me"',
      () => fireEvent.click(screen.getByRole('button', { name: 'Show me' })),
    ],
    [
      '"Go to transactions"',
      () => {
        act(() => {
          markFirstStep('space-1', 'goal');
          markFirstStep('space-1', 'assign');
        });
        fireEvent.click(screen.getByRole('link', { name: 'Go to transactions' }));
      },
    ],
  ])('closed with %s closes only the sheet', (_, close) => {
    const { unmount } = render(<Page variant="bar" />);
    settle();
    if (guide()) closers.Skip('bar');
    openSheet();
    settle();
    close();
    settle();
    if (guide()) closers.Skip('bar');
    settle();
    expect(sheet()).toBeNull();
    expectListStays('bar', unmount);
  });
});
