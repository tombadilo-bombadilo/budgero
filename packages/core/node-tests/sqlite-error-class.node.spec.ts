import { describe, expect, it } from 'vitest';
import { classifySqliteError } from '../src/database/interface';

describe('classifySqliteError', () => {
  it('maps sql.js messages to a fixed failure class', () => {
    expect(classifySqliteError('UNIQUE constraint failed: payees.Name')).toBe('constraint');
    expect(classifySqliteError('FOREIGN KEY constraint failed')).toBe('constraint');
    expect(classifySqliteError('database is locked')).toBe('locked');
    expect(classifySqliteError('database disk image is malformed')).toBe('corrupt');
    expect(classifySqliteError('file is not a database')).toBe('corrupt');
    expect(classifySqliteError('attempt to write a readonly database')).toBe('readonly');
    expect(classifySqliteError('database or disk is full')).toBe('full');
    expect(classifySqliteError('no such table: nope')).toBe('error');
  });
});
