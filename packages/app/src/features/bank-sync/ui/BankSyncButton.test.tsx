import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BankSyncButton } from './BankSyncButton';

const hooks = vi.hoisted(() => ({ links: [] as unknown[], reviews: [] as unknown[] }));
vi.mock('../api/useBankSync', () => ({
  useBankLinks: () => ({ data: hooks.links }),
  useBankReviews: () => ({ data: hooks.reviews }),
  useRunBankSync: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('./BankReviewDialog', () => ({ BankReviewDialog: () => null }));

describe('BankSyncButton', () => {
  it('shows pending reviews on an account without a bank link (Push API matches)', () => {
    hooks.reviews = [{ ID: 1 }];
    render(<BankSyncButton budgetId={1} accountId={2} currency="USD" />);
    expect(screen.getByRole('button', { name: '1 to review' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync with bank' })).not.toBeInTheDocument();
  });

  it('renders nothing for an unlinked account with nothing to review', () => {
    hooks.reviews = [];
    const { container } = render(<BankSyncButton budgetId={1} accountId={2} currency="USD" />);
    expect(container).toBeEmptyDOMElement();
  });
});
