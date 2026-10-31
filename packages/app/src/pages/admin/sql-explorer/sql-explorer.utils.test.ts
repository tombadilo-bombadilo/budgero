import { describe, expect, it } from 'vitest';
import { convertToDryRunQuery } from './sql-explorer.utils';

describe('convertToDryRunQuery', () => {
  it('keeps a WHERE clause that spans several lines', () => {
    const query = `UPDATE space_blob_history SET mutation_version = 11
  WHERE id IN (3, 12)
    AND space_id = 'be18b5aa'
    AND mutation_version = 1`;
    expect(convertToDryRunQuery(query)).toBe(
      `SELECT '(dry run) Rows that would be updated' as _dry_run_mode, * FROM space_blob_history WHERE id IN (3, 12)
    AND space_id = 'be18b5aa'
    AND mutation_version = 1`
    );
  });

  it('keeps a multi-line WHERE for DELETE too', () => {
    const query = 'DELETE FROM sessions\nWHERE user_id = 1\n  AND expired = 1';
    expect(convertToDryRunQuery(query)).toContain('WHERE user_id = 1\n  AND expired = 1');
  });

  it('still previews the whole table when there is no WHERE', () => {
    expect(convertToDryRunQuery('UPDATE users SET x = 1')).toBe(
      "SELECT '(dry run) Rows that would be updated' as _dry_run_mode, * FROM users "
    );
  });
});
