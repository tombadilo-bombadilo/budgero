import { describe, expect, it } from 'vitest';
import { UnsupportedImportFileError } from './constants';
import { parseImportFile } from './parse-import-file';

describe('parseImportFile', () => {
  it('rejects an unsupported file type with UnsupportedImportFileError', async () => {
    const file = new File(['%PNG'], 'receipt.png', { type: 'image/png' });
    const parsing = parseImportFile(file, 0);
    await expect(parsing).rejects.toBeInstanceOf(UnsupportedImportFileError);
    await expect(parsing).rejects.toThrow(/Please upload a .+ file\./);
  });
});
