import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DEMO_ACCOUNT_METADATA_KEY, getDemoSpaceId, setDemoSpaceId } from '@shared/lib/demo-space';
import StartOwnBudgetPage from '@pages/StartOwnBudgetPage';
import { DemoBudgetBanner } from './DemoBudgetBanner';

const env = vi.hoisted(() => ({
  activeSpaceId: 'space-demo' as string | null,
  spaces: [{ space_id: 'space-demo' }] as { space_id: string }[],
  accounts: [] as { Metadata: string }[],
  accountsPending: false,
}));

vi.mock('@shared/runtime/runtime-provider', () => ({
  useActiveSpaceId: () => env.activeSpaceId,
  useAvailableSpaces: () => env.spaces,
}));
vi.mock('@shared/store/useUiStore', () => ({
  useUiStore: (select: (state: unknown) => unknown) => select({ selectedBudget: { ID: 7 } }),
}));
vi.mock('@entities/account/api/useAccounts', () => ({
  useAccounts: (_budgetId: number, enabled: boolean) => ({
    data: enabled && !env.accountsPending ? env.accounts : undefined,
    isPending: enabled && env.accountsPending,
  }),
}));
vi.mock('@pages/onboarding/OnboardingFlow', () => ({
  default: ({ mode }: { mode: string }) => <div>onboarding {mode}</div>,
}));

const demoAccount = { Metadata: JSON.stringify({ [DEMO_ACCOUNT_METADATA_KEY]: true }) };

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <DemoBudgetBanner />
        <Routes>
          <Route path="/start-own-budget" element={<StartOwnBudgetPage />} />
          <Route path="/budgeting" element={<div>budget page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  setDemoSpaceId(null);
  env.activeSpaceId = 'space-demo';
  env.spaces = [{ space_id: 'space-demo' }];
  env.accounts = [];
  env.accountsPending = false;
});

describe('demo banner', () => {
  it('shows on the demo workspace this device made', () => {
    setDemoSpaceId('space-demo');
    renderAt('/budgeting');
    expect(screen.getByTestId('demo-banner')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start my own budget' })).toHaveAttribute(
      'href',
      '/start-own-budget'
    );
  });

  it('recognises the demo from its synced accounts after sign-out or on another device', async () => {
    env.accounts = [demoAccount];
    renderAt('/budgeting');
    expect(screen.getByTestId('demo-banner')).toBeInTheDocument();
    await waitFor(() => expect(getDemoSpaceId()).toBe('space-demo'));
  });

  it('stays away from an ordinary workspace', () => {
    env.accounts = [{ Metadata: '{}' }];
    setDemoSpaceId('another-space');
    renderAt('/budgeting');
    expect(screen.queryByTestId('demo-banner')).toBeNull();
  });
});

describe('start my own budget page', () => {
  it('opens setup from the demo', () => {
    setDemoSpaceId('space-demo');
    renderAt('/start-own-budget');
    expect(screen.getByText('onboarding from_demo')).toBeInTheDocument();
  });

  it('waits for the accounts before deciding on a new device', () => {
    env.accountsPending = true;
    renderAt('/start-own-budget');
    expect(screen.queryByText('budget page')).toBeNull();
    expect(screen.queryByText(/onboarding/)).toBeNull();
  });

  it('sends anyone not in the demo back to the budget', () => {
    env.activeSpaceId = 'space-real';
    env.spaces = [{ space_id: 'space-real' }];
    setDemoSpaceId('space-demo');
    renderAt('/start-own-budget');
    expect(screen.getByText('budget page')).toBeInTheDocument();
  });

  it('sends the user back when the demo workspace no longer exists', () => {
    setDemoSpaceId('space-demo');
    env.spaces = [];
    renderAt('/start-own-budget');
    expect(screen.getByText('budget page')).toBeInTheDocument();
  });
});
