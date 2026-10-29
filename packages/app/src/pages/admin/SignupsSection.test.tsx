import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SignupSeries } from '@features/admin/model/admin-dashboard';
import SignupsSection from './SignupsSection';

const mock = vi.hoisted(() => ({ get: vi.fn(), option: null as unknown }));
vi.mock('@features/admin/api/useAdminApi', () => {
  const api = { getSignups: (...args: unknown[]) => mock.get(...args) };
  return { useAdminApi: () => api };
});
vi.mock('@shared/ui/echart', () => ({
  EChart: ({ ariaLabel, option }: { ariaLabel: string; option: unknown }) => {
    mock.option = option;
    return <div role="img" aria-label={ariaLabel} />;
  },
}));

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.scrollIntoView = () => {};
});

const series = (granularity: SignupSeries['granularity']): SignupSeries => ({
  from: '2026-10-01',
  to: '2026-10-31',
  granularity,
  total: 5,
  points: [
    { period: '2026-W39', start: '2026-10-01', signups: 0 },
    { period: '2026-W40', start: '2026-10-05', signups: 3 },
    { period: '2026-W41', start: '2026-10-12', signups: 2 },
  ],
});

describe('signups card', () => {
  it('loads daily by default and refetches with the chosen grouping', async () => {
    mock.get.mockReset().mockResolvedValue(series('daily'));
    render(<SignupsSection />);

    await waitFor(() => expect(mock.get).toHaveBeenCalledTimes(1));
    expect(mock.get.mock.calls[0]?.[2]).toBe('daily');
    expect(await screen.findByRole('img', { name: 'Signups over time' })).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    mock.get.mockResolvedValue(series('weekly'));
    await userEvent.click(screen.getByLabelText('Group by'));
    await userEvent.click(await screen.findByRole('option', { name: 'Week' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(mock.get).toHaveBeenCalledTimes(2));
    expect(mock.get.mock.calls[1]?.[2]).toBe('weekly');
    const option = mock.option as { series: { data: number[] }[] };
    expect(option.series[0]?.data).toEqual([0, 3, 2]);
  });
});
