/**
 * Arrow query results → plain rows (shared by the engine and its tests).
 *
 * Arrow hands DECIMAL cells over as big-number objects whose text is the
 * unscaled integer (DECIMAL(18, 3) 12.345 → "12345") and DATE cells as epoch
 * milliseconds; both are turned into what the query meant: a number in units
 * (from the exact decimal text, so it rounds once) and a "YYYY-MM-DD" string.
 */

interface ArrowField {
  name: string;
  type: { typeId: number; scale?: number };
}

export interface ArrowTableLike {
  schema: { fields: ArrowField[] };
  toArray(): unknown[];
}

function normalizeBigInt(value: bigint): number | string {
  const asNumber = Number(value);
  return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
}

/** Arrow's Type ids (apache-arrow `Type` enum). */
const ARROW_DECIMAL = 7;
const ARROW_DATE = 8;

/** "-12345" with scale 3 → -12.345, through the exact decimal text. */
export function scaleDecimal(value: unknown, scale: number): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/"/g, '').trim();
  if (!/^-?\d+$/.test(text)) {
    const numeric = Number(text);
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (scale <= 0) return Number(text);
  const negative = text.startsWith('-');
  const digits = (negative ? text.slice(1) : text).padStart(scale + 1, '0');
  const decimal = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return Number(negative ? `-${decimal}` : decimal);
}

function isoDay(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(Number(value));
  if (Number.isNaN(date.getTime())) return value;
  // A DATE is a calendar day stored as UTC midnight: read its UTC parts.
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function normalizeValue(value: unknown, field?: ArrowField): unknown {
  if (field?.type.typeId === ARROW_DECIMAL) return scaleDecimal(value, field.type.scale ?? 0);
  if (field?.type.typeId === ARROW_DATE) return isoDay(value);
  if (typeof value === 'bigint') return normalizeBigInt(value);
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function arrowTableToRows(table: ArrowTableLike): { columns: string[]; rows: unknown[][] } {
  const { fields } = table.schema;
  const columns = fields.map((field) => field.name);
  const objectRows = table.toArray() as Record<string, unknown>[];
  const rows = objectRows.map((row) =>
    fields.map((field) => normalizeValue(row[field.name], field))
  );
  return { columns, rows };
}
