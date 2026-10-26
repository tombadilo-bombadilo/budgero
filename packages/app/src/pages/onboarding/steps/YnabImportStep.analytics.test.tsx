import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { YNABApiPlanSnapshot } from '@budgero/core/browser';
import { INITIAL_STATE, ONBOARDING_STEPS, type OnboardingFormState } from '../onboarding-data';
import { YnabImportStep } from './YnabImportStep';

const mocks = vi.hoisted(() => ({ listPlans: vi.fn(), getPlan: vi.fn(), track: vi.fn() }));
vi.mock('@budgero/core/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@budgero/core/browser')>()),
  YNABApiClient: class {
    listPlans = mocks.listPlans;

    getPlan = mocks.getPlan;
  },
}));
vi.mock('@shared/lib/analytics/track', () => ({ track: mocks.track }));

function Form({ onStartFresh }: { onStartFresh?: () => void }) {
  const [state, setState] = React.useState<OnboardingFormState>(INITIAL_STATE);
  return (
    <YnabImportStep
      cur={ONBOARDING_STEPS.find((step) => step.id === 'ynab_import')!}
      state={state}
      set={(patch) => setState((current) => ({ ...current, ...patch }))}
      isInspecting={false}
      onFileSelected={vi.fn()}
      onApiSnapshotSelected={(ynabApiSnapshot) => setState((s) => ({ ...s, ynabApiSnapshot }))}
      onStartFresh={onStartFresh}
    />
  );
}

const connectWith = (token: string) => {
  fireEvent.change(screen.getByLabelText('YNAB personal access token'), {
    target: { value: token },
  });
  fireEvent.click(screen.getByRole('button', { name: 'CONNECT' }));
};

beforeEach(() => {
  vi.resetAllMocks();
});

it('reports a rejected token with a fixed reason and explains what to do', async () => {
  mocks.listPlans.mockRejectedValue(new Error('Unauthorized'));
  render(<Form />);
  connectWith('wrong');
  expect(await screen.findByRole('alert')).toHaveTextContent('didn’t accept that token');
  expect(mocks.track).toHaveBeenCalledWith('ynab_import_validation_failed', {
    method: 'api',
    reason: 'unauthorized',
  });
});

it('reports a loaded API source', async () => {
  mocks.listPlans.mockResolvedValue([{ id: 'plan', name: 'Plan' }]);
  mocks.getPlan.mockResolvedValue({ plan: { id: 'plan', name: 'Plan' } } as YNABApiPlanSnapshot);
  render(<Form />);
  connectWith('good');
  await waitFor(() =>
    expect(mocks.track).toHaveBeenCalledWith('ynab_import_source_loaded', { method: 'api' })
  );
});

it('reports method switches and opened help', () => {
  render(<Form />);
  fireEvent.click(screen.getByRole('button', { name: 'CONNECT DIRECTLY' }));
  expect(mocks.track).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'EXPORT ZIP' }));
  expect(mocks.track).toHaveBeenCalledWith('ynab_import_method_chosen', { method: 'zip' });
  fireEvent.click(screen.getByRole('link', { name: 'import guide' }));
  expect(mocks.track).toHaveBeenCalledWith('ynab_import_help_opened', { topic: 'import_guide' });
  fireEvent.click(screen.getByRole('button', { name: 'CONNECT DIRECTLY' }));
  expect(mocks.track).toHaveBeenCalledWith('ynab_import_method_chosen', { method: 'api' });
  const details = screen.getByTestId('ynab-token-howto') as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  expect(mocks.track).toHaveBeenCalledWith('ynab_import_help_opened', { topic: 'token_steps' });
});

it('offers a way out to the fresh path while no source is loaded', () => {
  const onStartFresh = vi.fn();
  render(<Form onStartFresh={onStartFresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Start fresh instead' }));
  expect(onStartFresh).toHaveBeenCalledTimes(1);
  expect(mocks.track).toHaveBeenCalledWith('ynab_import_method_chosen', { method: 'start_fresh' });
});
