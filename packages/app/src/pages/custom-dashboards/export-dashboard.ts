/**
 * "Export CSVs" for a dashboard: every widget's CSV in one zip, because
 * browsers block a burst of separate downloads.
 */
import { safeFileName } from '@features/reports/ui/notebook/viz/export';

export interface WidgetCsv {
  /** The widget's title; becomes the file name. */
  title: string;
  csv: string;
}

const BOM = String.fromCharCode(0xfeff);

/**
 * One `.csv` file name per title, in order. Titles that clash (ignoring case,
 * as Windows and macOS do) get " (2)", " (3)", …
 */
export function csvFileNames(titles: string[]): string[] {
  const taken = new Set<string>();
  return titles.map((title) => {
    const base = safeFileName(title, 'widget');
    let name = `${base}.csv`;
    for (let copy = 2; taken.has(name.toLowerCase()); copy += 1) {
      name = `${base} (${copy}).csv`;
    }
    taken.add(name.toLowerCase());
    return name;
  });
}

/** A zip holding one CSV per widget (UTF-8 with BOM, so Excel reads names right). */
export async function buildCsvZip(files: WidgetCsv[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const names = csvFileNames(files.map((file) => file.title));
  files.forEach((file, index) => zip.file(names[index], `${BOM}${file.csv}`));
  return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export function zipFileName(dashboardName: string): string {
  return `${safeFileName(dashboardName, 'dashboard')}.zip`;
}
