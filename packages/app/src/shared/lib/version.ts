/**
 * Compare release version strings (e.g. "1.6.0", "v1.6.1", "1.6.1+abc123").
 * Missing or non-numeric segments compare as 0, so malformed input can never
 * spuriously trigger the update prompt.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseSegments(candidate);
  const b = parseSegments(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function parseSegments(version: string): [number, number, number] {
  const cleaned = version.trim().replace(/^v/, '').split('+')[0].split('-')[0];
  const parts = cleaned.split('.');
  const nums: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const n = Number.parseInt(parts[i] ?? '', 10);
    nums[i] = Number.isFinite(n) ? n : 0;
  }
  return nums;
}
