import { describe, expect, it } from 'vitest';
import { parseSearchQuery, removeTokenFromQuery } from './search-query-parser';

describe('search-query-parser label support', () => {
  const categories = ['Groceries', 'Income'];
  const labels = ['Vacation', 'Vacation Fund', 'Urgent'];

  it('parses label:<name> as a semantic label filter', () => {
    const parsed = parseSearchQuery('label:Vacation coffee', categories, labels);

    expect(parsed.labelMatches).toEqual(['Vacation']);
    expect(parsed.matchedTokens.some((token) => token.type === 'label')).toBe(true);
    expect(parsed.textQuery).toBe('coffee');
  });

  it('supports quoted label tokens combined with other semantic filters', () => {
    const parsed = parseSearchQuery(
      'last 30 days outflows label:"Vacation Fund" groceries hotel',
      categories,
      labels
    );

    expect(parsed.dateRange).not.toBeNull();
    expect(parsed.transactionType).toBe('outflows');
    expect(parsed.categoryMatches).toEqual(['Groceries']);
    expect(parsed.labelMatches).toEqual(['Vacation Fund']);
    expect(parsed.textQuery).toBe('hotel');
  });

  it('removes label tokens from the original query', () => {
    const query = 'label:Urgent dinner';
    const parsed = parseSearchQuery(query, categories, labels);
    const labelToken = parsed.matchedTokens.find((token) => token.type === 'label');
    if (!labelToken) {
      throw new Error('Expected a label token to be present');
    }

    const next = removeTokenFromQuery(query, labelToken, parsed);
    expect(next).toBe('dinner');
  });
});
