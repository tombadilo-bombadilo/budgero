/**
 * Row tops for a list of rows with their own heights: offsets[i] is where
 * row i starts, offsets[count] the total height.
 */
export function buildRowOffsets(count: number, heightOf: (index: number) => number): Float64Array {
  const offsets = new Float64Array(count + 1);
  for (let index = 0; index < count; index++) {
    offsets[index + 1] = offsets[index] + heightOf(index);
  }
  return offsets;
}

/** Index of the row at `position` (binary search); clamps to the first and last row. */
export function findRowAt(offsets: ArrayLike<number>, position: number): number {
  const count = offsets.length - 1;
  if (count <= 0) return 0;
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (offsets[middle] <= position) low = middle;
    else high = middle - 1;
  }
  return low;
}
