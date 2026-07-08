import React from 'react';
import { render, screen } from '@testing-library/react';

import { WorkspaceSharingPanel } from './WorkspaceSharingPanel';

const mockUseSpaceMembers = vi.fn();
const mockUseSpaceInvites = vi.fn();
const mockUseOwnedWorkspaceSeatUsage = vi.fn();

vi.mock('@features/budget-sharing/api/useBudgetSpaceSharing', () => ({
  useSpaceMembers: () => mockUseSpaceMembers(),
  useSpaceInvites: () => mockUseSpaceInvites(),
  useOwnedWorkspaceSeatUsage: () => mockUseOwnedWorkspaceSeatUsage(),
  useCreateSpaceInvite: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelSpaceInvite: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveSpaceMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRedeemSpaceInvite: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => ({
    requireSpaceKey: vi.fn(),
  }),
}));

vi.mock('@shared/lib/crypto', () => ({
  MasterPasswordManager: {
    get: vi.fn(),
    store: vi.fn(),
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

describe('WorkspaceSharingPanel', () => {
  beforeEach(() => {
    mockUseSpaceMembers.mockReturnValue({ data: [], isLoading: false });
    mockUseSpaceInvites.mockReturnValue({ data: [], isLoading: false });
    mockUseOwnedWorkspaceSeatUsage.mockReturnValue({
      occupiedSlots: 4,
      remainingSlots: 1,
      sharingLimitReached: false,
      isLoading: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows owner-wide collaborator seat usage copy and count', async () => {
    render(
      <WorkspaceSharingPanel
        activeSpace={createSpace('space-owner')}
        spaces={[createSpace('space-owner'), createSpace('space-other')]}
      />
    );

    expect(
      screen.getByText(/collaborator seats used across your owned workspaces/i)
    ).toBeInTheDocument();
    expect(screen.getByText('4/5')).toBeInTheDocument();
    expect(
      screen.getByText(
        /you can use up to 5 collaborator seats across all of your owned workspaces/i
      )
    ).toBeInTheDocument();
  });
});
