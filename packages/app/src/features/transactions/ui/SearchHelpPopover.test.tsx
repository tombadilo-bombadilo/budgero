import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { parseSearchQuery } from '@shared/lib/search-query-parser';
import { SearchHelpPopover } from './SearchHelpPopover';
import { SearchActiveFilters } from './SearchActiveFilters';

describe('SearchHelpPopover', () => {
  it('opens from the keyboard, puts an example in the box and links to the docs', async () => {
    const user = userEvent.setup();
    const onPickExample = vi.fn();
    render(<SearchHelpPopover onPickExample={onPickExample} />);

    await user.tab();
    expect(screen.getByRole('button', { name: 'How search works' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('link', { name: /Learn more/ })).toHaveAttribute(
      'href',
      'https://budgero.app/docs/semantic-search'
    );
    await user.click(screen.getByRole('button', { name: '-payee:amazon' }));
    expect(onPickExample).toHaveBeenCalledWith('-payee:amazon');
    expect(screen.queryByRole('link', { name: /Learn more/ })).not.toBeInTheDocument();
  });

  it('opens with a tap', async () => {
    const user = userEvent.setup();
    render(<SearchHelpPopover onPickExample={() => {}} />);
    await user.pointer({ keys: '[TouchA]', target: screen.getByRole('button') });
    expect(screen.getByText('Try one:')).toBeInTheDocument();
  });
});

describe('SearchActiveFilters', () => {
  it('shows a removable chip for every new filter', async () => {
    const user = userEvent.setup();
    const onRemoveToken = vi.fn();
    const parsed = parseSearchQuery(
      'coffee -payee:amazon not uncleared between 20 and 50 no:memo split -label:trip',
      [],
      ['Trip']
    );
    render(
      <SearchActiveFilters parsed={parsed} onRemoveToken={onRemoveToken} onClearAll={() => {}} />
    );

    for (const label of [
      'Not Payee: “amazon”',
      'Not Uncleared',
      'Between 20 and 50',
      'No memo',
      'Split',
      'Not Label: “Trip”',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'Remove No memo filter' }));
    expect(onRemoveToken).toHaveBeenCalledWith(expect.objectContaining({ text: 'no:memo' }));
    expect(screen.getByText('Searching: "coffee"')).toBeInTheDocument();
  });
});
