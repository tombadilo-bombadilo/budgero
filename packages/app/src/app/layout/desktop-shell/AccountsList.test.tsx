import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { SidebarProvider } from '@shared/ui/sidebar';
import { AccountsList } from './AccountsList';

// Radix tooltips measure themselves with ResizeObserver, which jsdom lacks.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}

    unobserve() {}

    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const localizer = { format: (value: number) => String(value) };

const account = (ID: number, BalanceNative: number, OnBudget = true) => ({
  ID,
  Name: `Account ${ID}`,
  Type: 'Checking',
  BalanceNative,
  OnBudget,
});

// Six on-budget accounts (two with a zero balance) and two off-budget ones.
const accounts = [
  account(1, 0),
  account(2, 100),
  account(3, 200),
  account(4, 0),
  account(5, 300),
  account(6, 400),
  account(7, 50, false),
  account(8, 60, false),
];

function List({ pinned, editable = true }: { pinned: number[]; editable?: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const [pins, setPins] = useState(new Set(pinned));
  const toggle = (id: number) =>
    setPins((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <MemoryRouter>
      <SidebarProvider>
        <AccountsList
          accounts={accounts}
          uncategorizedData={undefined}
          showAllAccounts={showAll}
          onToggleShowAll={() => setShowAll((prev) => !prev)}
          globalLocalizer={localizer}
          pinnedIds={pins}
          onTogglePinned={editable ? toggle : undefined}
        />
      </SidebarProvider>
    </MemoryRouter>
  );
}

const shown = () =>
  screen.getAllByRole('link').map((link) => within(link).getByText(/^Account \d$/).textContent);

it('collapses to active accounts first when nothing is pinned', () => {
  render(<List pinned={[]} />);
  expect(shown()).toEqual([
    'Account 2',
    'Account 3',
    'Account 5',
    'Account 6',
    'Account 7',
    'Account 8',
  ]);
});

it('collapses a section to its pinned accounts and keeps the other section automatic', () => {
  render(<List pinned={[4, 1]} />);
  expect(shown()).toEqual(['Account 1', 'Account 4', 'Account 7', 'Account 8']);
  expect(screen.getByRole('button', { name: 'Show All (8)' })).toBeInTheDocument();
});

it('offers Show All when pins hide accounts of a short section', () => {
  render(<List pinned={[8]} />);
  expect(shown()).toContain('Account 8');
  expect(shown()).not.toContain('Account 7');
  expect(screen.getByRole('button', { name: 'Show All (8)' })).toBeInTheDocument();
});

it('pins an account from the full list', async () => {
  const user = userEvent.setup();
  render(<List pinned={[]} />);
  await user.click(screen.getByRole('button', { name: 'Show All (8)' }));
  const pin = screen.getByRole('button', { name: 'Keep Account 1 in the short list' });
  expect(pin).toHaveAttribute('aria-pressed', 'false');
  await user.click(pin);
  expect(
    screen.getByRole('button', { name: 'Remove Account 1 from the short list' })
  ).toHaveAttribute('aria-pressed', 'true');
  await user.click(screen.getByRole('button', { name: 'Show Less' }));
  expect(shown()).toEqual(['Account 1', 'Account 7', 'Account 8']);
});

it('has no pin buttons where pins cannot be changed', () => {
  render(<List pinned={[2]} editable={false} />);
  expect(screen.queryByRole('button', { name: /short list/ })).toBeNull();
  expect(shown()).toEqual(['Account 2', 'Account 7', 'Account 8']);
});
