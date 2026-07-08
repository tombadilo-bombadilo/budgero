import { describe, expect, it, vi } from 'vitest';
import { DatabaseLoader } from './database-loader';

describe('DatabaseLoader', () => {
  it('enables foreign keys without migration runner', () => {
    const exec = vi.fn();
    const loader = new DatabaseLoader();

    const ran = loader.runMigrations({ exec } as unknown as Parameters<typeof loader.runMigrations>[0]);
    expect(ran).toBe(false);
    expect(exec).toHaveBeenCalledWith('PRAGMA foreign_keys = ON');
  });

  it('runs migrations when needed', () => {
    const db = { exec: vi.fn() };
    const needsMigration = vi.fn(() => true);
    const runMigrations = vi.fn();

    const loader = new DatabaseLoader({ needsMigration, runMigrations });

    expect(loader.runMigrations(db as never)).toBe(true);
    expect(needsMigration).toHaveBeenCalledWith(db);
    expect(runMigrations).toHaveBeenCalledWith(db);
  });

  it('rethrows migration errors', () => {
    const db = { exec: vi.fn() };
    const loader = new DatabaseLoader({
      needsMigration: () => {
        throw new Error('bad');
      },
      runMigrations: vi.fn(),
    });

    expect(() => loader.runMigrations(db as never)).toThrow('bad');
  });
});
