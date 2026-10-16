import type { DatabaseAdapter } from './interface.js';
import { allRows, getRow, run } from './sql.js';

/**
 * Row journal: records exactly what a delete changed so undo can put the
 * database back row for row.
 *
 * Before the change, `RowCapture` reads every row the change could touch: the
 * rows being deleted plus everything that reaches them through foreign keys
 * (ON DELETE CASCADE children recursively, ON DELETE SET NULL children one
 * level), plus any extra rows the caller knows it will update. After the
 * change, `finish()` re-reads them and keeps only the differences:
 * - `deleted`: full rows that are gone (re-inserted under their own IDs);
 * - `changed`: previous values of the columns that changed, grouped by value;
 * - `inserted`: rows the change created in watched tables (removed again when
 *   nothing references them; the AUTOINCREMENT counter is put back too).
 *
 * The journal is plain JSON, so it travels as an undo op's payload and every
 * device applies the same restore. Table and column names in a journal are
 * checked against the live schema before any SQL is built from them.
 */

export type JournalValue = number | string | null | { $b64: string };
export type JournalRow = Record<string, JournalValue>;
type Key = number | string;

export interface RowJournal {
  v: 1;
  deleted: { table: string; rows: JournalRow[] }[];
  changed: { table: string; values: JournalRow; ids: Key[] }[];
  inserted: { table: string; ids: Key[]; seq?: { before: number | null; after: number } }[];
}

interface ForeignKey {
  child: string;
  column: string;
  parent: string;
  parentColumn: string;
  onDelete: string;
}

interface TableSchema {
  name: string;
  /** Stored columns (generated columns excluded). */
  columns: string[];
  pk: string;
  children: ForeignKey[];
  parents: ForeignKey[];
}

type Schema = Map<string, TableSchema>;

const CHUNK = 400;

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

function readSchema(db: DatabaseAdapter): Schema {
  const schema: Schema = new Map();
  const tables = allRows<{ name: string }>(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  );
  for (const { name } of tables) {
    const info = allRows<{ name: string; pk: number; hidden: number }>(
      db,
      `SELECT name, pk, hidden FROM pragma_table_xinfo('${name.replace(/'/g, "''")}')`
    );
    const pkColumns = info.filter((column) => column.pk > 0);
    if (pkColumns.length !== 1) continue; // only single-column keys can be journaled
    schema.set(name, {
      name,
      columns: info.filter((column) => !column.hidden).map((column) => column.name),
      pk: pkColumns[0].name,
      children: [],
      parents: [],
    });
  }
  for (const table of schema.values()) {
    const fks = allRows<{ table: string; from: string; to: string | null; on_delete: string }>(
      db,
      `SELECT "table", "from", "to", on_delete FROM pragma_foreign_key_list('${table.name.replace(/'/g, "''")}')`
    );
    for (const fk of fks) {
      const parent = schema.get(fk.table);
      if (!parent) continue;
      const key: ForeignKey = {
        child: table.name,
        column: fk.from,
        parent: parent.name,
        parentColumn: fk.to ?? parent.pk,
        onDelete: fk.on_delete.toUpperCase(),
      };
      table.parents.push(key);
      parent.children.push(key);
    }
  }
  return schema;
}

function encodeValue(value: unknown): JournalValue {
  if (value === undefined || value === null) return null;
  if (value instanceof Uint8Array) {
    let binary = '';
    for (const byte of value) binary += String.fromCharCode(byte);
    return { $b64: btoa(binary) };
  }
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value as number | string;
}

function decodeValue(value: JournalValue): unknown {
  if (value && typeof value === 'object') {
    const binary = atob(value.$b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return value;
}

function sameValue(a: JournalValue, b: JournalValue): boolean {
  if (a && typeof a === 'object' && b && typeof b === 'object') return a.$b64 === b.$b64;
  return a === b;
}

function encodeRow(table: TableSchema, row: Record<string, unknown>): JournalRow {
  const out: JournalRow = {};
  for (const column of table.columns) out[column] = encodeValue(row[column]);
  return out;
}

function readByKeys(db: DatabaseAdapter, table: TableSchema, keys: Key[]): JournalRow[] {
  const cols = table.columns.map(quote).join(', ');
  const rows: JournalRow[] = [];
  for (const part of chunks(keys)) {
    const marks = part.map(() => '?').join(', ');
    for (const row of allRows<Record<string, unknown>>(
      db,
      `SELECT ${cols} FROM ${quote(table.name)} WHERE ${quote(table.pk)} IN (${marks})`,
      ...part
    ))
      rows.push(encodeRow(table, row));
  }
  return rows;
}

/** Parents before children, so re-inserted rows never point at a missing row. */
function insertOrder(schema: Schema, tables: string[]): string[] {
  const wanted = new Set(tables);
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (name: string) => {
    if (state.get(name)) return;
    state.set(name, 'visiting');
    for (const fk of schema.get(name)?.parents ?? []) {
      if (wanted.has(fk.parent) && fk.parent !== name && !state.get(fk.parent)) visit(fk.parent);
    }
    state.set(name, 'done');
    order.push(name);
  };
  for (const name of [...wanted].sort()) visit(name);
  return order;
}

function sequenceOf(db: DatabaseAdapter, table: string): number | null {
  const hasSequence = getRow(
    db,
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'"
  );
  if (!hasSequence) return null;
  const row = getRow<{ seq: number }>(db, 'SELECT seq FROM sqlite_sequence WHERE name = ?', table);
  return row ? Number(row.seq) : null;
}

export class RowCapture {
  private readonly schema: Schema;

  private readonly rows = new Map<string, Map<Key, JournalRow>>();

  private readonly watched = new Map<string, { maxKey: number; seq: number | null }>();

  constructor(private readonly db: DatabaseAdapter) {
    this.schema = readSchema(db);
  }

  private table(name: string): TableSchema {
    const table = this.schema.get(name);
    if (!table) throw new Error(`Unknown table: ${name}`);
    return table;
  }

  /** Captures rows matching `where` (a trusted SQL fragment) and everything they cascade to. */
  addWhere(tableName: string, where: string, ...params: unknown[]): this {
    const table = this.table(tableName);
    const found = allRows<Record<string, unknown>>(
      this.db,
      `SELECT ${table.columns.map(quote).join(', ')} FROM ${quote(table.name)} WHERE ${where}`,
      ...params
    );
    this.addRows(table, found, true);
    return this;
  }

  /** Captures rows by primary key and everything they cascade to. */
  addKeys(tableName: string, keys: Key[], cascade = true): this {
    const table = this.table(tableName);
    if (!keys.length) return this;
    this.addEncoded(table, readByKeys(this.db, table, keys), cascade);
    return this;
  }

  /** Records rows inserted into `tableName` from now on (by AUTOINCREMENT key). */
  watchInserts(tableName: string): this {
    const table = this.table(tableName);
    const row = getRow<{ maxKey: number | null }>(
      this.db,
      `SELECT MAX(${quote(table.pk)}) AS maxKey FROM ${quote(table.name)}`
    );
    this.watched.set(table.name, {
      maxKey: Number(row?.maxKey ?? 0),
      seq: sequenceOf(this.db, table.name),
    });
    return this;
  }

  private addRows(table: TableSchema, rows: Record<string, unknown>[], cascade: boolean): void {
    this.addEncoded(
      table,
      rows.map((row) => encodeRow(table, row)),
      cascade
    );
  }

  private addEncoded(table: TableSchema, rows: JournalRow[], cascade: boolean): void {
    let bucket = this.rows.get(table.name);
    if (!bucket) {
      bucket = new Map();
      this.rows.set(table.name, bucket);
    }
    const added: Key[] = [];
    for (const row of rows) {
      const key = row[table.pk] as Key;
      if (bucket.has(key)) continue;
      bucket.set(key, row);
      added.push(key);
    }
    if (!cascade || !added.length) return;
    for (const fk of table.children) {
      const child = this.table(fk.child);
      const parentValues =
        fk.parentColumn === table.pk
          ? added
          : added.map((key) => bucket.get(key)![fk.parentColumn] as Key);
      for (const part of chunks(parentValues)) {
        const marks = part.map(() => '?').join(', ');
        const found = allRows<Record<string, unknown>>(
          this.db,
          `SELECT ${child.columns.map(quote).join(', ')} FROM ${quote(child.name)}
           WHERE ${quote(fk.column)} IN (${marks})`,
          ...part
        );
        // CASCADE children disappear with the parent (and cascade further);
        // SET NULL / other children only change their own column.
        this.addRows(child, found, fk.onDelete === 'CASCADE');
      }
    }
  }

  /** Compares the captured rows with the database now. */
  finish(): RowJournal {
    const journal: RowJournal = { v: 1, deleted: [], changed: [], inserted: [] };
    const deletedByTable = new Map<string, JournalRow[]>();
    for (const [name, bucket] of this.rows) {
      const table = this.table(name);
      const now = new Map<Key, JournalRow>();
      for (const row of readByKeys(this.db, table, [...bucket.keys()]))
        now.set(row[table.pk] as Key, row);
      const groups = new Map<string, { values: JournalRow; ids: Key[] }>();
      for (const [key, before] of bucket) {
        const after = now.get(key);
        if (!after) {
          const list = deletedByTable.get(name) ?? [];
          list.push(before);
          deletedByTable.set(name, list);
          continue;
        }
        const values: JournalRow = {};
        for (const column of table.columns) {
          if (!sameValue(before[column], after[column])) values[column] = before[column];
        }
        if (!Object.keys(values).length) continue;
        const groupKey = JSON.stringify(values);
        const group = groups.get(groupKey) ?? { values, ids: [] };
        group.ids.push(key);
        groups.set(groupKey, group);
      }
      for (const group of groups.values()) journal.changed.push({ table: name, ...group });
    }
    for (const name of insertOrder(this.schema, [...deletedByTable.keys()])) {
      journal.deleted.push({ table: name, rows: deletedByTable.get(name)! });
    }
    for (const [name, watch] of this.watched) {
      const table = this.table(name);
      const ids = allRows<{ key: Key }>(
        this.db,
        `SELECT ${quote(table.pk)} AS key FROM ${quote(table.name)} WHERE ${quote(table.pk)} > ?
         ORDER BY 1`,
        watch.maxKey
      ).map((row) => row.key);
      if (!ids.length) continue;
      const after = sequenceOf(this.db, name);
      journal.inserted.push({
        table: name,
        ids,
        ...(after !== null ? { seq: { before: watch.seq, after } } : {}),
      });
    }
    return journal;
  }
}

/** Row count a journal re-inserts (deleted rows). */
export function journalSize(journal: RowJournal): number {
  return journal.deleted.reduce((sum, entry) => sum + entry.rows.length, 0);
}

export function isRowJournal(value: unknown): value is RowJournal {
  const journal = value as RowJournal | null;
  return (
    !!journal &&
    journal.v === 1 &&
    Array.isArray(journal.deleted) &&
    Array.isArray(journal.changed) &&
    Array.isArray(journal.inserted)
  );
}

/**
 * Puts back what a journal recorded. Must run inside a transaction: any
 * failure (a re-inserted ID already taken, an unknown table) throws and the
 * caller's transaction rolls everything back. `allowedTables` limits which
 * tables a journal (which may arrive from another device) can write to.
 */
export function restoreRowJournal(
  db: DatabaseAdapter,
  journal: RowJournal,
  allowedTables: ReadonlySet<string>
): void {
  if (!isRowJournal(journal)) throw new Error('Invalid undo data');
  const schema = readSchema(db);
  const tableFor = (name: string) => {
    const table = schema.get(name);
    if (!table || !allowedTables.has(name)) throw new Error(`Undo cannot write to ${name}`);
    return table;
  };
  const checkColumns = (table: TableSchema, row: JournalRow) => {
    for (const column of Object.keys(row)) {
      if (!table.columns.includes(column))
        throw new Error(`Unknown column ${table.name}.${column}`);
    }
  };

  // 1. Deleted rows come back first, parents before children, under their IDs.
  const deletedTables = journal.deleted.map((entry) => entry.table);
  const byTable = new Map(journal.deleted.map((entry) => [entry.table, entry.rows]));
  for (const name of insertOrder(schema, deletedTables)) {
    const table = tableFor(name);
    for (const row of byTable.get(name) ?? []) {
      checkColumns(table, row);
      const columns = Object.keys(row);
      run(
        db,
        `INSERT INTO ${quote(table.name)} (${columns.map(quote).join(', ')})
         VALUES (${columns.map(() => '?').join(', ')})`,
        ...columns.map((column) => decodeValue(row[column]))
      );
    }
  }

  // 2. Updated rows get their previous values back.
  for (const entry of journal.changed) {
    const table = tableFor(entry.table);
    checkColumns(table, entry.values);
    const columns = Object.keys(entry.values);
    if (!columns.length) continue;
    const assignments = columns.map((column) => `${quote(column)} = ?`).join(', ');
    const values = columns.map((column) => decodeValue(entry.values[column]));
    for (const part of chunks(entry.ids)) {
      run(
        db,
        `UPDATE ${quote(table.name)} SET ${assignments}
         WHERE ${quote(table.pk)} IN (${part.map(() => '?').join(', ')})`,
        ...values,
        ...part
      );
    }
  }

  // 3. Rows the change created go again, unless something now refers to them.
  for (const entry of [...journal.inserted].reverse()) {
    const table = tableFor(entry.table);
    const removable = entry.ids.filter(
      (id) =>
        !table.children.some((fk) =>
          getRow(
            db,
            `SELECT 1 AS used FROM ${quote(fk.child)} WHERE ${quote(fk.column)} = ? LIMIT 1`,
            id
          )
        )
    );
    for (const part of chunks(removable)) {
      run(
        db,
        `DELETE FROM ${quote(table.name)} WHERE ${quote(table.pk)} IN (${part
          .map(() => '?')
          .join(', ')})`,
        ...part
      );
    }
    // Put the AUTOINCREMENT counter back when nothing else has used it since.
    if (entry.seq && removable.length === entry.ids.length) {
      const now = sequenceOf(db, table.name);
      if (now === entry.seq.after) {
        if (entry.seq.before === null) {
          run(db, 'DELETE FROM sqlite_sequence WHERE name = ?', table.name);
        } else {
          run(
            db,
            'UPDATE sqlite_sequence SET seq = ? WHERE name = ?',
            entry.seq.before,
            table.name
          );
        }
      }
    }
  }
}
