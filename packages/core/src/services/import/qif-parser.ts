/**
 * QIF parser.
 *
 * QIF is a line-oriented Quicken-era format with several dialects. We
 * support cash-flow sections (`!Type:Bank`, `!Type:CCard`, `!Type:Cash`,
 * `!Type:Oth A`, `!Type:Oth L`). Investment (`!Type:Invst`) and metadata
 * sections (`!Type:Cat`, `!Type:Class`, `!Type:Security`, account
 * autoswitch) are intentionally skipped — the wizard imports transactions,
 * not portfolio holdings or category trees.
 *
 * Each transaction is a sequence of single-letter-prefixed lines, ending
 * with a `^` separator on its own line. Split lines (S/E/$) attach to the
 * most recent S; if any splits exist we emit one row per split, otherwise
 * one row for the parent. The total amount on the parent (T) is preserved
 * for split-free transactions but ignored when splits are present (so
 * inflow/outflow stays in sync with the user's category mapping).
 */
export interface ParsedQifTransaction {
  date: string;
  amount: string;
  payee?: string;
  memo?: string;
  category?: string;
  /**
   * If the L line was wrapped in `[brackets]` it's an account transfer in
   * QIF. We surface the bare account name and a flag so the importer can
   * decide whether to keep, drop, or transform it.
   */
  transferAccount?: string;
  checkNum?: string;
  cleared?: string;
}

export type QifSectionKind = 'bank' | 'ccard' | 'cash' | 'asset' | 'liability';

export interface ParsedQifSection {
  kind: QifSectionKind;
  transactions: ParsedQifTransaction[];
}

export interface ParsedQif {
  sections: ParsedQifSection[];
}

const SUPPORTED_SECTIONS: Record<string, QifSectionKind> = {
  bank: 'bank',
  ccard: 'ccard',
  cash: 'cash',
  'oth a': 'asset',
  'oth l': 'liability',
};

interface RawSplit {
  category?: string;
  transferAccount?: string;
  memo?: string;
  amount?: string;
}

export function parseQif(text: string): ParsedQif {
  const sections: ParsedQifSection[] = [];
  const lines = stripQifBom(text).split(/\r?\n/);

  // currentKind === null means "we're in a section we don't extract from"
  // (e.g. !Account, !Type:Cat, !Type:Invst, !Option:AutoSwitch). The loop
  // skips data lines while currentKind is null; the `^` separator inside
  // those sections still fires flushTransactions(), which clears the buffer.
  let currentKind: QifSectionKind | null = null;
  let currentTransactions: ParsedQifTransaction[] = [];
  let buffer: string[] = [];

  const flushSection = () => {
    if (currentKind && currentTransactions.length > 0) {
      sections.push({ kind: currentKind, transactions: currentTransactions });
    }
    currentTransactions = [];
  };

  const flushTransactions = () => {
    if (!currentKind) {
      buffer = [];
      return;
    }
    if (buffer.length > 0) {
      const transactions = buildTransactions(buffer);
      currentTransactions.push(...transactions);
    }
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    if (line.startsWith('!')) {
      // Section header. Flush any pending transaction first, then decide
      // whether the new section is one we extract from.
      flushTransactions();
      flushSection();

      const header = line.slice(1).trim();
      const match = header.match(/^[Tt]ype\s*:\s*(.+)$/);
      const kind = match ? SUPPORTED_SECTIONS[match[1].trim().toLowerCase()] : undefined;
      currentKind = kind ?? null;
      continue;
    }

    if (line === '^') {
      flushTransactions();
      continue;
    }

    if (!currentKind) continue;
    buffer.push(line);
  }

  // Trailing transaction without a closing `^` — Quicken sometimes omits it.
  flushTransactions();
  flushSection();

  return { sections };
}

function buildTransactions(lines: string[]): ParsedQifTransaction[] {
  const parent: Partial<ParsedQifTransaction> & { _amountRaw?: string } = {};
  const splits: RawSplit[] = [];
  let currentSplit: RawSplit | null = null;

  for (const line of lines) {
    if (line.length === 0) continue;
    const code = line[0];
    const value = line.slice(1).trim();

    switch (code) {
      case 'D':
        parent.date = parseQifDate(value);
        break;
      case 'T':
      case 'U':
        // T is the canonical amount; U is an alternate some banks emit.
        // Whichever appears last wins, but they're typically identical.
        parent._amountRaw = stripQifAmount(value);
        break;
      case 'P':
        parent.payee = value;
        break;
      case 'M':
        parent.memo = value;
        break;
      case 'L': {
        const transfer = value.match(/^\[(.+)\]$/);
        if (transfer) {
          parent.transferAccount = transfer[1].trim();
        } else {
          // Strip any "/Class" suffix for cleanliness — class assignment
          // isn't surfaced in our import flow.
          parent.category = value.split('/')[0].trim();
        }
        break;
      }
      case 'N':
        parent.checkNum = value;
        break;
      case 'C':
        parent.cleared = value;
        break;
      case 'S': {
        const transfer = value.match(/^\[(.+)\]$/);
        currentSplit = transfer
          ? { transferAccount: transfer[1].trim() }
          : { category: value ? value.split('/')[0].trim() : undefined };
        splits.push(currentSplit);
        break;
      }
      case 'E':
        if (currentSplit) currentSplit.memo = value;
        break;
      case '$':
        if (currentSplit) currentSplit.amount = stripQifAmount(value);
        break;
      // Unhandled codes (A address lines, F flag, Y security, etc.) are
      // silently ignored — they don't affect transaction totals.
      default:
        break;
    }
  }

  if (!parent.date) return [];

  if (splits.length === 0) {
    if (parent._amountRaw === undefined) return [];
    return [
      {
        date: parent.date,
        amount: parent._amountRaw,
        payee: parent.payee,
        memo: parent.memo,
        category: parent.category,
        transferAccount: parent.transferAccount,
        checkNum: parent.checkNum,
        cleared: parent.cleared,
      },
    ];
  }

  // `--Split--` is a Quicken sentinel that means "see splits below" — the
  // real category lives on each split, not the parent. Don't propagate it.
  const parentCategory =
    parent.category && parent.category.toLowerCase() !== '--split--' ? parent.category : undefined;

  // One row per split. Splits without an explicit $ are dropped — they'd
  // otherwise import as zero-amount rows. We loop instead of filter+map
  // so the type narrowing on `s.amount` survives without non-null
  // assertions.
  const parentDate = parent.date;
  const out: ParsedQifTransaction[] = [];
  for (const s of splits) {
    if (s.amount === undefined) continue;
    out.push({
      date: parentDate,
      amount: s.amount,
      payee: parent.payee,
      memo: s.memo ?? parent.memo,
      category: s.category ?? parentCategory,
      transferAccount: s.transferAccount ?? parent.transferAccount,
      checkNum: parent.checkNum,
      cleared: parent.cleared,
    });
  }
  return out;
}

function stripQifAmount(value: string): string {
  // Strip thousands separators (Quicken happily writes them) and trim.
  return value.replace(/,/g, '').trim();
}

function stripQifBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * QIF dates Quicken writes are notoriously inconsistent. The forms we
 * handle:
 *   - `M/D/YY`, `M/D/YYYY`         (US default)
 *   - `M/D'YY`, `M/D'YYYY`         (Quicken Y2K-era apostrophe form)
 *   - `D/M/YY`, `D/M/YYYY`         (UK default — heuristic)
 *   - `YYYY-M-D`                    (rare; ISO)
 *   - `D.M.YYYY`                    (European)
 *
 * We assume US (M/D) order when ambiguous, matching ofxparse / quiffen
 * defaults. The user can re-pick the date format in the configure step
 * if their bank used the other order.
 */
export function parseQifDate(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';

  // ISO-ish: YYYY-MM-DD or YYYY/MM/DD
  const iso = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) {
    return formatDate(+iso[1], +iso[2], +iso[3]);
  }

  // M/D/YY, M/D/YYYY, M/D'YY, M-D-YY, M.D.YYYY. Quicken sometimes injects
  // a stray space after the slash (`1/ 1'00`), so we accept multi-char
  // separator runs.
  const md = trimmed.match(/^(\d{1,2})[\s/.\-']+(\d{1,2})[\s/.\-']+(\d{2,4})$/);
  if (md) {
    const [, m, d, y] = md as unknown as [string, string, string, string];
    let year = parseInt(y, 10);
    if (y.length === 2) {
      year += year < 70 ? 2000 : 1900;
    }
    return formatDate(year, +m, +d);
  }

  return trimmed;
}

function formatDate(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Cheap content sniff for the upload step. */
export function looksLikeQif(text: string): boolean {
  return /^\s*!Type\s*:/im.test(text) || /^\s*!Account\b/im.test(text);
}

export const QIF_HEADERS = [
  'Date',
  'Amount',
  'Payee',
  'Memo',
  'Category',
  'CheckNum',
  'Cleared',
  'TransferAccount',
] as const;

export interface QifImportRows {
  headers: readonly string[];
  rows: Record<string, string>[];
}

export function qifToImportRows(parsed: ParsedQif): QifImportRows {
  const rows: Record<string, string>[] = [];
  for (const section of parsed.sections) {
    for (const t of section.transactions) {
      rows.push({
        Date: t.date,
        Amount: t.amount,
        Payee: t.payee ?? '',
        Memo: t.memo ?? '',
        Category: t.category ?? '',
        CheckNum: t.checkNum ?? '',
        Cleared: t.cleared ?? '',
        TransferAccount: t.transferAccount ?? '',
      });
    }
  }
  return { headers: QIF_HEADERS, rows };
}
