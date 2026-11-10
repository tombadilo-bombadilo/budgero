import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { ExportMenu } from './ExportMenu';

const download = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('@shared/lib/download', () => ({
  downloadBlob: (...args: unknown[]) => download.calls.push(args),
}));
const warning = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { warning, error: vi.fn(), success: vi.fn() } }));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  globalThis.ResizeObserver ??= class {
    observe() {}

    unobserve() {}

    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

describe('ExportMenu', () => {
  it('says when the CSV holds only the first rows of the result', async () => {
    const user = userEvent.setup();
    render(
      <ExportMenu
        name="Payees"
        result={{ columns: ['a'], rows: [[1], [2]], rowCount: 9000, executionTime: 1 }}
        chartRef={createRef()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Download' }));
    const item = await screen.findByRole('menuitem', { name: /Download CSV/ });
    expect(item).toHaveTextContent('First 2 rows only');
    await user.click(item);
    expect(download.calls).toHaveLength(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('first 2 of 9,000 rows'));
  });
});
