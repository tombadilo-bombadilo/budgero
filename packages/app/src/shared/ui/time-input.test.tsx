import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { parseTimeInput } from '@shared/lib/time-input';
import { TimeInput } from './time-input';

afterEach(cleanup);

it('reads typed times', () => {
  expect(parseTimeInput('')).toBe('');
  expect(parseTimeInput('9')).toBe('09:00');
  expect(parseTimeInput('930')).toBe('09:30');
  expect(parseTimeInput('0930')).toBe('09:30');
  expect(parseTimeInput('14:05')).toBe('14:05');
  expect(parseTimeInput('9.30')).toBe('09:30');
  expect(parseTimeInput('9pm')).toBe('21:00');
  expect(parseTimeInput('12:15 am')).toBe('00:15');
  expect(parseTimeInput('12pm')).toBe('12:00');
  expect(parseTimeInput('24:00')).toBeNull();
  expect(parseTimeInput('9:75')).toBeNull();
  expect(parseTimeInput('13pm')).toBeNull();
  expect(parseTimeInput('abc')).toBeNull();
});

it('is a plain text field that reports times and tidies up on blur', () => {
  const onValueChange = vi.fn();
  render(<TimeInput value="" onValueChange={onValueChange} aria-label="Time" />);
  const input = screen.getByLabelText('Time');
  expect(input).toHaveAttribute('type', 'text');
  fireEvent.change(input, { target: { value: '715' } });
  expect(onValueChange).toHaveBeenLastCalledWith('07:15');
  fireEvent.blur(input);
  expect(input).toHaveValue('07:15');
});

it('puts the last time back when the text is not a time', () => {
  const onValueChange = vi.fn();
  render(<TimeInput value="09:00" onValueChange={onValueChange} aria-label="Time" />);
  const input = screen.getByLabelText('Time');
  fireEvent.change(input, { target: { value: '99' } });
  expect(onValueChange).not.toHaveBeenCalled();
  fireEvent.blur(input);
  expect(input).toHaveValue('09:00');
});
