import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createQuestion } from '@features/reports/lib/question';
import { ExpressionEditor } from './ExpressionEditor';

afterEach(cleanup);

const spec = createQuestion('transactions', {
  customColumns: [{ id: 'expr_1', name: 'Size', expression: 'abs([amount])' }],
});

function setup(
  kind: 'column' | 'metric' = 'metric',
  initial?: { name?: string; expression: string }
) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <ExpressionEditor
      spec={spec}
      kind={kind}
      initial={initial}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  );
  return { onSubmit, onCancel, user: userEvent.setup() };
}

const expression = () => screen.getByRole('combobox', { name: 'Expression' });

describe('ExpressionEditor', () => {
  it('validates live and submits the canonical expression with a name', async () => {
    const { user, onSubmit } = setup();
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toBeDisabled();
    fireEvent.change(expression(), { target: { value: 'Spending / Incom * 100' } });
    fireEvent.blur(expression());
    expect(screen.getByText(/Unknown name “Incom”/)).toBeInTheDocument();
    expect(screen.getByText('(at character 12)')).toBeInTheDocument();
    expect(expression()).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(expression(), {
      target: { value: 'SumIf([Outflow], [Category] = "Rent") / Spending' },
    });
    expect(screen.queryByText(/Unknown name/)).not.toBeInTheDocument();
    expect(done).toBeDisabled(); // no name yet
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Rent share');
    await user.click(done);
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Rent share',
      expression: 'SumIf([outflow], [category] = "Rent") / Spending',
    });
  });

  it('suggests fields after [ and inserts the chosen one with the keyboard', async () => {
    const { user } = setup('column');
    await user.click(expression());
    await user.keyboard('abs([[am');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Amount');
    expect(expression()).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Enter}');
    expect(expression()).toHaveValue('abs([Amount]');
    await user.keyboard(')');
    expect(expression()).toHaveValue('abs([Amount])');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('suggests functions and metric names while typing a word', async () => {
    const { user } = setup('metric');
    await user.click(expression());
    await user.keyboard('Sum');
    const labels = screen.getAllByRole('option').map((option) => option.textContent);
    expect(labels.some((label) => label?.startsWith('SumIf'))).toBe(true);
    await user.keyboard('{ArrowDown}{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows stored expressions with field names and custom column names', () => {
    setup('metric', { name: 'Big', expression: 'Sum([expr_1]) / Sum([amount])' });
    expect(expression()).toHaveValue('Sum([Size]) / Sum([Amount])');
    expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled();
  });

  it('rejects aggregations in custom columns and taken names', async () => {
    const { user } = setup('column');
    fireEvent.change(expression(), { target: { value: 'Sum([Amount])' } });
    fireEvent.blur(expression());
    expect(screen.getByText('Sum only works in a custom metric.')).toBeInTheDocument();
    fireEvent.change(expression(), { target: { value: '[Amount] * 2' } });
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'size');
    expect(screen.getByText('A field with this name already exists.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
  });

  it('fills an example', async () => {
    const { user } = setup('metric');
    await user.click(screen.getByRole('button', { name: 'Spending / Income * 100' }));
    expect(expression()).toHaveValue('Spending / Income * 100');
  });
});
