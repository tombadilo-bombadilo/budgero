import { describe, expect, it } from 'vitest';
import { RECURRING_SPLIT_ERROR_CODES } from '@budgero/core/browser';
import { recurringErrorMessage } from './error-message';

const coreError = (code: string) =>
  Object.assign(new Error('A split line category no longer exists'), { code });

describe('recurringErrorMessage', () => {
  it('gives every split-line code its own message instead of the core text', () => {
    const messages = Object.values(RECURRING_SPLIT_ERROR_CODES).map((code) =>
      recurringErrorMessage(coreError(code), 'fallback')
    );
    expect(messages).not.toContain('A split line category no longer exists');
    expect(new Set(messages).size).toBe(messages.length);
    expect(recurringErrorMessage(coreError(RECURRING_SPLIT_ERROR_CODES.categoryMissing))).toMatch(
      /category no longer exists. Edit the recurring transaction/
    );
  });

  it('falls back to the error text, or the fallback for non-errors', () => {
    expect(recurringErrorMessage(new Error('Disk full'), 'fallback')).toBe('Disk full');
    expect(recurringErrorMessage(coreError('VALIDATION_ERROR'), 'fallback')).toBe(
      'A split line category no longer exists'
    );
    expect(recurringErrorMessage('nope', 'fallback')).toBe('fallback');
  });
});
