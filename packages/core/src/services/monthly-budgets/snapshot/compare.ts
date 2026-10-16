/**
 * Deep comparison for the snapshot verify mode and tests: path of the first
 * difference, or null. Arrays and Maps compare in order (order is part of the
 * result: rows, funding breakdowns, overspend details); plain objects by key
 * set, ignoring keys whose value is undefined on both sides.
 */
export function firstDifference(expected: unknown, actual: unknown, path = ''): string | null {
  if (expected === actual) return null;
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (Number.isNaN(expected) && Number.isNaN(actual)) return null;
    return `${path || '/'}: expected ${expected}, got ${actual}`;
  }
  if (
    expected === null ||
    actual === null ||
    typeof expected !== 'object' ||
    typeof actual !== 'object'
  ) {
    return `${path || '/'}: expected ${show(expected)}, got ${show(actual)}`;
  }
  if (expected instanceof Map || actual instanceof Map) {
    if (!(expected instanceof Map) || !(actual instanceof Map))
      return `${path || '/'}: Map vs non-Map`;
    if (expected.size !== actual.size)
      return `${path || '/'}: Map size expected ${expected.size}, got ${actual.size}`;
    const a = [...expected];
    const b = [...actual];
    for (let i = 0; i < a.length; i++) {
      const keyDiff = firstDifference(a[i][0], b[i][0], `${path}/<key ${i}>`);
      if (keyDiff) return keyDiff;
      const d = firstDifference(a[i][1], b[i][1], `${path}/${String(a[i][0])}`);
      if (d) return d;
    }
    return null;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual))
      return `${path || '/'}: array vs non-array`;
    if (expected.length !== actual.length)
      return `${path || '/'}: length expected ${expected.length}, got ${actual.length}`;
    for (let i = 0; i < expected.length; i++) {
      const d = firstDifference(expected[i], actual[i], `${path}/${i}`);
      if (d) return d;
    }
    return null;
  }
  const e = expected as Record<string, unknown>;
  const a = actual as Record<string, unknown>;
  const keys = new Set([...Object.keys(e), ...Object.keys(a)]);
  for (const k of keys) {
    const d = firstDifference(e[k], a[k], `${path}/${k}`);
    if (d) return d;
  }
  return null;
}

function show(v: unknown): string {
  try {
    return JSON.stringify(v)?.slice(0, 200) ?? String(v);
  } catch {
    return String(v);
  }
}
