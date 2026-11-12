import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import {
  getFirstSteps,
  hideFirstSteps,
  resetFirstStepsForTests,
  startFirstSteps,
} from '@shared/lib/first-steps/first-steps';
import { FirstStepsSettingsCard } from '../ui/FirstStepsSettingsCard';
import { isFirstStepsHidden, showFirstSteps, useShowFirstStepsMenuItems } from './visibility';

vi.mock('@shared/runtime/runtime-provider', () => ({ useActiveSpaceId: () => 'space-1' }));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({ getActiveSpaceId: () => 'space-1' }),
}));

const at =
  (path: string) =>
  ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  );

beforeEach(() => {
  localStorage.clear();
  resetFirstStepsForTests();
});

it('showFirstSteps() and isFirstStepsHidden() work on the open workspace', () => {
  expect(isFirstStepsHidden()).toBe(false);
  showFirstSteps(); // no list: nothing appears
  expect(getFirstSteps('space-1')).toBeNull();
  startFirstSteps('space-1');
  hideFirstSteps('space-1');
  expect(isFirstStepsHidden()).toBe(true);
  showFirstSteps();
  expect(isFirstStepsHidden()).toBe(false);
});

describe('the Help menu item', () => {
  it('is offered on the Budget page while the list is hidden, and brings it back', () => {
    startFirstSteps('space-1');
    const { result } = renderHook(() => useShowFirstStepsMenuItems(), {
      wrapper: at('/budgeting'),
    });
    expect(result.current).toEqual([]);
    act(() => hideFirstSteps('space-1'));
    expect(result.current).toEqual([
      { key: 'first-steps', label: 'Show first steps', onSelect: expect.any(Function) },
    ]);
    act(() => result.current[0].onSelect());
    expect(getFirstSteps('space-1')?.dismissed).toBe(false);
    expect(result.current).toEqual([]);
  });

  it('is not offered on other pages or for a workspace without a list', () => {
    const { result } = renderHook(() => useShowFirstStepsMenuItems(), {
      wrapper: at('/budgeting'),
    });
    expect(result.current).toEqual([]);
    startFirstSteps('space-1');
    hideFirstSteps('space-1');
    const other = renderHook(() => useShowFirstStepsMenuItems(), { wrapper: at('/accounts') });
    expect(other.result.current).toEqual([]);
  });
});

describe('Budget Settings', () => {
  it('shows nothing for a workspace without a list', () => {
    render(<FirstStepsSettingsCard />);
    expect(screen.queryByText('First steps')).toBeNull();
  });

  it('switches the list off and on', () => {
    startFirstSteps('space-1');
    render(<FirstStepsSettingsCard />);
    const toggle = screen.getByRole('switch', { name: 'Show first steps on the Planning page' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(getFirstSteps('space-1')?.dismissed).toBe(true);
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(getFirstSteps('space-1')?.dismissed).toBe(false);
  });
});
