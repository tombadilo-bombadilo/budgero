import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter } from '../src';

type AccountMetadata = {
  cc_payment_category_id?: number;
  linked_category_id?: number;
};

function parseMetadata(raw: unknown): AccountMetadata {
  if (typeof raw === 'string') return JSON.parse(raw || '{}');
  return (raw as AccountMetadata) || {};
}

describe('AccountService.updateAccount — type changes', () => {
  async function setup() {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const services = sm.getServices();
    const budgetId = await services.budgets.createBudget({
      name: 'TypeChange',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: false,
    });
    return { services, budgetId };
  }

  it('creates a CC Payment category when an existing account becomes a credit card', async () => {
    const { services, budgetId } = await setup();
    const { accounts, categories } = services;

    const acc = await accounts.createAccount('Everyday', budgetId, 'checking', 'USD', 0);

    // Sanity: no CC plumbing exists yet
    expect(categories.getCategoryGroupByName('Credit Card Payments', budgetId)).toBeFalsy();

    await accounts.updateAccount(acc.ID, 'Everyday', 'credit', 'USD');

    const updated = accounts.getAccount(acc.ID);
    expect(updated.Type.toLowerCase()).toBe('credit');

    const metadata = parseMetadata(updated.Metadata);
    expect(metadata.cc_payment_category_id).toBeTruthy();

    // The group and the per-card category must exist, named after the account
    const ccGroup = categories.getCategoryGroupByName('Credit Card Payments', budgetId);
    expect(ccGroup).toBeTruthy();
    const ccCategory = categories
      .getAllCategories(budgetId)
      .find((c: { ID: number }) => c.ID === metadata.cc_payment_category_id);
    expect(ccCategory?.Name).toBe('Everyday');
    expect(ccCategory?.CategoryGroupID).toBe(ccGroup?.ID);
  });

  it('does not create a duplicate CC Payment category if one is already linked', async () => {
    const { services, budgetId } = await setup();
    const { accounts, categories } = services;

    // Created as credit → gets its CC category at creation time
    const cc = await accounts.createAccount('Visa', budgetId, 'credit', 'USD', 0);
    const originalMeta = parseMetadata(accounts.getAccount(cc.ID).Metadata);
    expect(originalMeta.cc_payment_category_id).toBeTruthy();

    // Type away and back again (passing the existing metadata through, as the app does)
    await accounts.updateAccount(cc.ID, 'Visa', 'checking', 'USD', { ...originalMeta });
    await accounts.updateAccount(cc.ID, 'Visa', 'credit', 'USD', {
      ...parseMetadata(accounts.getAccount(cc.ID).Metadata),
    });

    const finalMeta = parseMetadata(accounts.getAccount(cc.ID).Metadata);
    expect(finalMeta.cc_payment_category_id).toBe(originalMeta.cc_payment_category_id);

    const ccGroup = categories.getCategoryGroupByName('Credit Card Payments', budgetId);
    const cardCategories = categories
      .getAllCategories(budgetId)
      .filter(
        (c: { Name: string; CategoryGroupID: number }) =>
          c.Name === 'Visa' && c.CategoryGroupID === ccGroup?.ID
      );
    expect(cardCategories.length).toBe(1);
  });

  it('preserves cc_payment_category_id when the caller passes rebuilt metadata (edit-form pattern)', async () => {
    const { services, budgetId } = await setup();
    const { accounts } = services;

    const cc = await accounts.createAccount('Visa', budgetId, 'credit', 'USD', 0);
    const originalMeta = parseMetadata(accounts.getAccount(cc.ID).Metadata);
    expect(originalMeta.cc_payment_category_id).toBeTruthy();

    // The edit modal rebuilds metadata from its form fields, dropping system keys
    await accounts.updateAccount(cc.ID, 'Visa', 'credit', 'USD', {
      liability: true,
      liability_type: 'credit',
      debt_total: 500,
    });

    const afterMeta = parseMetadata(accounts.getAccount(cc.ID).Metadata);
    expect(afterMeta.cc_payment_category_id).toBe(originalMeta.cc_payment_category_id);
    // Caller-supplied fields still win for everything non-system
    expect((afterMeta as Record<string, unknown>).debt_total).toBe(500);
  });

  it('renames the CC Payment category when the account is renamed — even via rebuilt metadata', async () => {
    const { services, budgetId } = await setup();
    const { accounts, categories } = services;

    const cc = await accounts.createAccount('Visa', budgetId, 'credit', 'USD', 0);
    const meta = parseMetadata(accounts.getAccount(cc.ID).Metadata);

    // Rename with edit-form-style metadata (no system keys included)
    await accounts.updateAccount(cc.ID, 'Platinum Card', 'credit', 'USD', {
      liability: true,
      liability_type: 'credit',
    });

    const category = categories
      .getAllCategories(budgetId)
      .find((c: { ID: number }) => c.ID === meta.cc_payment_category_id);
    expect(category?.Name).toBe('Platinum Card');
  });

  it('reattaches to an existing same-named CC Payment category instead of duplicating', async () => {
    const { services, budgetId } = await setup();
    const { accounts, categories } = services;

    // Simulate a previously decoupled account: CC category exists but the
    // account metadata lost the link, and the account type drifted.
    const groupId = categories.addCategoryGroup('Credit Card Payments', budgetId);
    const orphanCategoryId = categories.addCategory(groupId, budgetId, 'test', '');

    const acc = await accounts.createAccount('test', budgetId, 'checking', 'USD', 0);
    await accounts.updateAccount(acc.ID, 'test', 'credit', 'USD');

    const meta = parseMetadata(accounts.getAccount(acc.ID).Metadata);
    expect(meta.cc_payment_category_id).toBe(orphanCategoryId);

    const sameName = categories
      .getAllCategories(budgetId)
      .filter(
        (c: { Name: string; CategoryGroupID: number }) =>
          c.Name === 'test' && c.CategoryGroupID === groupId
      );
    expect(sameName.length).toBe(1);
  });

  it('creates a linked Liabilities category when an existing account becomes a loan', async () => {
    const { services, budgetId } = await setup();
    const { accounts, categories } = services;

    const acc = await accounts.createAccount('Car Money', budgetId, 'savings', 'USD', 0);
    await accounts.updateAccount(acc.ID, 'Car Loan', 'loan', 'USD');

    const updated = accounts.getAccount(acc.ID);
    const metadata = parseMetadata(updated.Metadata);
    expect(metadata.linked_category_id).toBeTruthy();

    const liabilitiesGroup = categories.getCategoryGroupByName('Liabilities', budgetId);
    expect(liabilitiesGroup).toBeTruthy();
    const linked = categories
      .getAllCategories(budgetId)
      .find((c: { ID: number }) => c.ID === metadata.linked_category_id);
    expect(linked?.Name).toBe('Car Loan');
  });

  it('blocks deleting a CC payment category while the card is active, allows it once archived', async () => {
    const { services, budgetId } = await setup();
    const { accounts, categories } = services;

    const cc = await accounts.createAccount('Chase', budgetId, 'Credit', 'USD', 0, {}, true);
    const meta = parseMetadata(accounts.getAccount(cc.ID).Metadata);
    const ccCategoryId = meta.cc_payment_category_id!;
    expect(ccCategoryId).toBeTruthy();

    // Active card: its payment category is protected.
    expect(() => categories.deleteCategory(ccCategoryId)).toThrow(
      'Cannot delete category: it tracks payments for the active "Chase" credit card. Archive or delete the account first.'
    );
    const stillThere = (id: number) =>
      categories.getAllCategories(budgetId).some((c: { ID: number }) => c.ID === id);
    expect(stillThere(ccCategoryId)).toBe(true);

    // Archive the card → the category is released and can be deleted.
    accounts.setAccountArchived(cc.ID, true);
    expect(() => categories.deleteCategory(ccCategoryId)).not.toThrow();
    expect(stillThere(ccCategoryId)).toBe(false);
  });

  it('relinks the CC payment category on unarchive after it was deleted while archived', async () => {
    const { services, budgetId } = await setup();
    const { accounts, categories } = services;

    const cc = await accounts.createAccount('Chase', budgetId, 'Credit', 'USD', 0, {}, true);
    const originalCatId = parseMetadata(
      accounts.getAccount(cc.ID).Metadata
    ).cc_payment_category_id!;

    // Archive, then delete the (now-releasable) payment category. This leaves a
    // dangling cc_payment_category_id on the account.
    accounts.setAccountArchived(cc.ID, true);
    categories.deleteCategory(originalCatId);
    expect(
      categories.getAllCategories(budgetId).some((c: { ID: number }) => c.ID === originalCatId)
    ).toBe(false);

    // Unarchive → the link is restored to a real (new) category in the group.
    accounts.setAccountArchived(cc.ID, false);

    const relinkedId = parseMetadata(accounts.getAccount(cc.ID).Metadata).cc_payment_category_id;
    expect(relinkedId).toBeTruthy();
    expect(relinkedId).not.toBe(originalCatId); // recreated, not the dangling id
    const relinked = categories
      .getAllCategories(budgetId)
      .find((c: { ID: number }) => c.ID === relinkedId);
    expect(relinked?.Name).toBe('Chase');
    const ccGroup = categories.getCategoryGroupByName('Credit Card Payments', budgetId);
    expect(relinked?.CategoryGroupID).toBe(ccGroup?.ID);
  });

  it('reattaches to a same-named category on unarchive instead of duplicating', async () => {
    const { services, budgetId } = await setup();
    const { accounts, categories } = services;

    const cc = await accounts.createAccount('Chase', budgetId, 'Credit', 'USD', 0, {}, true);
    const ccGroup = categories.getCategoryGroupByName('Credit Card Payments', budgetId)!;
    const originalCatId = parseMetadata(
      accounts.getAccount(cc.ID).Metadata
    ).cc_payment_category_id!;

    // Delete the linked category while archived (dangling link)...
    accounts.setAccountArchived(cc.ID, true);
    categories.deleteCategory(originalCatId);
    // ...but a same-named 'Chase' category still exists in the group (e.g. the
    // user recreated it manually). Unarchive should reattach, not duplicate.
    const recreatedId = categories.addCategory(ccGroup.ID, budgetId, 'Chase', '');

    accounts.setAccountArchived(cc.ID, false);

    const relinkedId = parseMetadata(accounts.getAccount(cc.ID).Metadata).cc_payment_category_id;
    expect(relinkedId).toBe(recreatedId); // reattached to the existing one
    const chaseCategories = categories
      .getAllCategories(budgetId)
      .filter(
        (c: { CategoryGroupID: number; Name: string }) =>
          c.CategoryGroupID === ccGroup.ID && c.Name === 'Chase'
      );
    expect(chaseCategories).toHaveLength(1); // no duplicate created
  });
});
