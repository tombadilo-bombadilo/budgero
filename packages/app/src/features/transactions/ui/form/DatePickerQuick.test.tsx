import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { activateLocale } from '@shared/i18n';
import { DatePickerQuick } from './DatePickerQuick';

afterEach(async () => {
  cleanup();
  await activateLocale('en', false);
});

it('updates the selected date when the language changes without changing the date', async () => {
  await activateLocale('de', false);
  const onChange = vi.fn();
  render(
    <DatePickerQuick
      value={new Date(2026, 8, 16)}
      open={false}
      onOpenChange={vi.fn()}
      onChange={onChange}
    />
  );
  expect(screen.getByRole('button', { name: '16. September 2026' })).toBeInTheDocument();
  await act(() => activateLocale('fr', false));
  expect(screen.getByRole('button', { name: '16 septembre 2026' })).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

it('shows an optional time input only when the caller handles a time', async () => {
  const onTimeChange = vi.fn();
  const { rerender } = render(
    <DatePickerQuick
      value={new Date(2026, 8, 16)}
      open={false}
      onOpenChange={vi.fn()}
      onChange={vi.fn()}
    />
  );
  expect(screen.queryByLabelText('Time (optional)')).not.toBeInTheDocument();
  rerender(
    <DatePickerQuick
      value={new Date(2026, 8, 16)}
      open={false}
      onOpenChange={vi.fn()}
      onChange={vi.fn()}
      time=""
      onTimeChange={onTimeChange}
    />
  );
  const input = screen.getByLabelText('Time (optional)');
  expect(input).toHaveValue('');
  fireEvent.change(input, { target: { value: '14:30' } });
  expect(onTimeChange).toHaveBeenCalledWith('14:30');
});
