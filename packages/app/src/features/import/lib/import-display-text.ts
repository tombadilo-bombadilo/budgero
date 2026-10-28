import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';

// Core import results remain locale-independent. Translate only when displaying them.
const messages: Record<string, MessageDescriptor> = {
  'Invalid or manually skipped row': msg`Invalid or manually skipped row`,
  'This file row was already imported': msg`This file row was already imported`,
  'Bank transaction ID was already imported': msg`Bank transaction ID was already imported`,
  'Repeated bank transaction ID; verify the details': msg`Repeated bank transaction ID; verify the details`,
  'Same date and amount in this account': msg`Same date and amount in this account`,
  'Similar amount and date in this account': msg`Similar amount and date in this account`,
  'Similar row in this file; both may be real transactions': msg`Similar row in this file; both may be real transactions`,
  'No amount column mapped': msg`No amount column mapped`,
  'No amount value — row will be skipped': msg`No amount value — row will be skipped`,
  'No date found — using today': msg`No date found — using today`,
};

export function translateImportText(text: string): string {
  if (messages[text]) return i18n._(messages[text]);
  const amount = /^Could not parse (amount|inflow|outflow) "(.*)"$/s.exec(text);
  if (amount) {
    const value = amount[2];
    if (amount[1] === 'inflow') return t`Could not parse inflow "${value}"`;
    if (amount[1] === 'outflow') return t`Could not parse outflow "${value}"`;
    return t`Could not parse amount "${value}"`;
  }
  const date = /^Unreadable date "(.*)" for format (.*) — using today$/s.exec(text);
  if (date) {
    const value = date[1];
    const format = date[2];
    return t`Unreadable date "${value}" for format ${format} — using today`;
  }
  return text;
}
