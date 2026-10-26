import { classifyYnabApiError, classifyYnabZipError } from './ynab-source-errors';

describe('classifyYnabApiError', () => {
  it.each([
    [new Error('Unauthorized'), 'unauthorized'],
    [new Error('YNAB API request failed (401)'), 'unauthorized'],
    [new Error('Too many requests'), 'rate_limited'],
    [new Error('YNAB API request failed (429)'), 'rate_limited'],
    [new TypeError('Failed to fetch'), 'network'],
    [new Error('Load failed'), 'network'],
    [new Error('No plans are available for this token'), 'no_plans'],
    [new Error('Reload failed'), 'unknown'],
    ['something odd', 'unknown'],
  ])('%s → %s', (error, reason) => {
    expect(classifyYnabApiError(error)).toBe(reason);
  });
});

describe('classifyYnabZipError', () => {
  it.each([
    [new Error("Can't find end of central directory : is this a zip file ?"), 'not_zip'],
    [new Error('register CSV file not found in ZIP'), 'not_ynab_export'],
    [new Error('budget CSV file not found in ZIP'), 'not_ynab_export'],
    [new Error('Something else'), 'unknown'],
  ])('%s → %s', (error, reason) => {
    expect(classifyYnabZipError(error)).toBe(reason);
  });
});
