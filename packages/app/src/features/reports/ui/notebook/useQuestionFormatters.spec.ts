import { describe, expect, it } from 'vitest';
import { resultBinWidths } from './useQuestionFormatters';

describe('resultBinWidths', () => {
  it('reads auto bin widths from the hidden key columns', () => {
    expect(
      resultBinWidths({
        columns: ['outflow_bin', 'count', 'outflow_bin__key', 'category__key'],
        rows: [[100, 3, 50, 7]],
        rowCount: 1,
      } as never)
    ).toEqual(new Map([['outflow_bin', 50]]));
    expect(resultBinWidths(null)).toEqual(new Map());
  });
});
