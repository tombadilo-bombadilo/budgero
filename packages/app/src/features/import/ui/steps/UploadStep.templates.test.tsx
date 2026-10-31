import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { UploadStep } from './UploadStep';

const PUBLIC_DIR = path.resolve(__dirname, '../../../../../public');

describe('UploadStep import templates', () => {
  it('offers both templates as downloads that ship with the app', () => {
    render(
      <UploadStep
        fileInputRef={createRef<HTMLInputElement>()}
        onFileChange={() => {}}
        error={null}
        hasBudgetSelected
      />
    );
    const xlsx = screen.getByRole('link', { name: 'Spreadsheet template (.xlsx)' });
    const csv = screen.getByRole('link', { name: 'CSV template' });
    for (const link of [xlsx, csv]) {
      expect(link).toHaveAttribute('download');
      const href = link.getAttribute('href') ?? '';
      expect(href).toMatch(/^\/templates\/budgero-import-template\.(xlsx|csv)$/);
      expect(existsSync(path.join(PUBLIC_DIR, href))).toBe(true);
    }
    expect(
      readFileSync(path.join(PUBLIC_DIR, 'templates/budgero-import-template.csv'), 'utf8').trim()
    ).toBe('Date,Payee,Amount,Memo,Category,Account');
  });
});
