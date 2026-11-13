/**
 * Desktop dashboard grid sizing.
 *
 * The grid has 12 columns and 2 px rows with no row gap; each widget carries
 * the vertical gap as bottom padding. A saved question keeps its fixed height
 * (rowSpan × 140 px plus 16 px between rows, as before), while a built-in card
 * spans as many 2 px rows as its content needs. Built-in cards that start on
 * the same row stretch to the tallest of them, like the old home page's rows.
 */
export const GRID_COLUMNS = 12;
export const ROW_UNIT_PX = 2;
const QUESTION_ROW_PX = 140;
const QUESTION_ROW_GAP_PX = 16;

export interface GridSpacing {
  /** Space between columns, px. */
  gapX: number;
  /** Space between rows, px. */
  gapY: number;
}

/** Custom dashboards (and the questions' fixed sizes). */
export const DASHBOARD_SPACING: GridSpacing = { gapX: 16, gapY: 16 };
/** The home page: the old home's 20 px columns and 24 px rows. */
export const HOME_SPACING: GridSpacing = { gapX: 20, gapY: 24 };

/** Height of a saved question's card for its row span. */
export function questionHeightPx(rowSpan: number): number {
  return rowSpan * QUESTION_ROW_PX + (rowSpan - 1) * QUESTION_ROW_GAP_PX;
}

/** Grid rows a widget of `heightPx` takes, including the gap below it. */
export function rowUnitsFor(heightPx: number, spacing: GridSpacing): number {
  return Math.max(1, Math.ceil((Math.max(0, heightPx) + spacing.gapY) / ROW_UNIT_PX));
}

export interface GridItem {
  colSpan: number;
  rowUnits: number;
}

export interface GridPlacement {
  row: number;
  col: number;
}

/**
 * Where CSS grid's auto-placement ("sparse", rows) puts each item: the cursor
 * moves forward through the rows and each item takes the first free spot at
 * or after it. Used only to tell which items start on the same row.
 */
export function placeItems(items: GridItem[], columns = GRID_COLUMNS): GridPlacement[] {
  const occupied: Uint8Array[] = [];
  const rowAt = (row: number) => {
    while (occupied.length <= row) occupied.push(new Uint8Array(columns));
    return occupied[row];
  };
  const free = (row: number, col: number, width: number, height: number) => {
    for (let r = row; r < row + height; r += 1) {
      const cells = rowAt(r);
      for (let c = col; c < col + width; c += 1) if (cells[c]) return false;
    }
    return true;
  };

  let cursorRow = 0;
  let cursorCol = 0;
  return items.map((item) => {
    const width = Math.max(1, Math.min(columns, item.colSpan));
    const height = Math.max(1, item.rowUnits);
    for (let row = cursorRow; ; row += 1) {
      for (let col = row === cursorRow ? cursorCol : 0; col + width <= columns; col += 1) {
        if (!free(row, col, width, height)) continue;
        for (let r = row; r < row + height; r += 1) rowAt(r).fill(1, col, col + width);
        cursorRow = row;
        cursorCol = col + width;
        return { row, col };
      }
    }
  });
}

/**
 * Row units per item: questions as given, built-in cards raised to the
 * tallest built-in card starting on the same row (repeated until stable,
 * since stretching can move what comes after).
 */
export function equalizeBuiltinRows(
  items: (GridItem & { builtin: boolean })[],
  columns = GRID_COLUMNS
): number[] {
  let units = items.map((item) => item.rowUnits);
  for (let pass = 0; pass < 4; pass += 1) {
    const placements = placeItems(
      items.map((item, index) => ({ colSpan: item.colSpan, rowUnits: units[index] })),
      columns
    );
    const tallest = new Map<number, number>();
    items.forEach((item, index) => {
      if (!item.builtin) return;
      const { row } = placements[index];
      tallest.set(row, Math.max(tallest.get(row) ?? 0, item.rowUnits));
    });
    const next = items.map((item, index) =>
      item.builtin ? (tallest.get(placements[index].row) ?? item.rowUnits) : item.rowUnits
    );
    if (next.every((value, index) => value === units[index])) return next;
    units = next;
  }
  return units;
}
