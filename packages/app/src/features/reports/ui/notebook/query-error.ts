import { t } from '@lingui/core/macro';

/**
 * What went wrong, in words for people: DuckDB's own messages ("Binder
 * Error: Referenced column …") stay available as details, not as the message.
 */
export function friendlyQueryError(raw: string): string {
  const text = raw.toLowerCase();
  if (/out of memory|memory limit/.test(text)) {
    return t`The question needs more memory than the browser allows. Try a shorter date range, fewer groupings or a limit.`;
  }
  if (/interrupt|cancel|abort/.test(text)) {
    return t`The question was stopped before it finished. Run it again.`;
  }
  if (/database (is )?not available|database unavailable/.test(text)) {
    return t`Your budget data isn’t ready yet. Wait a moment and refresh.`;
  }
  if (/read-only|not read-only/.test(text)) {
    return t`Only questions that read data can run here.`;
  }
  if (/division by zero|out of range|overflow|conversion error|could not convert/.test(text)) {
    return t`A value could not be calculated (for example a division by zero or a number that is too large). Check custom columns and metrics.`;
  }
  if (
    /binder error|catalog error|referenced column|does not exist|not found in from clause|no function matches/.test(
      text
    )
  ) {
    return t`The question refers to a column or table that isn’t available. It may have been made with another version of the app, or a custom column needs fixing.`;
  }
  if (/parser error|syntax error/.test(text)) {
    return t`The question’s SQL could not be read. Check custom expressions or the SQL.`;
  }
  return t`Something went wrong while running the question.`;
}
