import type { BankFeedSettings, BankLink, BankTransaction } from './types.js';

export const DEFAULT_BANK_FEED_SETTINGS: BankFeedSettings = {
  importPending: false,
  date: 'auto',
  payee: 'auto',
  memo: 'auto',
  tidyPayees: true,
};

export function parseBankFeedSettings(
  link: Pick<BankLink, 'SettingsJSON'> | null | undefined
): BankFeedSettings {
  try {
    const raw = JSON.parse(link?.SettingsJSON || '{}') as Partial<BankFeedSettings>;
    return { ...DEFAULT_BANK_FEED_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_BANK_FEED_SETTINGS };
  }
}

/**
 * Capitalizes the first letter and any letter after a hyphen, slash or dot
 * ("7-ELEVEN" → "7-Eleven"). Not after apostrophes: "MCDONALD'S" → "Mcdonald's".
 */
function titleCaseWord(word: string): string {
  return word
    .toLocaleLowerCase()
    .replace(
      /(^|[-/.])(\p{L})/gu,
      (_, sep: string, letter: string) => sep + letter.toLocaleUpperCase()
    );
}

/**
 * Title-cases payee names that arrive in ALL CAPS ("K-MARKET KAMPPI" →
 * "K-Market Kamppi"). Names with any lowercase letter are already cased by
 * the bank and stay as they are, so "McDonald's" is never mangled.
 */
export function tidyPayeeName(name: string): string {
  if (!/\p{Lu}/u.test(name) || /\p{Ll}/u.test(name)) return name;
  return name
    .split(/(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? part : titleCaseWord(part)))
    .join('');
}

const pick = (value: string | undefined, fallback: string) =>
  value?.trim() ? value.trim() : fallback;

/**
 * Applies a linked account's field choices: which bank field becomes the
 * date, payee and memo. A chosen field the bank didn't send falls back to the
 * provider's default, so a row is never left without a date or payee.
 */
export function applyBankFeedSettings(
  transaction: BankTransaction,
  settings: BankFeedSettings
): BankTransaction {
  const fields = transaction.fields ?? {};
  const chosen =
    settings.date === 'booking'
      ? { date: fields.bookingDate, time: fields.bookingTime }
      : settings.date === 'transaction'
        ? { date: fields.transactionDate, time: fields.transactionTime }
        : settings.date === 'value'
          ? { date: fields.valueDate, time: fields.valueTime }
          : null;
  const date = chosen ? pick(chosen.date, transaction.date) : transaction.date;
  // The time goes with the date it came from.
  const time = chosen?.date?.trim() ? chosen.time : transaction.time;
  let { payee } = transaction;
  if (settings.payee === 'counterparty') payee = pick(fields.counterparty, payee);
  if (settings.payee === 'description') payee = pick(fields.description, payee);
  let { memo } = transaction;
  if (settings.memo === 'description') memo = fields.description?.trim() ?? '';
  if (settings.memo === 'counterparty') memo = fields.counterparty?.trim() ?? '';
  if (settings.memo === 'none') memo = '';
  if (settings.tidyPayees) payee = tidyPayeeName(payee);
  const { time: _time, ...rest } = transaction;
  return { ...rest, date, ...(time ? { time } : {}), payee, memo: memo === payee ? '' : memo };
}
