import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Budget } from '@budgero/core/browser';
import { useUiStore } from '@shared/store/useUiStore';
import { DashboardPage } from './DashboardPage';

vi.mock('./HomeDashboard', () => ({
  // Stands in for the home page: holds its own edit mode like the real one.
  HomeDashboard: () => {
    const [editing, setEditing] = useState(false);
    return (
      <button type="button" onClick={() => setEditing(true)}>
        {editing ? 'editing' : 'viewing'}
      </button>
    );
  },
}));

afterEach(cleanup);

describe('DashboardPage', () => {
  it('leaves edit mode when the budget changes', async () => {
    act(() => useUiStore.getState().setSelectedBudget({ ID: 1, SpaceID: 's1' } as Budget));
    render(<DashboardPage />);
    await userEvent.setup().click(screen.getByRole('button'));
    expect(screen.getByRole('button').textContent).toBe('editing');
    act(() => useUiStore.getState().setSelectedBudget({ ID: 2, SpaceID: 's1' } as Budget));
    expect(screen.getByRole('button').textContent).toBe('viewing');
    await userEvent.setup().click(screen.getByRole('button'));
    // Same budget number in another space: also a fresh page.
    act(() => useUiStore.getState().setSelectedBudget({ ID: 2, SpaceID: 's2' } as Budget));
    expect(screen.getByRole('button').textContent).toBe('viewing');
  });
});
