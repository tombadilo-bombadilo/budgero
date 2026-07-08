import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import DataManagementPage from './DataManagementPage';

const mockUseProfile = vi.fn();
const mockListSpaces = vi.fn();

vi.mock('@entities/user/api/useAuth', () => ({
  useProfile: () => mockUseProfile(),
  useRecordBackup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateBackupSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => ({
    services: () => ({
      export: {
        exportDatabase: vi.fn(),
        exportCSV: vi.fn(),
      },
    }),
    getDatabase: vi.fn(),
    finalizeOutOfBandMutation: vi.fn(),
  }),
  useActiveSpace: () => null,
}));

vi.mock('@shared/api/api-client', () => ({
  spaceApi: {
    listSpaces: () => mockListSpaces(),
  },
}));

vi.mock('@features/subscription/ui/ExportDataCard', () => ({
  default: ({ spaceId, embedded }: { spaceId: string | null | undefined; embedded?: boolean }) => (
    <div data-testid="export-data-card">
      {embedded ? 'embedded' : 'card'}:{spaceId ?? 'none'}
    </div>
  ),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DataManagementPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('DataManagementPage', () => {
  beforeEach(() => {
    mockUseProfile.mockReturnValue({
      data: {
        subscription_status: 'expired',
        access_level: 'none',
        can_access_owned_workspaces: false,
        can_access_shared_workspaces: false,
        can_create_workspace: false,
        has_accessible_workspace: false,
        has_locked_shared_workspace: false,
        primary_space_id: 'space-owner-2',
      },
    });
    mockListSpaces.mockResolvedValue([
      {
        space_id: 'space-owner-1',
        display_name: 'Locked owner 1',
        role: 'owner',
        invitation_status: 'accepted',
        is_accessible: false,
        owner_user_id: 'u1',
        encrypted_space_key: 'k1',
        created_at: '2026-03-15T00:00:00Z',
      },
      {
        space_id: 'space-owner-2',
        display_name: 'Locked owner 2',
        role: 'owner',
        invitation_status: 'accepted',
        is_accessible: false,
        owner_user_id: 'u1',
        encrypted_space_key: 'k2',
        created_at: '2026-03-15T00:00:00Z',
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows export recovery for locked owner workspaces', async () => {
    renderPage();

    expect(
      await screen.findByText(/you can still export their data here for recovery or migration/i)
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByTestId('export-data-card')).toHaveTextContent('embedded:space-owner-2')
    );
  });
});
