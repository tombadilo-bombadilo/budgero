import { render, screen } from '@testing-library/react';
import type { SelfHostInstallSummary } from '@features/admin/model/admin-dashboard';
import SelfHostInstallsSection from './SelfHostInstallsSection';

const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@features/admin/api/useAdminApi', () => {
  const api = { getSelfHostInstalls: () => mock.get() };
  return { useAdminApi: () => api };
});
vi.mock('@shared/ui/echart', () => ({
  EChart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

const summary: SelfHostInstallSummary = {
  weeks: [
    { week: '2026-10-19', installs: 14, partial: false },
    { week: '2026-10-26', installs: 9, partial: true },
  ],
  versions: [
    { version: '1.18.0', pings: 108, days: 14 },
    { version: '1.19.5', pings: 20, days: 4 },
  ],
  days: 14,
};

describe('self-host installs card', () => {
  it('shows the last full week, this week so far and pings by version', async () => {
    mock.get.mockResolvedValue(summary);
    render(<SelfHostInstallsSection />);

    expect(await screen.findByText('14')).toBeInTheDocument();
    expect(screen.getByText('Last full week')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Weekly active self-host installs' })
    ).toBeInTheDocument();
    expect(screen.getByText('1.18.0')).toBeInTheDocument();
    expect(screen.getByText('108 pings · 14 days')).toBeInTheDocument();
  });

  it('says when the counts could not be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mock.get.mockRejectedValue(new Error('boom'));
    render(<SelfHostInstallsSection />);
    expect(await screen.findByText('Couldn’t load self-host installs.')).toBeInTheDocument();
  });
});
