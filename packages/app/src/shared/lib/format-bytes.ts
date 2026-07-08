/**
 * Format a byte count as a human-readable string ("5 B", "5.2 KB", "12 MB").
 *
 * Values >= 10 render without decimals; smaller values keep one decimal with
 * any trailing ".0" trimmed. Units cap at TB.
 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  const rendered = value >= 10 ? String(Math.round(value)) : String(Number(value.toFixed(1)));
  return `${rendered} ${units[index]}`;
}
