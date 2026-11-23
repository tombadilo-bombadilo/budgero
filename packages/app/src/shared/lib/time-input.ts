/**
 * Reads a typed time of day as 'HH:MM' (24-hour). Accepts "9", "930", "0930",
 * "9:30", "9.30", "9 30" and an am/pm suffix ("9pm", "9:30 am"). Returns ''
 * for an empty entry and null when it is not a time.
 */
export function parseTimeInput(text: string): string | null {
  const raw = text.trim().toLowerCase();
  if (raw === '') return '';
  const match = /^(\d{1,2})(?:[:.\s]?(\d{2}))?\s*(am?|pm?)?$/.exec(raw);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[3]?.[0];
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === 'p' ? 12 : 0);
  }
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
