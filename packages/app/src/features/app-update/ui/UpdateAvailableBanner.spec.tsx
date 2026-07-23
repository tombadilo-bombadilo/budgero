import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { versionApi } from '@shared/api/api-client';
import type { Mock } from 'vitest';
import { UpdateAvailableBanner } from './UpdateAvailableBanner';

vi.mock('@shared/api/api-client', () => ({
  versionApi: {
    getLatest: vi.fn(),
  },
}));

vi.mock('@shared/lib/env', () => ({
  IS_SELF_HOSTABLE_BUILD: true,
}));

const mockedGetLatest = versionApi.getLatest as Mock;

function renderBanner() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <UpdateAvailableBanner />
    </QueryClientProvider>
  );
}

describe('UpdateAvailableBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('shows the banner when the server reports a newer release', async () => {
    mockedGetLatest.mockResolvedValueOnce({
      latest_version: '1.7.0',
      build_version: '1.6.0',
    });

    renderBanner();

    expect(await screen.findByText(/1\.7\.0 is available/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /what's new/i })).toHaveAttribute(
      'href',
      'https://budgero.app/changelog'
    );
  });

  it('stays hidden when already on the latest release', async () => {
    mockedGetLatest.mockResolvedValueOnce({
      latest_version: '1.6.0',
      build_version: '1.6.0',
    });

    renderBanner();

    await waitFor(() => {
      expect(mockedGetLatest).toHaveBeenCalled();
    });
    expect(screen.queryByText(/is available/)).not.toBeInTheDocument();
  });

  it('dismisses per-version and persists the dismissal', async () => {
    mockedGetLatest.mockResolvedValueOnce({
      latest_version: '1.7.0',
      build_version: '1.6.0',
    });

    renderBanner();

    const dismissButton = await screen.findByRole('button', { name: /dismiss/i });
    await userEvent.click(dismissButton);

    await waitFor(() => {
      expect(screen.queryByText(/is available/)).not.toBeInTheDocument();
    });
    expect(localStorage.getItem('budgero:update_available_dismissed:1.7.0')).toBe('1');
  });

  it('stays hidden when this version was dismissed before', async () => {
    localStorage.setItem('budgero:update_available_dismissed:1.7.0', '1');
    mockedGetLatest.mockResolvedValueOnce({
      latest_version: '1.7.0',
      build_version: '1.6.0',
    });

    renderBanner();

    await waitFor(() => {
      expect(mockedGetLatest).toHaveBeenCalled();
    });
    expect(screen.queryByText(/is available/)).not.toBeInTheDocument();
  });
});
