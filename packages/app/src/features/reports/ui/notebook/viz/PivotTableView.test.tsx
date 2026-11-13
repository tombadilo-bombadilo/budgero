import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { normalizeQuestion, questionColumns } from '@features/reports/lib/question';
import { PivotTableView } from './PivotTableView';

const download = vi.hoisted(() => ({ calls: [] as [string, string][] }));
vi.mock('@shared/lib/download', () => ({
  downloadBlob: (data: string, filename: string) => download.calls.push([String(data), filename]),
}));

const spec = normalizeQuestion({
  source: 'transactions',
  aggregations: [{ op: 'count' }],
  breakouts: [{ field: 'category_group' }, { field: 'account' }],
});
const result = {
  columns: ['category_group', 'account', 'count'],
  rows: [
    ['Bills', 'Checking', 4],
    ['Bills', 'Card', 1],
    ['Fun', 'Card', 7],
    ['Food', 'Checking', 2],
  ],
  rowCount: 4,
  executionTime: 1,
};

afterEach(cleanup);

function bodyRowNames() {
  const [, body] = screen.getAllByRole('rowgroup');
  return within(body)
    .getAllByRole('row')
    .map((row) => within(row).getByRole('rowheader').textContent);
}

describe('PivotTableView', () => {
  it('lays out groups × accounts with row and column totals', () => {
    render(
      <PivotTableView result={result} columns={questionColumns(spec)} source="transactions" />
    );
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    // Columns by size: Card (8) before Checking (6), then the total.
    expect(headers).toEqual(['Category group \\ Account', 'Card', 'Checking', 'Total']);
    expect(bodyRowNames()).toEqual(['Bills', 'Fun', 'Food']);
    const bills = screen.getByRole('rowheader', { name: 'Bills' }).closest('tr')!;
    expect(
      within(bills)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    ).toEqual(['1', '4', '5']);
    const food = screen.getByRole('rowheader', { name: 'Food' }).closest('tr')!;
    expect(
      within(food)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    ).toEqual(['—', '2', '2']);
    const totals = screen.getAllByRole('rowheader', { name: 'Total' })[0].closest('tr')!;
    expect(
      within(totals)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    ).toEqual(['8', '6', '14']);
  });

  it('sorts rows from the headers and cycles back to the question order', async () => {
    const user = userEvent.setup();
    render(
      <PivotTableView result={result} columns={questionColumns(spec)} source="transactions" />
    );
    const card = screen.getByRole('columnheader', { name: /Card/ });
    await user.click(within(card).getByRole('button'));
    expect(card).toHaveAttribute('aria-sort', 'descending');
    expect(bodyRowNames()).toEqual(['Fun', 'Bills', 'Food']);
    await user.click(within(card).getByRole('button'));
    expect(card).toHaveAttribute('aria-sort', 'ascending');
    // No Card rows for Food counts as 0.
    expect(bodyRowNames()).toEqual(['Food', 'Bills', 'Fun']);
    await user.click(within(card).getByRole('button'));
    expect(card).toHaveAttribute('aria-sort', 'none');
    expect(bodyRowNames()).toEqual(['Bills', 'Fun', 'Food']);

    const corner = screen.getByRole('columnheader', { name: /Category group/ });
    await user.click(within(corner).getByRole('button'));
    expect(bodyRowNames()).toEqual(['Bills', 'Food', 'Fun']);
  });

  it('downloads the pivot as CSV', async () => {
    const user = userEvent.setup();
    download.calls.length = 0;
    render(
      <PivotTableView
        result={result}
        columns={questionColumns(spec)}
        source="transactions"
        exportName="Counts"
      />
    );
    await user.click(screen.getByRole('button', { name: /Pivot CSV/ }));
    expect(download.calls).toHaveLength(1);
    const [csv, filename] = download.calls[0];
    expect(filename).toBe('Counts.csv');
    // UTF-8 BOM first, so Excel reads non-ASCII names right.
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\n')).toEqual([
      'Category group \\ Account,Card,Checking,Total',
      'Bills,1,4,5',
      'Fun,7,,7',
      'Food,,2,2',
      'Total,8,6,14',
    ]);
  });
});
