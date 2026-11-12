import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { usePageGuideStore } from '../model/page-guides';
import { PageGuideButton } from './PageGuideButton';

const GUIDE_PAGES = [
  ['/budgeting', 'budget'],
  ['/accounts', 'accounts'],
  ['/accounts/all', 'transactions'],
  ['/accounts/7', 'transactions'],
  ['/reports', 'reports'],
  ['/dashboard', 'home'],
  ['/settings/rules', 'rules'],
  ['/settings/recurring', 'recurring'],
  ['/settings/imports', 'imports'],
] as const;

function renderButton(path: string, extra?: Parameters<typeof PageGuideButton>[0]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PageGuideButton iconOnly {...extra} />
    </MemoryRouter>
  );
}

beforeEach(() => usePageGuideStore.setState({ request: null }));

it.each(GUIDE_PAGES)('is there on %s and opens the %s guide', (path, guide) => {
  renderButton(path);
  fireEvent.click(screen.getByRole('button', { name: 'How this works' }));
  expect(usePageGuideStore.getState().request).toEqual({ id: guide, card: 0, trigger: 'manual' });
});

it('renders nothing on a page without a guide', () => {
  renderButton('/settings/appearance');
  expect(screen.queryByTestId('page-guide-button')).toBeNull();
});

it('opens a small menu when the page adds its own help', async () => {
  const onSelect = vi.fn();
  renderButton('/budgeting', {
    extraItems: [{ key: 'first-steps', label: 'Show first steps', onSelect }],
  });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'How this works' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Show first steps' }));
  expect(onSelect).toHaveBeenCalled();
  expect(usePageGuideStore.getState().request).toBeNull();

  await user.click(screen.getByRole('button', { name: 'How this works' }));
  await user.click(await screen.findByRole('menuitem', { name: 'How this works' }));
  expect(usePageGuideStore.getState().request?.id).toBe('budget');
});
