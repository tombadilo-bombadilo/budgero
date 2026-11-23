import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TimeInputCell } from './TimeInputCell';

afterEach(cleanup);

it('saves a changed time on blur and clears with an empty value', () => {
  const onCommit = vi.fn();
  render(<TimeInputCell value={null} onCommit={onCommit} />);
  const input = screen.getByLabelText('Time (optional)');
  fireEvent.blur(input);
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '07:15' } });
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenLastCalledWith('07:15');
});

it('Escape puts the stored time back', () => {
  const onCommit = vi.fn();
  render(<TimeInputCell value="09:00" onCommit={onCommit} />);
  const input = screen.getByLabelText('Time (optional)');
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(input).toHaveValue('09:00');
  fireEvent.blur(input);
  expect(onCommit).not.toHaveBeenCalled();
});
