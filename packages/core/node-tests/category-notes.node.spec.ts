import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter } from '../src';

describe('Category notes', () => {
  it('saves a trimmed note on the category', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const { budgets, categories } = sm.getServices();

    const budgetId = await budgets.createBudget({
      name: 'B',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: false,
    });
    const groupId = categories.addCategoryGroup('Bills', budgetId);
    const id = categories.addCategory(groupId, budgetId, 'Rent');

    categories.updateCategoryNote(id, '  Due on the 1st\nCall landlord  ');
    expect(categories.getCategory(id).Note).toBe('Due on the 1st\nCall landlord');

    categories.updateCategoryNote(id, '');
    expect(categories.getCategory(id).Note).toBe('');
  });
});
