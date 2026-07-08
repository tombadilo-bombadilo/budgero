import type { Migration, MigrationDatabase } from '../migrations.js';
import { createLogger } from '../../logger.js';

const debugLog = createLogger('database:migrations');

export const migration026: Migration = {
  version: 26,
  description: 'Add Position column to category_groups and categories for custom ordering',
  up: (db: MigrationDatabase) => {
    // Add Position to category_groups
    try {
      db.exec(`ALTER TABLE category_groups ADD COLUMN Position INTEGER`);
    } catch (error) {
      debugLog('[Migration 26] Position column may already exist on category_groups', {
        error,
      });
    }

    // Add Position to categories
    try {
      db.exec(`ALTER TABLE categories ADD COLUMN Position INTEGER`);
    } catch (error) {
      debugLog('[Migration 26] Position column may already exist on categories', { error });
    }

    // Initialize group positions by Name order within each budget
    db.exec(`
        UPDATE category_groups
        SET Position = (
          SELECT COUNT(*)
          FROM category_groups cg2
          WHERE cg2.BudgetID = category_groups.BudgetID
            AND (cg2.Name < category_groups.Name OR
                 (cg2.Name = category_groups.Name AND cg2.ID < category_groups.ID))
        )
        WHERE Position IS NULL
      `);

    // Initialize category positions by Name order within each group
    db.exec(`
        UPDATE categories
        SET Position = (
          SELECT COUNT(*)
          FROM categories c2
          WHERE c2.CategoryGroupID = categories.CategoryGroupID
            AND (c2.Name < categories.Name OR
                 (c2.Name = categories.Name AND c2.ID < categories.ID))
        )
        WHERE Position IS NULL
      `);
  },
  verify: (db: MigrationDatabase) => {
    try {
      const groupsInfo = db.exec(`PRAGMA table_info(category_groups)`);
      const categoriesInfo = db.exec(`PRAGMA table_info(categories)`);

      const groupsHasPosition =
        groupsInfo?.[0]?.values?.some((row: unknown[]) => row[1] === 'Position') ?? false;
      const categoriesHasPosition =
        categoriesInfo?.[0]?.values?.some((row: unknown[]) => row[1] === 'Position') ?? false;

      return groupsHasPosition && categoriesHasPosition;
    } catch (error) {
      debugLog('[Migration 26] verification failed', { error });
      return false;
    }
  },
};
