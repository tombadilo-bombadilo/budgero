import {
  parseOfx,
  ofxToImportRows,
  parseQif,
  qifToImportRows,
  parseCamt,
  camtToImportRows,
  looksLikeCamt,
  decodeImportText,
  parseDelimitedText,
} from '@budgero/core/browser';
import { extractTablesFromPDF, mergeExtractedTables } from '@features/import/lib/pdf-parser';
import {
  isSupportedImportFile,
  SUPPORTED_IMPORT_FORMATS_LABEL,
} from '@features/import/lib/constants';
import type { ImportConfig, ParsedData, RawTableData } from '@features/import/model/types';

export interface ParseImportFileResult {
  data: ParsedData;
  /**
   * Import-config patch for structured formats (CAMT/OFX/QIF), which
   * pre-determine the account currency and the date format (already
   * normalized by the parser).
   */
  configPatch?: Partial<ImportConfig>;
  /** PDF sources only: the full extracted table + the header row to default to. */
  pdfTable?: { rawTableData: RawTableData; suggestedHeaderIndex: number };
}

/**
 * Parses an uploaded import file into `ParsedData`, dispatching on file type
 * (CAMT.053 XML, OFX/QFX, QIF, PDF, or delimited CSV/TSV/TXT). Pure aside from
 * reading the file's contents — callers apply `configPatch`/`pdfTable` to
 * their own state; this function doesn't touch React state directly.
 *
 * Throws a user-facing `Error` when the file is unsupported or its contents
 * can't be read (no transactions found, no text layer, etc).
 */
export async function parseImportFile(
  file: File,
  skipRows: number
): Promise<ParseImportFileResult> {
  // Shared tail of the structured-format (CAMT/OFX/QIF) branches: seed the
  // account currency when the file declares one (so the user doesn't have
  // to pick it manually) and fix the date format at YYYY-MM-DD because the
  // parser already normalized dates.
  const applyStructuredImport = (
    source: 'camt' | 'ofx' | 'qif',
    headers: readonly string[],
    rows: Record<string, string>[],
    currency?: string
  ): ParseImportFileResult => ({
    data: {
      headers: [...headers],
      rows,
      source: { type: source, file, fileName: file.name },
    },
    configPatch: {
      ...(currency ? { accountCurrency: currency } : {}),
      dateFormat: 'YYYY-MM-DD',
    },
  });

  if (!isSupportedImportFile(file)) {
    throw new Error(`Please upload a ${SUPPORTED_IMPORT_FORMATS_LABEL} file.`);
  }

  const fileType = file.name.toLowerCase();

  // Sniff `.xml` files: only CAMT.053 is supported (not generic XML
  // or other ISO 20022 messages like pain.* / camt.052 / camt.054).
  if (fileType.endsWith('.xml')) {
    const buffer = await file.arrayBuffer();
    const { text } = decodeImportText(buffer);
    if (!looksLikeCamt(text)) {
      throw new Error(
        'This XML file is not a CAMT.053 bank statement. ' +
          'Budgero only imports CAMT.053; other ISO 20022 messages ' +
          '(pain.*, camt.052, camt.054) are not supported.'
      );
    }
    const parsed = parseCamt(text);
    const { headers, rows, currency } = camtToImportRows(parsed);
    if (rows.length === 0) {
      throw new Error(
        'No transactions found in this CAMT.053 file. ' +
          'Statements with only balance summaries (no <Ntry> entries) cannot be imported.'
      );
    }
    return applyStructuredImport('camt', headers, rows, currency);
  }

  if (fileType.endsWith('.ofx') || fileType.endsWith('.qfx')) {
    const buffer = await file.arrayBuffer();
    const { text } = decodeImportText(buffer);
    const parsed = parseOfx(text);
    const { headers, rows, currency } = ofxToImportRows(parsed);
    if (rows.length === 0) {
      throw new Error(
        'No transactions found in this OFX/QFX file. ' +
          'Investment-only statements are not supported — try a bank or credit-card export.'
      );
    }
    return applyStructuredImport('ofx', headers, rows, currency);
  }

  if (fileType.endsWith('.qif')) {
    const buffer = await file.arrayBuffer();
    const { text } = decodeImportText(buffer);
    const parsed = parseQif(text);
    const { headers, rows } = qifToImportRows(parsed);
    if (rows.length === 0) {
      throw new Error(
        'No transactions found in this QIF file. ' +
          'Only Bank, CCard, and Cash sections are supported (investment QIF is not).'
      );
    }
    return applyStructuredImport('qif', headers, rows);
  }

  if (fileType.endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist');
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      // Bundled from the installed pdfjs-dist via Vite (?url) — same origin,
      // version-matched, works offline. No CDN.
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer, verbosity: 0 }).promise;

    // Quick text-layer sanity check: a scanned or "Print to PDF"-from-
    // an-image file will have zero extractable text items on every page.
    // We can't OCR it here, so surface a clear error instead of the
    // misleading "No tables detected" message the parser would emit.
    let hasAnyText = false;
    for (let pageNum = 1; pageNum <= pdf.numPages && !hasAnyText; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      if (content.items.length > 0) {
        hasAnyText = true;
      }
    }
    if (!hasAnyText) {
      throw new Error(
        'This PDF has no extractable text — it looks like a scanned image. ' +
          "Budgero imports PDFs by reading their text layer, which this file doesn't have. " +
          'Try exporting the statement as CSV from your bank, or use a text-based PDF ' +
          'generated directly by the bank (not a scan or screenshot).'
      );
    }

    const pdfTables = await extractTablesFromPDF(pdf);

    if (pdfTables.length === 0) {
      throw new Error(
        'No table structure detected in PDF. The file has text but the parser ' +
          "couldn't find a consistent table layout. If the statement is available " +
          'as CSV, that usually works better.'
      );
    }

    // Stitch per-page tables back into one logical table so multi-page
    // statements import every transaction, not just the first page.
    const table = mergeExtractedTables(pdfTables);
    if (!table?.allRows || !Array.isArray(table.allRows) || table.allRows.length === 0) {
      throw new Error('No table rows detected in PDF.');
    }

    const suggestedHeaderIndex =
      typeof table.suggestedHeaderIndex === 'number' ? table.suggestedHeaderIndex : 0;

    return {
      data: {
        headers: table.allRows[suggestedHeaderIndex]?.filter((h: string) => h && h.trim()) || [],
        rows: [],
        source: { type: 'pdf', file, fileName: file.name },
      },
      pdfTable: { rawTableData: table as RawTableData, suggestedHeaderIndex },
    };
  }

  const text = await file.text();
  const { headers, rows } = parseDelimitedText(text, skipRows);

  return {
    data: {
      headers,
      rows,
      source: { type: 'csv', file, fileName: file.name },
    },
  };
}
