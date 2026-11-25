import { msg } from '@lingui/core/macro';

export const SUPPORTED_IMPORT_EXTENSIONS = [
  '.csv',
  '.tsv',
  '.txt',
  '.pdf',
  '.ofx',
  '.qfx',
  '.qif',
  '.xml',
];

export function isSupportedImportFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED_IMPORT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * The picked file isn't a format the importer reads. An expected user mistake
 * with its own message, not an app failure, so callers don't log it as one.
 */
export class UnsupportedImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedImportFileError';
  }
}

export function isSupportedImportFile(file: File): boolean {
  return isSupportedImportFileName(file.name);
}

/** Human-readable list of supported import formats, shared by upload/drop UI copy. */
export const SUPPORTED_IMPORT_FORMATS_LABEL = msg`CSV, TSV, TXT, PDF, OFX, QFX, QIF, or CAMT.053 XML`;
