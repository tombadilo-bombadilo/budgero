import { afterEach, describe, expect, it } from 'vitest';
import { asMilli, clock, NodeSqlJsAdapter, runAtClock, ServiceManager, setClock } from '../src';

const AT = Date.UTC(2026, 0, 15, 12);
const LATER = Date.UTC(2026, 5, 1, 12);

afterEach(() => setClock(null));

describe('runAtClock', () => {
  it('pins the clock while a synchronous function runs, then restores it', () => {
    setClock(LATER);
    expect(runAtClock(AT, () => clock.now())).toBe(AT);
    expect(clock.now()).toBe(LATER);
  });

  it('restores the clock when the function throws', () => {
    setClock(LATER);
    expect(() =>
      runAtClock(AT, () => {
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(clock.now()).toBe(LATER);
  });

  it('keeps the pin until an async function settles', async () => {
    setClock(LATER);
    const seen: number[] = [];
    const pending = runAtClock(AT, async () => {
      seen.push(clock.now());
      await new Promise((resolve) => setTimeout(resolve, 1));
      seen.push(clock.now());
      throw new Error('late');
    });
    await expect(pending).rejects.toThrow('late');
    expect(seen).toEqual([AT, AT]);
    expect(clock.now()).toBe(LATER);
  });

  it('nests: the inner pin wins and the outer one comes back', () => {
    const inner = runAtClock(AT, () => [runAtClock(LATER, () => clock.now()), clock.now()]);
    expect(inner).toEqual([LATER, AT]);
  });
});

describe('legacy Liabilities group delete (A28)', () => {
  async function setup() {
    const db = await NodeSqlJsAdapter.create();
    const manager = new ServiceManager();
    await manager.initialize(db);
    const s = manager.getServices();
    const budgetId = await s.budgets.createBudget({
      name: 'B',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: false,
    });
    const loan = await s.accounts.createAccount('Car loan', budgetId, 'loan', 'USD', asMilli(0), {
      debt_total: 1_000_000,
    });
    const metadata = JSON.parse(s.accounts.getAccount(loan.ID).Metadata || '{}') as {
      linked_category_id: number;
    };
    const groupId = s.categories.getCategory(metadata.linked_category_id).CategoryGroupID;
    return { db, s, budgetId, loan, groupId, linkedId: metadata.linked_category_id };
  }

  it('refuses a group holding an active loan’s linked category', async () => {
    const c = await setup();
    expect(() => c.s.categories.assertCategoryGroupDeletable(c.groupId)).toThrow();
  });

  it('renames a loan whose linked category is gone without throwing', async () => {
    const c = await setup();
    // What a replayed legacy categoryGroups.delete leaves behind.
    c.s.categories.deleteCategoryGroup(c.groupId);
    expect(() => c.s.categories.getCategory(c.linkedId)).toThrow();
    await c.s.accounts.updateAccount(c.loan.ID, 'Truck loan', 'loan', 'USD', undefined, false);
    expect(c.s.accounts.getAccount(c.loan.ID).Name).toBe('Truck loan');
  });
});
