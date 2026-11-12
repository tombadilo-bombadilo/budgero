import { describe, expect, it } from 'vitest';
import { DatabaseAdapter, NodeSqlJsAdapter, ServiceManager } from '../src';

async function services() {
  const adapter = await NodeSqlJsAdapter.create();
  const serviceManager = new ServiceManager();
  await serviceManager.initialize(adapter as DatabaseAdapter);
  return serviceManager.getServices();
}

describe('page guides seen', () => {
  it('starts empty and records guides per user', async () => {
    const { pageGuides } = await services();
    expect(pageGuides.getSeen('u1')).toEqual([]);
    expect(pageGuides.markSeen('u1', ['budget', 'accounts'])).toEqual(['budget', 'accounts']);
    expect(pageGuides.getSeen('u1')).toEqual(['accounts', 'budget']);
  });

  it('keeps members of a shared workspace apart', async () => {
    const { pageGuides } = await services();
    pageGuides.markSeen('u1', ['budget']);
    pageGuides.markSeen('u2', ['reports']);
    expect(pageGuides.getSeen('u1')).toEqual(['budget']);
    expect(pageGuides.getSeen('u2')).toEqual(['reports']);
  });

  it('merges marks: repeats add nothing, the result is the union in any order', async () => {
    const a = (await services()).pageGuides;
    const b = (await services()).pageGuides;
    const first = ['budget', 'home'];
    const second = ['home', 'rules'];
    a.markSeen('u1', first);
    a.markSeen('u1', second);
    b.markSeen('u1', second);
    b.markSeen('u1', first);
    expect(a.getSeen('u1')).toEqual(b.getSeen('u1'));
    expect(a.getSeen('u1')).toEqual(['budget', 'home', 'rules']);
    expect(a.markSeen('u1', ['budget', 'budget'])).toEqual([]);
  });

  it('accepts guide ids it does not know (newer builds add guides)', async () => {
    const { pageGuides } = await services();
    expect(pageGuides.markSeen('u1', ['some-future-guide'])).toEqual(['some-future-guide']);
  });

  it('rejects a missing user or a bad guide id', async () => {
    const { pageGuides } = await services();
    expect(() => pageGuides.markSeen('', ['budget'])).toThrow();
    expect(() => pageGuides.markSeen('u1', [''])).toThrow();
    expect(() => pageGuides.markSeen('u1', ['x'.repeat(65)])).toThrow();
  });
});
