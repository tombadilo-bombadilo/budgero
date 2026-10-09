import { describe, expect, it, vi } from 'vitest';
import { getUndoSpec } from '@shared/mutations/op-code-registry';

const categoryMocks = vi.hoisted(() => ({ getCategory: vi.fn() }));

vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({
    services: () => ({ categories: categoryMocks }),
    mutationsRouter: () => ({ execute: vi.fn() }),
  }),
}));

async function undoFor(args: Record<string, unknown>) {
  const spec = getUndoSpec('categories.updateNote')!;
  const before = spec.capture ? await spec.capture(args) : undefined;
  return spec.build(args, undefined, before);
}

describe('category note undo', () => {
  it('restores the previous note', async () => {
    categoryMocks.getCategory.mockReturnValue({ ID: 4, Note: 'old' });
    expect(await undoFor({ id: 4, note: 'new' })).toEqual([
      { op: 'categories.updateNote', args: { id: 4, note: 'old' } },
    ]);
  });

  it('restores an empty note when the first note is undone', async () => {
    categoryMocks.getCategory.mockReturnValue({ ID: 4, Note: '' });
    expect(await undoFor({ id: 4, note: 'first' })).toEqual([
      { op: 'categories.updateNote', args: { id: 4, note: '' } },
    ]);
  });
});
