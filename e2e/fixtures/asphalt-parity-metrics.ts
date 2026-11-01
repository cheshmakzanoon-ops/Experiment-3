/** Geometry tolerance is chosen independently of candidate colour errors.
 * The reference alone selects a two-pixel-eroded interior. A missing candidate
 * patch is a failure, never an excuse to exclude its disagreeing samples. */
export function compareAsphaltPixels(actual: Uint8Array, expected: Uint8Array, size: number) {
  if (actual.length !== size * size * 4 || expected.length !== actual.length || size < 5)
    throw new Error('Asphalt comparison requires equal square RGBA8 images');
  let comparedPixels = 0,
    changedPixels = 0,
    maxChannelError = 0,
    sum = 0,
    missingInteriorPixels = 0,
    excessCoveragePixels = 0,
    alphaMismatchPixels = 0,
    min = 255,
    max = 0,
    maxNormalAngleDegrees = 0;
  const covered = (pixels: Uint8Array, x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && pixels[(y * size + x) * 4 + 3] === 255;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (actual[i + 3] !== expected[i + 3]) alphaMismatchPixels++;
      let interior = true,
        nearbyReference = false;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const hasReference = covered(expected, x + dx, y + dy);
          interior &&= hasReference;
          nearbyReference ||= hasReference;
        }
      if (covered(actual, x, y) && !nearbyReference) excessCoveragePixels++;
      if (!interior) continue;
      comparedPixels++;
      if (!covered(actual, x, y)) missingInteriorPixels++;
      let changed = false,
        dot = 0,
        aa = 0,
        bb = 0;
      for (let c = 0; c < 3; c++) {
        min = Math.min(min, expected[i + c]);
        max = Math.max(max, expected[i + c]);
        const error = Math.abs(actual[i + c] - expected[i + c]);
        maxChannelError = Math.max(maxChannelError, error);
        sum += error;
        changed ||= error !== 0;
        const a = actual[i + c] * (2 / 255) - 1,
          b = expected[i + c] * (2 / 255) - 1;
        dot += a * b;
        aa += a * a;
        bb += b * b;
      }
      if (changed) changedPixels++;
      maxNormalAngleDegrees = Math.max(
        maxNormalAngleDegrees,
        (Math.acos(Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb)))) * 180) / Math.PI,
      );
    }
  return {
    comparedPixels,
    changedPixels,
    maxChannelError,
    meanChannelError: comparedPixels ? sum / (comparedPixels * 3) : Infinity,
    missingInteriorPixels,
    excessCoveragePixels,
    alphaMismatchPixels,
    referenceMin: min,
    referenceMax: max,
    // This diagnostic has physical meaning only for the encoded normal output.
    maxNormalAngleDegrees,
  };
}
