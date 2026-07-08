/**
 * PDF table extraction — pure algorithms.
 *
 * Grid-based table detection that operates on already-normalized text items
 * (one array per page). No pdfjs / DOM dependency, so it is isomorphic and
 * unit-testable against captured fixtures. The pdfjs-specific page reader that
 * produces `PDFTextItem[]` lives in the app (it needs the browser pdfjs build).
 */

export interface PDFTextItem {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
  fontName: string;
  transform: number[];
}

export interface ExtractedTable {
  pageNumber: number;
  allRows: string[][];
  headers: string[];
  rows: string[][];
  columnCount: number;
  suggestedHeaderIndex: number;
}

/**
 * Find column boundaries based on X positions with clustering.
 * Groups similar X positions into clusters to identify column boundaries.
 */
export function findColumnBoundaries(xPositions: number[]): number[] {
  if (xPositions.length === 0) return [];

  // Sort but DO NOT deduplicate — cluster weights below need the actual
  // number of items at each X, not the number of unique X values. A real
  // column that has 18 items all at the same X should outweigh a spurious
  // column that has 3 items at 3 nearby unique X positions.
  const sortedPositions = [...xPositions].sort((a, b) => a - b);

  // Group positions into clusters (potential columns)
  const clusters: number[][] = [];
  const clusterTolerance = 15;

  for (const pos of sortedPositions) {
    let addedToCluster = false;

    for (const cluster of clusters) {
      const avgPos = cluster.reduce((sum, p) => sum + p, 0) / cluster.length;
      if (Math.abs(pos - avgPos) < clusterTolerance) {
        cluster.push(pos);
        addedToCluster = true;
        break;
      }
    }

    if (!addedToCluster) {
      clusters.push([pos]);
    }
  }

  // Calculate representative position (median) for each cluster, along with
  // the cluster weight (number of X positions) so we can prefer denser
  // clusters during the merge step below.
  const clusterStats = clusters.map((cluster) => {
    cluster.sort((a, b) => a - b);
    const mid = Math.floor(cluster.length / 2);
    const median = cluster.length % 2 === 0 ? (cluster[mid - 1] + cluster[mid]) / 2 : cluster[mid];
    return { pos: median, weight: cluster.length };
  });

  // Collapse clusters that sit within `mergeTolerance` of each other (two
  // clusters that close probably represent the same visual column, just
  // split by minor text-rendering wobble). When clusters are within the
  // tolerance, keep the DENSER one — the one backed by more X positions —
  // instead of always keeping whichever came first. This matters for
  // statements where a sparse cluster from an unrelated side-table sits
  // next to the dense cluster of the real transaction column; always
  // keeping the first cluster would drop the real column.
  clusterStats.sort((a, b) => a.pos - b.pos);
  const kept: { pos: number; weight: number }[] = [];
  const mergeTolerance = 30;
  for (const cluster of clusterStats) {
    const last = kept[kept.length - 1];
    if (!last || Math.abs(cluster.pos - last.pos) >= mergeTolerance) {
      kept.push({ ...cluster });
      continue;
    }
    // Within tolerance → keep whichever has more X positions. Tie-break by
    // keeping the existing one.
    if (cluster.weight > last.weight) {
      kept[kept.length - 1] = { ...cluster };
    }
  }

  return kept.map((c) => c.pos);
}

/**
 * Find which column an X position belongs to.
 * Returns the index of the closest column boundary within tolerance.
 */
export function findColumnIndex(x: number, boundaries: number[]): number {
  if (boundaries.length === 0) return -1;

  let closestIndex = 0;
  let minDistance = Math.abs(x - boundaries[0]);

  for (let i = 1; i < boundaries.length; i++) {
    const distance = Math.abs(x - boundaries[i]);
    if (distance < minDistance) {
      minDistance = distance;
      closestIndex = i;
    }
  }

  return minDistance < 35 ? closestIndex : -1;
}

/**
 * Find the most likely header row in a set of rows.
 * Uses heuristics based on common header keywords and data patterns.
 */
export function findHeaderRow(rows: string[][]): number {
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  let bestScore = -1000;
  let bestIndex = 0;

  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i];
    let score = 0;
    let numericCells = 0;
    let textCells = 0;

    for (const cell of row) {
      if (!cell || cell.trim().length === 0) continue;

      const cellLower = cell.toLowerCase().trim();

      // Strong header indicators (language-agnostic)
      if (cellLower.includes('date') || cellLower.includes('datum') || cellLower.includes('dat'))
        score += 20;
      if (
        cellLower.includes('amount') ||
        cellLower.includes('sum') ||
        cellLower.includes('iznos') ||
        cellLower.includes('total')
      )
        score += 20;
      if (
        cellLower.includes('description') ||
        cellLower.includes('desc') ||
        cellLower.includes('opis') ||
        cellLower.includes('naziv')
      )
        score += 15;
      if (
        cellLower.includes('balance') ||
        cellLower.includes('stanje') ||
        cellLower.includes('saldo')
      )
        score += 15;
      if (
        cellLower.includes('reference') ||
        cellLower.includes('ref') ||
        cellLower.includes('rb') ||
        cellLower.includes('broj')
      )
        score += 10;
      if (cellLower.includes('type') || cellLower.includes('tip') || cellLower.includes('vrsta'))
        score += 10;
      if (
        cellLower.includes('payee') ||
        cellLower.includes('primatelj') ||
        cellLower.includes('korisnik')
      )
        score += 10;
      if (
        cellLower.includes('category') ||
        cellLower.includes('kategorija') ||
        cellLower.includes('grupa')
      )
        score += 10;

      // Medium header indicators
      if (/^(no|br|num|#)\.?$/i.test(cellLower)) score += 8;
      if (/^(id|ID)$/i.test(cellLower)) score += 8;

      // Penalize numeric content (likely data rows)
      if (/^\d+([.,]\d+)*$/.test(cell.trim())) {
        numericCells++;
        score -= 25;
      } else if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(cell.trim())) {
        numericCells++;
        score -= 30;
      } else if (/^[a-zA-Z\s]+$/.test(cell.trim()) && cell.trim().length > 2) {
        textCells++;
        score += 5;
      }

      // Heavy penalty for transaction data patterns
      if (/^\d+$/.test(cell.trim()) && cell.trim().length < 4) score -= 20;
      if (/googlepay|paypal|visa|mastercard|transaction/i.test(cellLower)) score -= 35;
      if (/\d{1,2}\.\d{1,2}\.\d{4}/.test(cell)) score -= 35;
    }

    const totalCells = row.filter((cell) => cell && cell.trim().length > 0).length;
    if (totalCells === 0) continue;

    const numericRatio = numericCells / totalCells;
    const textRatio = textCells / totalCells;

    if (textRatio > 0.6) score += 15;
    if (numericRatio > 0.7) score -= 40;

    // Prefer early rows but not the first (might be title)
    if (i === 0) score -= 5;
    else if (i <= 3) score += 10;
    else if (i <= 6) score += 5;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

/**
 * Patterns that strongly indicate a row is page header/footer boilerplate
 * (bank name, URL, IBAN/PIB, page numbers) rather than transaction data.
 * Used to strip these rows BEFORE column boundary clustering so the boilerplate
 * X-positions don't pollute the column layout and skew real transaction cells.
 */
const FOOTER_PATTERNS: RegExp[] = [
  /https?:\/\//i,
  /\bwww\.[a-z]/i,
  /\.(rs|com|net|org|io|eu|co\.uk|de|at|ch)\b/i,
  /\bpib\s*:?\b/i,
  /\bmati(č|c)ni\s*broj\b/i,
  /\bra(č|c)un\s*banke?\b/i,
  /\bkorisni(č|c)ki\s*servis\b/i,
  /\biban\b/i,
  /\bswift\b/i,
  /\bbic\b/i,
  /\b\d+\s+(od|of|von|de|su)\s+\d+\b/i, // "1 od 8", "Page 1 of 8", etc.
  /\+\s?\d{1,4}\s?\d[\d\s]{4,}/, // phone numbers
  /^\s*\d+\s*\/\s*\d+\s*$/, // "1/8" page indicator
];

function rowLooksLikeHeaderFooter(items: PDFTextItem[]): boolean {
  const combined = items
    .map((i) => i.text)
    .join(' ')
    .trim();
  if (combined.length === 0) return false;
  return FOOTER_PATTERNS.some((p) => p.test(combined));
}

/**
 * Group text items on a page into rows by Y-proximity. Items are sorted in
 * place. The threshold is derived from average font size so it adapts to the
 * page's typography.
 */
function groupItemsIntoRows(items: PDFTextItem[], rowThreshold: number): PDFTextItem[][] {
  items.sort((a, b) => {
    const yDiff = a.y - b.y;
    if (Math.abs(yDiff) < 3) return a.x - b.x;
    return yDiff;
  });

  const rows: PDFTextItem[][] = [];
  let currentRow: PDFTextItem[] = [];
  let lastY = -1;

  for (const item of items) {
    if (lastY === -1 || Math.abs(item.y - lastY) < rowThreshold) {
      currentRow.push(item);
      lastY = item.y;
    } else {
      if (currentRow.length > 0) {
        rows.push([...currentRow]);
      }
      currentRow = [item];
      lastY = item.y;
    }
  }
  if (currentRow.length > 0) {
    rows.push(currentRow);
  }
  return rows;
}

function avgFontSizeOf(items: PDFTextItem[]): number {
  const sizes = items.map((i) => i.fontSize).filter((s) => s > 0);
  if (sizes.length === 0) return 12;
  return sizes.reduce((a, b) => a + b, 0) / sizes.length;
}

/**
 * Convert per-page body rows into a structured ExtractedTable using a
 * pre-computed (typically global, document-wide) set of column boundaries.
 *
 * Steps:
 *   1. Snap each row's items to the nearest column boundary.
 *   2. Merge "continuation" rows (sparse rows that wrap a long description
 *      below a real transaction row) cell-wise into the previous row.
 *   3. Drop rows with fewer than 3 non-empty cells as a final sanity filter.
 *   4. Heuristically identify the column-header row.
 */
function structureBodyRows(
  bodyRows: PDFTextItem[][],
  columnBoundaries: number[],
  avgFontSize: number,
  pageNum: number
): ExtractedTable | null {
  if (bodyRows.length === 0 || columnBoundaries.length === 0) return null;

  const rowsWithMeta: { cells: string[]; y: number }[] = [];

  for (const row of bodyRows) {
    row.sort((a, b) => a.x - b.x);

    const columns: string[] = new Array(columnBoundaries.length).fill('');
    for (const item of row) {
      const columnIndex = findColumnIndex(item.x, columnBoundaries);
      if (columnIndex !== -1) {
        columns[columnIndex] = `${columns[columnIndex]} ${item.text}`.trim();
      }
    }

    const ys = row.map((i) => i.y).sort((a, b) => a - b);
    const medianY = ys[Math.floor(ys.length / 2)] ?? row[0]?.y ?? 0;
    rowsWithMeta.push({ cells: columns, y: medianY });
  }

  // ---- Continuation row merging -------------------------------------------
  const DATE_RE = /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/;
  const AMOUNT_RE = /\d+[.,]\d{2}/;
  const cellHasDateOrAmount = (cells: string[]) =>
    cells.some((c) => DATE_RE.test(c) || AMOUNT_RE.test(c));
  const nonEmptyCount = (cells: string[]) => cells.filter((c) => c && c.trim().length > 0).length;

  const continuationGap = Math.max(avgFontSize * 1.8, 14);
  const mergedRows: { cells: string[]; y: number }[] = [];

  for (const row of rowsWithMeta) {
    const prev = mergedRows[mergedRows.length - 1];
    const isSparse = nonEmptyCount(row.cells) <= 2;
    const noOwnData = !cellHasDateOrAmount(row.cells);
    const prevLooksLikeTxn =
      prev && nonEmptyCount(prev.cells) >= 4 && cellHasDateOrAmount(prev.cells);
    const closeToPrev = prev ? Math.abs(row.y - prev.y) <= continuationGap : false;

    if (prev && isSparse && noOwnData && prevLooksLikeTxn && closeToPrev) {
      for (let c = 0; c < row.cells.length && c < prev.cells.length; c++) {
        const newCell = row.cells[c];
        if (newCell && newCell.trim().length > 0) {
          prev.cells[c] = prev.cells[c] ? `${prev.cells[c]} ${newCell}`.trim() : newCell;
        }
      }
      prev.y = row.y;
      continue;
    }

    mergedRows.push({ cells: [...row.cells], y: row.y });
  }

  const structuredRows: string[][] = mergedRows
    .filter((r) => nonEmptyCount(r.cells) >= 3)
    .map((r) => r.cells);

  if (structuredRows.length === 0) return null;

  let suggestedIndex = 0;
  try {
    suggestedIndex = findHeaderRow(structuredRows);
  } catch {
    suggestedIndex = 0;
  }

  return {
    pageNumber: pageNum,
    allRows: structuredRows,
    headers: [],
    rows: [],
    columnCount: columnBoundaries.length,
    suggestedHeaderIndex: suggestedIndex,
  };
}

// Patterns used to decide whether a row looks like an actual transaction
// (has both a date and an amount). Used for data-only column clustering.
const TXN_DATE_RE = /\d{1,2}[./-]\d{1,2}[./-]?\d{0,4}/;
const TXN_DATE_WORD_RE =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{1,2}\b/i;
const TXN_AMOUNT_RE = /\d+[.,]\d{2}/;

function rowLooksLikeTransaction(row: PDFTextItem[]): boolean {
  const text = row.map((i) => i.text).join(' ');
  const hasDate = TXN_DATE_RE.test(text) || TXN_DATE_WORD_RE.test(text);
  const hasAmount = TXN_AMOUNT_RE.test(text);
  return hasDate && hasAmount;
}

/**
 * Pure-function table extractor. Operates on already-normalized PDFTextItem
 * arrays (one per page), so it's easy to unit test against captured fixtures
 * without pulling pdfjs into the test runtime.
 *
 * Two-pass approach:
 *   Pass A — for each page, group items into rough rows (by Y-proximity)
 *     and drop rows that match obvious header/footer boilerplate (URL,
 *     IBAN, page number, bank metadata). Collect the surviving "body" rows.
 *   Pass B — compute a SINGLE set of column boundaries from rows that look
 *     like transaction data (contain both a date AND an amount), then
 *     structure every body row against those global boundaries.
 *
 * Two reasons boundaries are computed globally AND from data rows only:
 *
 *   1. Multi-page bank statements: page 1 usually carries extra metadata
 *      (account number, opening balance, summary block) whose X positions
 *      would shift per-page clustering and cause page-2-onwards rows to
 *      slot into different columns than page-1 rows. Going global fixes
 *      that.
 *
 *   2. Statements interleave the transaction table with fine-print
 *      paragraphs, multi-line compound headers, marketing banners, etc.
 *      All of that text contributes phantom X positions to the clustering,
 *      which balloons the column count (we've seen 13 columns in a real
 *      5-column table) and pushes transaction cells into "phantom"
 *      columns. Only seeding clustering with transaction-looking rows
 *      learns the grid from the part of the document we actually care
 *      about.
 *
 * Fallback: if fewer than `MIN_TXN_POSITIONS_FOR_CLUSTERING` X positions
 * come from transaction-looking rows, we fall back to using every body
 * row's X positions so we don't break on statements whose date/amount
 * formats don't match our regex.
 */
export function extractTablesFromPageItems(pagesItems: PDFTextItem[][]): ExtractedTable[] {
  type PageBundle = {
    pageNum: number;
    bodyRows: PDFTextItem[][];
    avgFontSize: number;
  };
  const perPage: PageBundle[] = [];
  const allBodyXPositions: number[] = [];
  const txnRowXPositions: number[] = [];

  pagesItems.forEach((items, idx) => {
    const pageNum = idx + 1;
    if (!items || items.length === 0) return;

    const avgFontSize = avgFontSizeOf(items);
    const rowThreshold = Math.max(avgFontSize * 0.7, 6);
    const rawRows = groupItemsIntoRows(items, rowThreshold);
    const bodyRows = rawRows.filter((row) => !rowLooksLikeHeaderFooter(row));
    if (bodyRows.length === 0) return;

    perPage.push({ pageNum, bodyRows, avgFontSize });
    for (const row of bodyRows) {
      const isTxn = rowLooksLikeTransaction(row);
      for (const item of row) {
        allBodyXPositions.push(item.x);
        if (isTxn) txnRowXPositions.push(item.x);
      }
    }
  });

  if (perPage.length === 0 || allBodyXPositions.length === 0) return [];

  const MIN_TXN_POSITIONS_FOR_CLUSTERING = 20;
  const xPositionsToCluster =
    txnRowXPositions.length >= MIN_TXN_POSITIONS_FOR_CLUSTERING
      ? txnRowXPositions
      : allBodyXPositions;
  xPositionsToCluster.sort((a, b) => a - b);
  const globalBoundaries = findColumnBoundaries(xPositionsToCluster);

  if (globalBoundaries.length === 0) return [];

  const tables: ExtractedTable[] = [];
  for (const { pageNum, bodyRows, avgFontSize } of perPage) {
    const table = structureBodyRows(bodyRows, globalBoundaries, avgFontSize, pageNum);
    if (table) tables.push(table);
  }

  return tables;
}

/**
 * Compare two rows for textual equality (ignores leading/trailing whitespace
 * and case). Used to detect repeated header rows on subsequent pages.
 */
function rowsTextuallyEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || !b) return false;
  const norm = (row: string[]) =>
    row
      .map((c) => (c || '').trim().toLowerCase())
      .filter((c) => c.length > 0)
      .join('|');
  const aNorm = norm(a);
  const bNorm = norm(b);
  return aNorm.length > 0 && aNorm === bNorm;
}

/**
 * Merge per-page extracted tables into a single logical table.
 *
 * Bank statement PDFs almost always continue the same transactions table
 * across multiple pages, but `extractTablesFromPageItems` returns one table per
 * page because column boundaries and row groupings are computed per page.
 *
 * This helper stitches them back together:
 *   - Page 1's header row (suggested by `findHeaderRow`) is the canonical header.
 *   - Subsequent pages contribute their data rows, skipping anything before
 *     and including their own suggested header (which is usually a repeated
 *     copy of the same column titles).
 *   - Rows that textually match the canonical header are filtered out as a
 *     second-pass safety net for repeated headers.
 *   - Pages whose column count differs from page 1 are still merged but
 *     padded/truncated to the canonical column count to keep cell alignment
 *     stable downstream.
 */
export function mergeExtractedTables(tables: ExtractedTable[]): ExtractedTable | null {
  if (tables.length === 0) return null;
  if (tables.length === 1) return tables[0];

  const base = tables[0];
  const canonicalColumnCount = base.columnCount;
  const headerRow = base.allRows[base.suggestedHeaderIndex];
  const mergedRows: string[][] = [...base.allRows];

  const fitToCanonical = (row: string[]): string[] => {
    if (row.length === canonicalColumnCount) return row;
    if (row.length > canonicalColumnCount) return row.slice(0, canonicalColumnCount);
    return [...row, ...new Array(canonicalColumnCount - row.length).fill('')];
  };

  for (let i = 1; i < tables.length; i++) {
    const t = tables[i];
    if (!t.allRows || t.allRows.length === 0) continue;

    // Skip the page's own suggested header row ONLY if it actually matches
    // the canonical header from page 1. If this page has no repeated header
    // (some bank statements only print headers on page 1), `findHeaderRow`
    // may still return a default index — blindly skipping that would drop a
    // real transaction.
    let startIdx = 0;
    if (
      typeof t.suggestedHeaderIndex === 'number' &&
      t.suggestedHeaderIndex >= 0 &&
      t.suggestedHeaderIndex < Math.min(5, t.allRows.length) &&
      rowsTextuallyEqual(t.allRows[t.suggestedHeaderIndex], headerRow)
    ) {
      startIdx = t.suggestedHeaderIndex + 1;
    }

    for (let r = startIdx; r < t.allRows.length; r++) {
      const row = t.allRows[r];
      // Second-pass filter: drop any row that's textually identical to the
      // canonical header (catches headers that weren't where we expected).
      if (rowsTextuallyEqual(row, headerRow)) continue;
      mergedRows.push(fitToCanonical(row));
    }
  }

  return {
    pageNumber: base.pageNumber,
    allRows: mergedRows,
    headers: base.headers,
    rows: base.rows,
    columnCount: canonicalColumnCount,
    suggestedHeaderIndex: base.suggestedHeaderIndex,
  };
}

/**
 * Apply header selection to an extracted table.
 * Sets the headers and data rows based on the selected header index.
 */
export function applyHeaderSelection(table: ExtractedTable, headerIndex: number): ExtractedTable {
  if (headerIndex < 0 || headerIndex >= table.allRows.length) {
    return table;
  }

  return {
    ...table,
    headers: table.allRows[headerIndex],
    rows: table.allRows.slice(headerIndex + 1),
    suggestedHeaderIndex: headerIndex,
  };
}
