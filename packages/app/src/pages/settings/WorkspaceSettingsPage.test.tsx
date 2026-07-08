import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import WorkspaceSettingsPage from './WorkspaceSettingsPage';

const {
  mockDeleteSpace,
  mockListSpaces,
  mockRefreshSpaces,
  mockSetStoredDefaultSpaceId,
  mockSwitchWorkspaceAndSyncBudgetState,
  mockSyncBudgetStateFromRuntime,
  mockUseProfile,
} = vi.hoisted(() => ({
  mockDeleteSpace: vi.fn(),
  mockListSpaces: vi.fn(),
  mockRefreshSpaces: vi.fn(),
  mockSetStoredDefaultSpaceId: vi.fn(),
  mockSwitchWorkspaceAndSyncBudgetState: vi.fn(),
  mockSyncBudgetStateFromRuntime: vi.fn(),
  mockUseProfile: vi.fn(),
}));

let activeSpaceId = 'space-owner';
let runtimeSpaces: Record<string, unknown>[] = [];

vi.mock('@entities/user/api/useAuth', () => ({
  useProfile: () => mockUseProfile(),
}));

vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => ({
    refreshSpaces: mockRefreshSpaces,
  }),
  useActiveSpaceId: () => activeSpaceId,
  useAvailableSpaces: () => runtimeSpaces,
}));

vi.mock('@shared/runtime/budget-gate', () => ({
  switchWorkspaceAndSyncBudgetState: mockSwitchWorkspaceAndSyncBudgetState,
  syncBudgetStateFromRuntime: mockSyncBudgetStateFromRuntime,
}));

vi.mock('@shared/api/api-client', () => ({
  spaceApi: {
    listSpaces: () => mockListSpaces(),
    deleteSpace: (spaceId: string) => mockDeleteSpace(spaceId),
    createSpace: vi.fn(),
    updateSpace: vi.fn(),
  },
}));

vi.mock('@shared/runtime/workspace-preferences', () => ({
  getStoredDefaultSpaceId: () => 'space-owner',
  setStoredDefaultSpaceId: (spaceId: string | null) => mockSetStoredDefaultSpaceId(spaceId),
}));

vi.mock('@features/budget-sharing/ui/WorkspaceSharingPanel', () => ({
  WorkspaceSharingPanel: () => <div data-testid="workspace-sharing-panel" />,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function createSpace(spaceId: string, overrides: Record<string, unknown> = {}) {
  return {
    space_id: spaceId,
    display_name: spaceId,
    owner_user_id: 'owner-1',
    role: 'owner',
    invitation_status: 'accepted',
    encrypted_space_key: '',
    is_accessible: true,
    created_at: '2026-03-16T00:00:00Z',
    ...overrides,
  };
}

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
        <WorkspaceSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('WorkspaceSettingsPage', () => {
  beforeEach(() => {
    activeSpaceId = 'space-owner';
    runtimeSpaces = [
      createSpace('space-owner', { display_name: 'Owner Workspace' }),
      createSpace('space-member', {
        display_name: 'Shared Workspace',
        owner_user_id: 'owner-2',
        role: 'member',
      }),
    ];
    mockUseProfile.mockReturnValue({
      data: {
        access_level: 'subscriber',
        can_access_owned_workspaces: true,
        can_access_shared_workspaces: true,
        can_create_workspace: true,
        has_accessible_workspace: true,
        has_locked_shared_workspace: false,
      },
    });
    mockListSpaces.mockResolvedValue(runtimeSpaces);
    mockDeleteSpace.mockResolvedValue({ success: true });
    mockRefreshSpaces.mockResolvedValue(undefined);
    mockSwitchWorkspaceAndSyncBudgetState.mockResolvedValue(undefined);
    mockSyncBudgetStateFromRuntime.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows delete only for owner workspaces', async () => {
    renderPage();

    expect(await screen.findByLabelText('Delete Owner Workspace')).toBeInTheDocument();
    expect(screen.queryByLabelText('Delete Shared Workspace')).not.toBeInTheDocument();
  });

  it('deleting the active workspace switches to another accessible workspace', async () => {
    mockListSpaces.mockResolvedValueOnce(runtimeSpaces).mockResolvedValueOnce([
      createSpace('space-member', {
        display_name: 'Shared Workspace',
        owner_user_id: 'owner-2',
        role: 'member',
      }),
    ]);

    renderPage();

    fireEvent.click(await screen.findByLabelText('Delete Owner Workspace'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }));

    await waitFor(() => expect(mockDeleteSpace).toHaveBeenCalledWith('space-owner'));
    await waitFor(() =>
      expect(mockSwitchWorkspaceAndSyncBudgetState).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: 'space-member' })
      )
    );
    expect(mockSetStoredDefaultSpaceId).toHaveBeenCalledWith(null);
  });

  it('deleting the last accessible workspace clears budget state instead of switching', async () => {
    runtimeSpaces = [createSpace('space-owner', { display_name: 'Owner Workspace' })];
    mockListSpaces.mockResolvedValueOnce(runtimeSpaces).mockResolvedValueOnce([]);

    renderPage();

    fireEvent.click(await screen.findByLabelText('Delete Owner Workspace'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }));

    await waitFor(() => expect(mockDeleteSpace).toHaveBeenCalledWith('space-owner'));
    await waitFor(() =>
      expect(mockSyncBudgetStateFromRuntime).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: null, candidateSelectedBudget: null })
      )
    );
    expect(mockSwitchWorkspaceAndSyncBudgetState).not.toHaveBeenCalled();
  });
});
