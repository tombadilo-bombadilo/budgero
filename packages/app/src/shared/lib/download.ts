/**
 * Trigger a browser download of in-memory data.
 *
 * Centralizes the create-blob → object-URL → anchor-click → revoke dance that
 * was previously hand-rolled at every export site.
 */
export function downloadBlob(data: BlobPart, filename: string, mimeType: string): void {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
