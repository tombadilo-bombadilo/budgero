import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { normalizeQuestion } from '@features/reports/lib/question';
import { ChartTypePicker } from './ChartTypePicker';

afterEach(cleanup);

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}

    unobserve() {}

    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

// One metric by month: bars and lines work, a pivot needs two groupings.
const spec = normalizeQuestion({
  source: 'transactions',
  aggregations: [{ op: 'spending' }],
  breakouts: [{ field: 'date', bucket: 'month' }],
});

describe('ChartTypePicker', () => {
  it('is one tab stop with arrow keys between tiles', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<ChartTypePicker spec={spec} current="bar" onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: 'Chart type' }));
    const radios = screen.getAllByRole('radio');
    expect(radios.filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
    const bar = screen.getByRole('radio', { name: 'Bar' });
    expect(bar).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(bar).not.toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(bar).toHaveFocus();
  });

  it('says why a type is unavailable, also on tap', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<ChartTypePicker spec={spec} current="bar" onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: 'Chart type' }));
    const pivot = screen.getByRole('radio', { name: 'Pivot table' });
    expect(pivot).toHaveAttribute('aria-disabled', 'true');
    expect(pivot).toHaveAccessibleDescription(/.+/);
    await user.click(pivot);
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByText(/^Pivot table: /)).toBeInTheDocument();
  });
});
