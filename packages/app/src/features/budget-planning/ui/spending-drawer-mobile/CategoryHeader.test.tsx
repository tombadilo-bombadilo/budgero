import { render, screen } from '@testing-library/react';
import { asMilli } from '@budgero/core/browser';
import { CategoryHeader } from './CategoryHeader';

const rsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'RSD',
  currencyDisplay: 'code',
  minimumFractionDigits: 2,
});

function renderHeader(overrides: Partial<Parameters<typeof CategoryHeader>[0]> = {}) {
  return render(
    <CategoryHeader
      selectedCategory={{ id: 1, name: 'Hrana i Pice' }}
      currentMonth="2026-11"
      loading={false}
      totalSpent={asMilli(-1234567890)}
      goalStatus={{ percentage: 47, isOver: false, remaining: asMilli(42723900) }}
      dailyAllowance={{ remaining: asMilli(42723900), perDay: asMilli(2373560), daysLeft: 18 }}
      globalLocalizer={rsd}
      {...overrides}
    />
  );
}

describe('CategoryHeader', () => {
  it('shows the full total without truncating it', () => {
    renderHeader();
    const total = screen.getByTestId('spending-total');
    expect(total.textContent?.replace(/\s/g, ' ')).toBe('RSD 1,234,567.89');
    expect(total.className).not.toMatch(/\btruncate\b|text-ellipsis|whitespace-nowrap/);
    expect(total.className).toContain('[overflow-wrap:anywhere]');
  });

  it('keeps the goal chip off the total row and lets the daily line wrap', () => {
    renderHeader();
    const total = screen.getByTestId('spending-total');
    expect(total).not.toHaveTextContent('% of goal');
    expect(screen.getByText('47% of goal')).toBeInTheDocument();
    const detail = screen.getByTestId('spending-goal-detail');
    expect(detail.textContent?.replace(/\s/g, ' ')).toBe('RSD 2,373.56/day left · 18 days');
    expect(detail.className).not.toMatch(/\btruncate\b|whitespace-nowrap/);
  });

  it('shows the full overspent amount', () => {
    renderHeader({
      goalStatus: { percentage: 112, isOver: true, remaining: asMilli(-123456780) },
      dailyAllowance: null,
    });
    const detail = screen.getByTestId('spending-goal-detail');
    expect(detail.textContent?.replace(/\s/g, ' ')).toBe('Over by RSD 123,456.78');
    expect(detail.className).not.toMatch(/\btruncate\b|whitespace-nowrap/);
  });
});
