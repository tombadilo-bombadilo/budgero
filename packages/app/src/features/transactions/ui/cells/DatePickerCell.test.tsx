import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DatePickerCell } from './DatePickerCell';

afterEach(cleanup);

const dayButton = (day: string) =>
  screen
    .getAllByRole('button')
    .find((button) => button.closest('[data-day]')?.getAttribute('data-day') === day)!;

it('saves the day that was picked', () => {
  const onCommit = vi.fn();
  render(<DatePickerCell value="2026-11-03" onCommit={onCommit} defaultOpen />);
  fireEvent.click(dayButton('2026-11-12'));
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith('2026-11-12');
});

it('does not clear the date when the selected day is clicked again', () => {
  const onCommit = vi.fn();
  render(<DatePickerCell value="2026-11-03" onCommit={onCommit} defaultOpen />);
  fireEvent.click(dayButton('2026-11-03'));
  expect(onCommit).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '2026-11-03' })).toBeInTheDocument();
});
