import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import OnboardingFlow from './OnboardingFlow';

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  trackOnUnload: vi.fn(),
  apply: vi.fn(),
  readInvite: vi.fn(),
  navigate: vi.fn(),
  returnToDemo: vi.fn(),
  checkInviteCode: vi.fn(),
}));

vi.mock('./invite-code', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./invite-code')>()),
  checkInviteCode: mocks.checkInviteCode,
}));

vi.mock('@shared/lib/analytics/track', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/lib/analytics/track')>()),
  track: mocks.track,
  trackOnUnload: mocks.trackOnUnload,
}));
vi.mock('./apply-onboarding', () => ({
  runOnboardingApply: mocks.apply,
  newOnboardingAttempt: (demoSpaceId: string | null = null) => ({
    spaceId: null,
    demoSpaceId,
    demoProven: null,
  }),
  returnToDemo: mocks.returnToDemo,
}));
vi.mock('@features/budget-sharing/lib/pending-space-invite', () => ({
  readPendingSpaceInvite: mocks.readInvite,
}));
const runtime = {
  connectivityState: () => ({ overall: false }),
  onConnectivityChange: () => () => undefined,
  getActiveSpaceId: () => 'space-demo',
};
vi.mock('@shared/runtime/runtime-provider', () => ({ useRuntime: () => runtime }));
vi.mock('@entities/user/api/useAuth', () => ({
  useLogout: () => ({ mutate: vi.fn() }),
  useProfile: () => ({ data: { id: 'profile-1' } }),
  useUpdateOnboarding: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}));

function renderFlow(mode?: 'intro' | 'from_demo', onComplete = vi.fn()) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <OnboardingFlow mode={mode} onComplete={onComplete} />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function stepViews() {
  return mocks.track.mock.calls
    .filter(([name]) => name === 'onboarding_step_viewed')
    .map(([, props]) => props as { step: string; path: string });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readInvite.mockResolvedValue(null);
});

it('shows an invitee the join path only, without flashing the start screen first', async () => {
  let resolveInvite!: (secret: string | null) => void;
  mocks.readInvite.mockReturnValue(new Promise((resolve) => (resolveInvite = resolve)));
  renderFlow();

  // While the invite is being read: no step, no event.
  expect(screen.queryByText('Welcome to Budgero.')).toBeNull();
  expect(stepViews()).toEqual([]);

  await act(async () => resolveInvite('secret'));
  await waitFor(() => expect(stepViews()).toEqual([{ step: 'welcome', path: 'join' }]));
  expect(screen.queryByRole('button', { name: /Try a demo budget/ })).toBeNull();
});

it('labels the start button after the chosen way to start', async () => {
  renderFlow();
  await screen.findByText('Welcome to Budgero.');
  expect(screen.getByRole('button', { name: 'Pick a way to start' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Try a demo budget/ }));
  expect(screen.getByRole('button', { name: /Try a demo budget/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Try the demo →' }));
  // The demo's password step says why even a demo needs one.
  expect(screen.getByText(/Even the demo is encrypted on your device/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Back/ }));
  fireEvent.click(screen.getByRole('button', { name: /Import from YNAB/ }));
  expect(screen.getByRole('button', { name: 'Import from YNAB →' })).toBeEnabled();
});

it('keeps the step buttons outside the scrolling step, with no artwork', async () => {
  renderFlow();
  await screen.findByText('Welcome to Budgero.');
  fireEvent.click(screen.getByRole('button', { name: /Start my own budget/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Set up my budget →' }));
  const main = screen.getByRole('main');
  // A long step scrolls inside <main>; Next stays in view below it.
  expect(main).toHaveClass('overflow-y-auto');
  expect(main).not.toContainElement(screen.getByRole('button', { name: 'Next →' }));
  expect(main.querySelector('img[src*="onboarding"]')).toBeNull();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
});

it('Enter in the master password moves on to the confirm field', async () => {
  renderFlow();
  await screen.findByText('Welcome to Budgero.');
  fireEvent.click(screen.getByRole('button', { name: /Try a demo budget/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Try the demo →' }));
  const [first, confirm] = document.querySelectorAll<HTMLInputElement>('input[type=password]');
  expect(first).toHaveAttribute('enterkeyhint', 'next');
  first.focus();
  fireEvent.keyDown(first, { key: 'Enter' });
  expect(confirm).toHaveFocus();
});

it('reports leaving again after the page comes back from the back/forward cache', async () => {
  renderFlow();
  await screen.findByText('Welcome to Budgero.');
  act(() => {
    window.dispatchEvent(new Event('pagehide'));
  });
  expect(mocks.trackOnUnload).toHaveBeenCalledTimes(1);
  act(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new Event('pagehide'));
  });
  expect(mocks.trackOnUnload).toHaveBeenCalledTimes(2);
  expect(mocks.trackOnUnload).toHaveBeenLastCalledWith(
    'onboarding_left',
    expect.objectContaining({ step: 'start_mode', path: 'fresh' })
  );
});

describe('leaving the demo', () => {
  it('offers a visible way back to the demo and skips the password', async () => {
    renderFlow('from_demo');
    mocks.returnToDemo.mockResolvedValue(undefined);
    fireEvent.click(screen.getByTestId('back-to-demo'));
    // Reopens the demo that was open when setup started (and drops anything
    // a failed attempt half-built) before going back to it.
    expect(mocks.returnToDemo).toHaveBeenCalledWith(
      runtime,
      expect.anything(),
      expect.objectContaining({ demoSpaceId: 'space-demo' })
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/budgeting'));
    expect(mocks.readInvite).not.toHaveBeenCalled();
    expect(stepViews()[0]).toEqual({ step: 'currency', path: 'from_demo' });
  });

  it("says the demo goes, and doesn't call the password 'not set'", async () => {
    renderFlow('from_demo');
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: /Let’s begin|Next/ }));
    }
    expect(screen.getByText('YOUR BUDGET SUMMARY')).toBeInTheDocument();
    expect(screen.queryByText('Security')).toBeNull();
    expect(screen.queryByText(/not set/)).toBeNull();
    expect(screen.getByText('1 added')).toBeInTheDocument();
    expect(screen.getByText('Deleted when you open yours')).toBeInTheDocument();
  });
});

describe('the currency', () => {
  it("starts on the browser region's currency", () => {
    const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE']);
    try {
      renderFlow('from_demo');
      for (let i = 0; i < 3; i += 1) {
        fireEvent.click(screen.getByRole('button', { name: /Let’s begin|Next/ }));
      }
      expect(screen.getByText('EUR (€)')).toBeInTheDocument();
    } finally {
      languages.mockRestore();
    }
  });
});

describe('the step counter', () => {
  it('is a translated label', async () => {
    renderFlow();
    expect(await screen.findByText('STEP 01 / 06')).toBeInTheDocument();
  });
});

describe('joining with an invite code', () => {
  function pickJoin() {
    fireEvent.click(screen.getByRole('button', { name: /Join with an invite code/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Enter my code →' }));
  }
  function codeInput() {
    return screen.getByLabelText('INVITE CODE');
  }

  it('is a fourth way to start, with its own short path', async () => {
    renderFlow();
    await screen.findByText('Welcome to Budgero.');
    for (const name of [
      /Start my own budget/,
      /Import from YNAB/,
      /Try a demo budget/,
      /Join with an invite code/,
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    pickJoin();
    expect(screen.getByText('STEP 02 / 04')).toBeInTheDocument();
    const sidebar = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(sidebar).toEqual([
      expect.stringContaining('How are you starting?'),
      expect.stringContaining('Enter your invite code'),
      expect.stringContaining('Lock it with a master password'),
      expect.stringContaining('You’re ready'),
    ]);
    expect(stepViews()).toContainEqual({ step: 'invite_code', path: 'join_code' });
    expect(mocks.track).toHaveBeenCalledWith(
      'onboarding_step_completed',
      expect.objectContaining({ step: 'start_mode', path: 'join_code' })
    );
    expect(screen.getByRole('button', { name: 'Check code →' })).toBeDisabled();
  });

  it('checks the pasted link, then joins with the password', async () => {
    mocks.checkInviteCode.mockResolvedValue({ ok: true, spaceName: 'Family budget' });
    const onComplete = vi.fn();
    renderFlow('intro', onComplete);
    await screen.findByText('Welcome to Budgero.');
    pickJoin();
    fireEvent.change(codeInput(), {
      target: { value: ' https://my.budgero.app/join#code=abc123 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check code →' }));
    await screen.findByText('Lock your ledger.');
    expect(mocks.checkInviteCode).toHaveBeenCalledWith('abc123');

    const [pw, confirm] = document.querySelectorAll<HTMLInputElement>('input[type=password]');
    fireEvent.change(pw, { target: { value: 'long-password' } });
    fireEvent.change(confirm, { target: { value: 'long-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    expect(screen.getByText('Ready to join.')).toBeInTheDocument();
    expect(screen.getByText('Family budget')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Join workspace →' }));

    expect(mocks.apply).toHaveBeenCalledWith(
      expect.objectContaining({ startMode: 'join', inviteCode: 'abc123', joinSecret: null }),
      expect.objectContaining({ activePath: 'join_code' })
    );
  });

  it.each([
    ['not_found', /doesn’t match an open invite/],
    ['expired', /has expired/],
    ['incomplete', /isn’t ready yet/],
    ['network', /Couldn’t reach Budgero/],
  ] as const)('says why a %s code is turned down, until it is edited', async (reason, text) => {
    mocks.checkInviteCode.mockResolvedValue({ ok: false, reason });
    renderFlow();
    await screen.findByText('Welcome to Budgero.');
    pickJoin();
    fireEvent.change(codeInput(), { target: { value: 'nope' } });
    fireEvent.keyDown(codeInput(), { key: 'Enter' });

    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(codeInput()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Check code →' })).toBeDisabled();
    expect(mocks.track).toHaveBeenCalledWith('onboarding_invite_code_rejected', { reason });
    // The code itself never goes into an event.
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain('nope');
    expect(screen.queryByText('Lock your ledger.')).toBeNull();

    fireEvent.change(codeInput(), { target: { value: 'nope2' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Check code →' })).toBeEnabled();
  });

  it('an invite link skips the code step and joins with the link code', async () => {
    mocks.readInvite.mockResolvedValue('from-link');
    renderFlow();
    await screen.findByText('You’re joining a Budgero workspace.');
    expect(screen.queryByLabelText('INVITE CODE')).toBeNull();
    expect(screen.getByText('STEP 01 / 04')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Let’s begin →' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    const [pw, confirm] = document.querySelectorAll<HTMLInputElement>('input[type=password]');
    fireEvent.change(pw, { target: { value: 'long-password' } });
    fireEvent.change(confirm, { target: { value: 'long-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    fireEvent.click(screen.getByRole('button', { name: 'Join workspace →' }));
    expect(mocks.checkInviteCode).not.toHaveBeenCalled();
    expect(mocks.apply).toHaveBeenCalledWith(
      expect.objectContaining({ joinSecret: 'from-link' }),
      expect.objectContaining({ activePath: 'join' })
    );
  });
});
