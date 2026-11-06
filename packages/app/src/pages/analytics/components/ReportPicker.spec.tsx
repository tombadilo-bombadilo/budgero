import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReportKey } from '../analytics-state';
import { ReportPicker } from './ReportPicker';

function Harness() {
  const [value, setValue] = useState<ReportKey>('wealth');
  return <ReportPicker value={value} onChange={setValue} />;
}

describe('ReportPicker', () => {
  it('lists every report as a question tab with its short name', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(7);
    expect(screen.getByRole('tablist', { name: 'Reports' })).toBeInTheDocument();
    const spending = screen.getByRole('tab', { name: /Where does my money go\?/ });
    expect(spending).toHaveTextContent('Spending');
    expect(spending).toHaveAttribute('aria-selected', 'false');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(spending).toHaveAttribute('tabindex', '-1');
  });

  it('selects on click and moves with the arrow keys, Home and End', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('tab', { name: /Where does my money go\?/ }));
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Spending');

    fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key: 'ArrowRight' });
    const inOut = screen.getByRole('tab', { selected: true });
    expect(inOut).toHaveTextContent('In vs Out');
    expect(inOut).toHaveFocus();

    fireEvent.keyDown(inOut, { key: 'End' });
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Ledger');
    fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Wealth');
    fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Ledger');
    fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key: 'Home' });
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Wealth');
  });
});
