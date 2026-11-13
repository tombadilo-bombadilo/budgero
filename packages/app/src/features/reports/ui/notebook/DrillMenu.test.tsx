import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  normalizeQuestion,
  questionColumns,
  type BreakoutColumn,
  type QuestionSpec,
} from '@features/reports/lib/question';
import { useState } from 'react';
import { DrillMenu, type DrillRequest } from './DrillMenu';
import { withReturnFocus } from './drill-focus';

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  globalThis.ResizeObserver ??= class {
    observe() {}

    unobserve() {}

    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

const spec = normalizeQuestion({
  source: 'transactions',
  aggregations: [{ op: 'spending' }],
  breakouts: [{ field: 'date', bucket: 'month' }, { field: 'category' }],
});
const [month, category] = questionColumns(spec) as BreakoutColumn[];

function setup(request: DrillRequest) {
  const onDrill = vi.fn<(next: QuestionSpec) => void>();
  const onClose = vi.fn();
  render(<DrillMenu spec={spec} request={request} onDrill={onDrill} onClose={onClose} />);
  return { onDrill, onClose, user: userEvent.setup() };
}

const clicked: DrillRequest = {
  anchor: { x: 10, y: 10 },
  values: [
    { column: month, value: '2026-03' },
    { column: category, value: 'Groceries', key: 20 },
  ],
};

describe('DrillMenu', () => {
  it('lists the actions for a clicked stacked bar', async () => {
    setup(clicked);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('March 2026 · Groceries')).toBeInTheDocument();
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
    ).toEqual([
      'See these transactions',
      'Zoom in: by week',
      'Break out by…',
      'Only Groceries',
      'Exclude Groceries',
    ]);
  });

  it('see these transactions → raw rows filtered to both values', async () => {
    const { user, onDrill, onClose } = setup(clicked);
    await user.click(await screen.findByRole('menuitem', { name: 'See these transactions' }));
    const next = onDrill.mock.calls[0][0];
    expect(next.aggregations).toEqual([]);
    expect(next.filters).toEqual([
      { field: 'date', op: 'between', values: ['2026-03-01', '2026-03-31'] },
      { field: 'category', op: 'is', values: [20] },
      { field: 'is_income', op: 'is', values: [false] },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it('keyboard: open the break-out submenu and pick a field', async () => {
    const { user, onDrill } = setup(clicked);
    await screen.findByRole('menu');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowRight}');
    await user.click(await screen.findByRole('menuitem', { name: 'Payee' }));
    expect(onDrill.mock.calls[0][0].breakouts).toEqual([{ field: 'payee' }]);
  });

  it('exclude keeps the question and drops the value', async () => {
    const { user, onDrill } = setup(clicked);
    await user.click(await screen.findByRole('menuitem', { name: 'Exclude Groceries' }));
    const next = onDrill.mock.calls[0][0];
    expect(next.breakouts).toEqual(spec.breakouts);
    expect(next.filters.at(-1)).toEqual({ field: 'category', op: 'isNot', values: [20] });
  });

  it('renders nothing without a request', () => {
    const { container } = render(
      <DrillMenu spec={spec} request={null} onDrill={() => undefined} onClose={() => undefined} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('hands focus back to the clicked cell when it closes', async () => {
    function Harness() {
      const [request, setRequest] = useState<DrillRequest | null>(null);
      return (
        <>
          <button type="button" onClick={() => setRequest(withReturnFocus(clicked))}>
            Groceries cell
          </button>
          <DrillMenu
            spec={spec}
            request={request}
            onDrill={() => undefined}
            onClose={() => setRequest(null)}
          />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    const cell = screen.getByRole('button', { name: 'Groceries cell' });
    await user.click(cell);
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(cell).toHaveFocus();
  });
});
