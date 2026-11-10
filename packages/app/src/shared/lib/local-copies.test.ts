import { afterEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const core = {
  whenLocalWritesSettle: vi.fn(async () => void calls.push('settle')),
  clearLocalFiles: vi.fn(async () => void calls.push('clear')),
};
vi.mock('@budgero/core/browser', () => core);

const { wipeLocalBudgetCopies } = await import('./local-copies');

afterEach(() => {
  calls.length = 0;
  vi.restoreAllMocks();
});

describe('wipeLocalBudgetCopies', () => {
  it('waits for saves in flight, then clears both stores', async () => {
    expect(await wipeLocalBudgetCopies('test')).toBe(true);
    expect(calls).toEqual(['settle', 'clear']);
  });

  it('reports a wipe that failed instead of hiding it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    core.clearLocalFiles.mockRejectedValueOnce(new DOMException('x', 'UnknownError'));
    expect(await wipeLocalBudgetCopies('test')).toBe(false);
    expect(error).toHaveBeenCalledWith(
      '[test] Local budget copies could not be removed',
      expect.any(DOMException)
    );
  });
});
