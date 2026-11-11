import { describe, expect, it } from 'vitest';
import { applyQueryLimit, createCountQuery, topLevelLimit } from './sql-limit';

describe('topLevelLimit', () => {
  it('finds a trailing LIMIT (with OFFSET) at the top level', () => {
    expect(topLevelLimit('SELECT * FROM t LIMIT 5')?.value).toBe(5);
    expect(topLevelLimit('select * from t limit 5 offset 10')?.value).toBe(5);
    expect(topLevelLimit('SELECT * FROM t ORDER BY a LIMIT 20;')?.value).toBe(20);
  });

  it('ignores LIMIT inside strings, quoted names, comments and parentheses', () => {
    expect(topLevelLimit("SELECT * FROM t WHERE payee = 'Speed Limit 30'")).toBeNull();
    expect(topLevelLimit('SELECT "limit 3" FROM t')).toBeNull();
    expect(topLevelLimit('SELECT * FROM t -- limit 3\n')).toBeNull();
    expect(topLevelLimit('SELECT * FROM t /* limit 3 */')).toBeNull();
    expect(topLevelLimit('SELECT * FROM (SELECT * FROM t LIMIT 3) s')).toBeNull();
    expect(
      topLevelLimit('WITH top AS (SELECT a FROM t ORDER BY a LIMIT 10) SELECT * FROM top')
    ).toBeNull();
  });
});

describe('applyQueryLimit', () => {
  it('caps a query whose only LIMIT is inside a CTE (questions with 2+ groupings)', () => {
    const query =
      'WITH top_values AS (SELECT a FROM t LIMIT 10) SELECT * FROM t WHERE a IN (SELECT a FROM top_values)';
    expect(applyQueryLimit(query, 100)).toEqual({
      query: `${query} LIMIT 100`,
      userLimit: null,
      effectiveLimit: 100,
    });
  });

  it('caps despite a literal mentioning a limit, and never edits the literal', () => {
    const query = "SELECT * FROM t WHERE memo = 'limit 10000'";
    expect(applyQueryLimit(query, 100).query).toBe(`${query} LIMIT 100`);
    const big = "SELECT * FROM t WHERE memo = 'limit 10000' LIMIT 50000";
    expect(applyQueryLimit(big, 100)).toEqual({
      query: "SELECT * FROM t WHERE memo = 'limit 10000' LIMIT 100",
      userLimit: 50000,
      effectiveLimit: 100,
    });
    expect(applyQueryLimit('SELECT * FROM t LIMIT 5', 100).query).toBe('SELECT * FROM t LIMIT 5');
  });

  it('counts without the top-level LIMIT only', () => {
    expect(createCountQuery("SELECT * FROM t WHERE p = 'Speed Limit 30' LIMIT 5")).toBe(
      "SELECT COUNT(*) as count FROM (SELECT * FROM t WHERE p = 'Speed Limit 30' ) as subquery"
    );
  });
});
