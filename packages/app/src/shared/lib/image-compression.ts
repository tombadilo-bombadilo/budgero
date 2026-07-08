/**
 * Compress an image file to a JPEG Uint8Array suitable for storing as a BLOB.
 * Uses the Canvas API — no external dependencies.
 */
export async function compressReceiptImage(
  file: File,
  maxDim = 1024,
  quality = 0.7
): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);

  let { width } = bitmap;
  let { height } = bitmap;

  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Convert a receipt BLOB (Uint8Array) to an object URL for display.
 * Caller is responsible for revoking the URL when no longer needed.
 */
export function receiptBlobToUrl(data: Uint8Array): string {
  const blob = new Blob([data], { type: 'image/jpeg' });
  return URL.createObjectURL(blob);
}
