import { describe, expect, it } from 'vitest';
import { csvField, resultsToCsv } from './csv';

describe('resultsToCsv', () => {
  it('quotes headers and cells with commas, quotes, line breaks and outer spaces', () => {
    const csv = resultsToCsv(
      ['Name, full', 'Say "hi"'],
      [
        ['a\r\nb', ' padded'],
        ['plain', 'x'],
      ]
    );
    expect(csv).toBe('"Name, full","Say ""hi"""\n"a\r\nb"," padded"\nplain,x');
  });

  it('defuses formula-like text but keeps numbers raw', () => {
    const csv = resultsToCsv(
      ['=SUM(A1)', 'b'],
      [
        ['=HYPERLINK("x")', -12.5],
        ['+1 call', '-3'],
        ['@cmd', '\tTab'],
      ]
    );
    expect(csv.split('\n')).toEqual([
      "'=SUM(A1),b",
      `"'=HYPERLINK(""x"")",-12.5`,
      "'+1 call,-3",
      "'@cmd,'\tTab",
    ]);
  });

  it('writes dates as ISO text and empty cells for null', () => {
    const csv = resultsToCsv(['d', 'n'], [[new Date('2026-03-04T00:00:00Z'), null]]);
    expect(csv).toBe('d,n\n2026-03-04,');
  });

  it('can leave text untouched for raw dumps', () => {
    expect(resultsToCsv(['memo'], [['=1+1']], { defuseFormulas: false })).toBe('memo\n=1+1');
  });
});

describe('csvField', () => {
  it('never defuses numbers', () => {
    expect(csvField('-5', -5)).toBe('-5');
    expect(csvField('-Rent')).toBe("'-Rent");
  });
});
