import { friendlyQueryError } from './query-error';

describe('friendlyQueryError', () => {
  it('explains DuckDB errors without their jargon', () => {
    expect(
      friendlyQueryError('Binder Error: Referenced column "foo" not found in FROM clause!')
    ).toMatch(/column or table that isn’t available/);
    expect(friendlyQueryError('Parser Error: syntax error at or near "FROM"')).toMatch(
      /could not be read/
    );
    expect(friendlyQueryError('Out of Memory Error: failed to allocate')).toMatch(/more memory/);
    expect(friendlyQueryError('Conversion Error: Could not convert string')).toMatch(
      /could not be calculated/
    );
  });

  it('falls back to a general message', () => {
    expect(friendlyQueryError('weird')).toBe('Something went wrong while running the question.');
  });
});
