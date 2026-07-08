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

export function isSupportedImportFile(file: File): boolean {
  return isSupportedImportFileName(file.name);
}

/** Human-readable list of supported import formats, shared by upload/drop UI copy. */
export const SUPPORTED_IMPORT_FORMATS_LABEL = 'CSV, TSV, TXT, PDF, OFX, QFX, QIF, or CAMT.053 XML';
