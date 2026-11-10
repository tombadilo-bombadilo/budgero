import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildCsvZip, csvFileNames, zipFileName } from './export-dashboard';

describe('csvFileNames', () => {
  it('makes safe, unique names', () => {
    expect(csvFileNames(['Spending', 'spending', 'A/B: test', '', 'Spending'])).toEqual([
      'Spending.csv',
      'spending (2).csv',
      'A B test.csv',
      'widget.csv',
      'Spending (3).csv',
    ]);
  });
});

describe('zipFileName', () => {
  it('names the archive after the dashboard', () => {
    expect(zipFileName('My / Dashboard')).toBe('My Dashboard.zip');
    expect(zipFileName('')).toBe('dashboard.zip');
  });
});

describe('buildCsvZip', () => {
  it('puts every widget in one archive', async () => {
    const blob = await buildCsvZip([
      { title: 'Spending', csv: 'a,b\n1,2' },
      { title: 'Spending', csv: 'c\n3' },
    ]);
    const zip = await JSZip.loadAsync(blob);
    expect(Object.keys(zip.files)).toEqual(['Spending.csv', 'Spending (2).csv']);
    const first = await zip.file('Spending.csv')!.async('string');
    expect(first.charCodeAt(0)).toBe(0xfeff);
    expect(first.slice(1)).toBe('a,b\n1,2');
    expect(await zip.file('Spending (2).csv')!.async('uint8array')).toHaveLength(3 + 3);
  });
});
