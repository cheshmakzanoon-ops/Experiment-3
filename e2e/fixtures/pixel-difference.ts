/** Compare RGBA8 readbacks without hiding isolated large errors in an average.
 * Alpha is not compared: coverage is the fixture's visible RGB-on-black mask.
 * No resizing, registration, filtering or tolerance is applied here. */
export function pixelDifference(a: Uint8Array, b: Uint8Array) {
  if (!a.length || a.length !== b.length || a.length % 4 !== 0)
    throw new Error('Expected equally sized, non-empty RGBA8 readbacks');
  let maxChannelDelta = 0,
    changedPixels = 0,
    coverageDifferences = 0;
  for (let i = 0; i < a.length; i += 4) {
    let changed = false;
    for (let c = 0; c < 3; c++) {
      const delta = Math.abs(a[i + c] - b[i + c]);
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      changed ||= delta !== 0;
    }
    if (changed) changedPixels++;
    const visibleA = a[i] + a[i + 1] + a[i + 2] > 3;
    const visibleB = b[i] + b[i + 1] + b[i + 2] > 3;
    if (visibleA !== visibleB) coverageDifferences++;
  }
  return { maxChannelDelta, changedPixels, coverageDifferences };
}
