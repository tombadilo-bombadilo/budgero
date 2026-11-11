import { mobileTableColumnVars } from './mobile-table-columns';

describe('mobileTableColumnVars', () => {
  it('sizes each column by its label and its widest amount, as CSS strings', () => {
    const vars = mobileTableColumnVars({
      allocatedLabel: 'Allocated',
      availableLabel: 'Verfügbar',
      allocatedValues: ['$0.00', '$1,475.00', '$80.00'],
      availableValues: ['-$12.00', '$18,064.09', '$0.00'],
    }) as Record<string, string>;

    expect(vars['--budget-col-allocated-label']).toBe('"Allocated"');
    expect(vars['--budget-col-available-label']).toBe('"Verfügbar"');
    expect(vars['--budget-col-allocated-value']).toBe('"$1,475.00"');
    expect(vars['--budget-col-available-value']).toBe('"$18,064.09"');
  });

  it('escapes quotes so a label cannot break out of the CSS string', () => {
    const vars = mobileTableColumnVars({
      allocatedLabel: 'Say "hi"',
      availableLabel: '',
      allocatedValues: [],
      availableValues: [],
    }) as Record<string, string>;

    expect(vars['--budget-col-allocated-label']).toBe('"Say \\"hi\\""');
    expect(vars['--budget-col-available-value']).toBe('""');
  });
});
