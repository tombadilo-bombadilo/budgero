import { labelWidthFor } from './useElementWidth';

describe('labelWidthFor', () => {
  it('gives labels about a third of the chart, within bounds', () => {
    expect(labelWidthFor(320)).toBe(102);
    expect(labelWidthFor(150)).toBe(72);
    expect(labelWidthFor(1200)).toBe(200);
    expect(labelWidthFor(1200, 180)).toBe(180);
  });
});
