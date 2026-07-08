export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.trim().replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) {
    return `rgba(148, 163, 184, ${alpha})`;
  }
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
