import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter } from '../src';

describe('Budgets and Categories', () => {
  it('creates budgets with/without default categories and updates fields', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const { budgets, categories } = sm.getServices();

    // With defaults
    const b1 = await budgets.createBudget({
      name: 'B1',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    const cats1 = categories.getAllCategories(b1);
    expect(cats1.length).toBeGreaterThan(0);

    // Without defaults — system categories (Income, Uncategorized, Transfers) are still created
    const b2 = await budgets.createBudget({
      name: 'B2',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: false,
    });
    const cats2 = categories.getAllCategories(b2);
    expect(cats2.map((c) => c.Name).sort()).toEqual(['Income', 'Transfers', 'Uncategorized']);
    expect(cats2.length).toBeLessThan(cats1.length);

    // Update fields
    budgets.updateBudgetName(b2, 'B2-upd');
    budgets.updateBudgetNumberFormat(b2, '1,234.56');
    await budgets.updateBudgetCurrency(b2, 'USD'); // same currency path
    budgets.updateBudgetIcon(b2, 'coin');
    expect(budgets.getBudget(b2).Name).toBe('B2-upd');

    // Delete should not throw
    budgets.deleteBudget(b2);
  });

  it('category CRUD, move, flags, and assignments detection', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const { budgets, categories, monthlyBudgets } = sm.getServices();

    const budgetId = await budgets.createBudget({
      name: 'B3',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: false,
    });

    // Add groups and categories
    const g1 = categories.addCategoryGroup('G1', budgetId);
    const g2 = categories.addCategoryGroup('G2', budgetId);
    const c1 = categories.addCategory(g1, budgetId, 'C1', 'note');
    const c2 = categories.addCategory(g1, budgetId, 'C2', '');

    // Getters
    expect(categories.getCategory(c1).Name).toBe('C1');
    expect(categories.getCategoryGroup(g1).Name).toBe('G1');
    expect(categories.getCategoryByName('C2', budgetId)?.ID).toBe(c2);
    expect(categories.getCategoryGroupByName('G2', budgetId)?.ID).toBe(g2);
    expect(categories.getCategoriesByGroup(budgetId, g1).length).toBe(2);

    // Updates
    categories.updateCategoryName(c2, 'C2-upd');
    categories.updateCategory(c1, g2, 'C1-upd', 'n2');
    categories.updateCategoryExcludeFromBudgetPace(c1, true);
    expect(categories.getCategory(c1).ExcludeFromBudgetPace).toBe(true);

    // Move c2 to g2, then move c1 back to g1
    categories.moveCategoryToNewGroup(g2, c2);
    expect(categories.getCategory(c2).CategoryGroupID).toBe(g2);
    categories.moveCategoryToNewGroup(g1, c1); // move c1 back to g1
    expect(categories.getCategory(c1).CategoryGroupID).toBe(g1);

    // Assignments detection
    expect(categories.hasAssignments(c1)).toBe(false);
    monthlyBudgets.upsertMonthlyAssignment(c1, 123, '2024-01', budgetId);
    expect(categories.hasAssignments(c1)).toBe(true);

    // Delete category and group
    categories.deleteCategory(c2);
    categories.deleteCategoryGroup(g2);
    // Remaining categories in g1 include c1
    expect(categories.getCategoriesByGroup(budgetId, g1).some((c) => c.ID === c1)).toBe(true);

    // NotFound error cases
    expect(() => categories.getCategory(999999)).toThrow('Category with id 999999 not found');
    expect(() => categories.getCategoryGroup(999999)).toThrow(
      'Category group with id 999999 not found'
    );

    // Update group name
    categories.updateCategoryGroup(g1, 'G1-renamed');
    expect(categories.getCategoryGroup(g1).Name).toBe('G1-renamed');

    // AddCategory should error for non-existent group
    expect(() => categories.addCategory(123456, budgetId, 'Bad')).toThrow(
      "category group '123456' does not exist"
    );
  });
});
