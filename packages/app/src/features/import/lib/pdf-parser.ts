/**
 * PDF Table Extraction — pdfjs reader.
 *
 * The pure table-detection algorithms live in @budgero/core
 * (services/import/pdf-table) so they are isomorphic and unit-testable.
 * This file holds only the pdfjs-specific step: reading a PDFDocumentProxy's
 * text content into normalized PDFTextItem[], then delegating to the core
 * extractor.
 */

import type { PDFDocumentProxy, PDFPageProxy, TextItem } from 'pdfjs-dist/types/src/display/api';
import {
  extractTablesFromPageItems,
  type PDFTextItem,
  type ExtractedTable,
} from '@budgero/core/browser';

// Re-export the pure helpers + types from core so existing import sites that
// reference them via this module keep working.
export {
  findColumnBoundaries,
  findColumnIndex,
  findHeaderRow,
  extractTablesFromPageItems,
  mergeExtractedTables,
  applyHeaderSelection,
} from '@budgero/core/browser';
export type { PDFTextItem, ExtractedTable } from '@budgero/core/browser';

/**
 * Read a single PDF page's text items and normalize coordinates.
 */
async function extractPageTextItems(
  pdf: PDFDocumentProxy,
  pageNum: number
): Promise<PDFTextItem[]> {
  const page: PDFPageProxy = await pdf.getPage(pageNum);
  const textContent = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1.0 });

  return textContent.items
    .map((item) => {
      const textItem = item as TextItem;
      const { transform } = textItem;
      const x = transform[4];
      const y = viewport.height - transform[5];
      return {
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        width: textItem.width || 0,
        height: textItem.height || 0,
        text: textItem.str.trim(),
        fontSize: textItem.height || 12,
        fontName: (textItem as TextItem & { fontName?: string }).fontName || '',
        transform,
      };
    })
    .filter((item) => item.text.length > 0);
}

/**
 * Extract tables from a PDF document. Thin wrapper around the core
 * `extractTablesFromPageItems` that handles the pdfjs-specific text
 * extraction up front.
 */
export async function extractTablesFromPDF(pdf: PDFDocumentProxy): Promise<ExtractedTable[]> {
  const pagesItems: PDFTextItem[][] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    pagesItems.push(await extractPageTextItems(pdf, pageNum));
  }
  return extractTablesFromPageItems(pagesItems);
}
