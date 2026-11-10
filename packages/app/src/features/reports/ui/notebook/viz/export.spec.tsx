import { cleanup, render } from '@testing-library/react';
import { ChartLegend } from './ChartLegend';
import { layoutLegend, readLegend, safeFileName } from './export';

afterEach(cleanup);

describe('PNG legend', () => {
  it('reads the shown legend and leaves hidden series out', () => {
    const { container } = render(
      <ChartLegend
        items={[
          { id: 'a', label: 'Rent', color: '#111111' },
          { id: 'b', label: 'Food', color: '#222222' },
        ]}
        hidden={new Set(['b'])}
        onToggle={() => undefined}
      />
    );
    expect(readLegend(container)).toEqual([{ label: 'Rent', color: '#111111' }]);
  });

  it('wraps entries into rows that fit the image', () => {
    const sizes = { swatch: 10, gap: 6, spacing: 14, rowHeight: 18, maxLabel: 200 };
    const entries = ['Aaaa', 'Bbbb', 'Cccc'].map((label) => ({ label, color: '#000' }));
    // Each entry is 10 + 6 + 40 = 56 wide, plus 14 spacing.
    const { items, height } = layoutLegend(entries, () => 40, 130, sizes);
    expect(items.map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [70, 0],
      [0, 18],
    ]);
    expect(height).toBe(36);
    expect(layoutLegend([], () => 0, 100, sizes).height).toBe(0);
  });
});

describe('safeFileName', () => {
  it('drops path separators and control characters', () => {
    expect(safeFileName('a/b:c\u0007 d')).toBe('a b c d');
    expect(safeFileName('   ')).toBe('question');
  });
});
