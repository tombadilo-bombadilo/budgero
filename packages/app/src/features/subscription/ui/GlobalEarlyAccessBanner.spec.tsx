import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiClient } from '@shared/api/api-client';
import type { Mock } from 'vitest';
import EarlyAccessBanner from './GlobalEarlyAccessBanner';

vi.mock('@shared/api/api-client', () => {
  return {
    apiClient: {
      get: vi.fn(),
    },
  };
});

const mockedGet = apiClient.get as Mock;

describe('EarlyAccessBanner', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('fetches config and renders the banner when early access is enabled', async () => {
    mockedGet.mockResolvedValueOnce({
      early_access_mode: true,
      early_access_message: 'Welcome to early access!',
    });

    render(<EarlyAccessBanner />);

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith('/config');
    });

    expect(await screen.findByText('Welcome to early access!')).toBeInTheDocument();
  });

  it('dismisses the banner and records dismissal in session storage', async () => {
    mockedGet.mockResolvedValueOnce({
      early_access_mode: true,
      early_access_message: 'Dismiss me',
    });

    render(<EarlyAccessBanner />);

    const dismissButton = await screen.findByRole('button', { name: /dismiss/i });
    await userEvent.click(dismissButton);

    await waitFor(() => {
      expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument();
    });
    expect(sessionStorage.getItem('early-access-banner-dismissed')).toBe('true');
  });

  it('skips fetch and stays hidden if dismissed this session', async () => {
    sessionStorage.setItem('early-access-banner-dismissed', 'true');

    render(<EarlyAccessBanner />);

    await waitFor(() => {
      expect(mockedGet).not.toHaveBeenCalled();
    });

    expect(screen.queryByText(/early access/i)).not.toBeInTheDocument();
  });
});
