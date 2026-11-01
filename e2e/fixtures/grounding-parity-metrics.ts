import { GROUNDING_LIMITS } from './grounding-reference.ts';

/** Only original receiver IDs choose sample support. Candidate holes, wrong
 * receiver assignments or missing required denominators never reduce support. */
export function groundingReferenceMask(ids: Uint8Array, size: number) {
  if (size < 5 || ids.length !== size * size * 4)
    throw new Error('Grounding mask requires a square RGBA8 reference');
  const receiver = new Uint8Array(size * size),
    indices: number[] = [];
  const counts = { road: 0, paint: 0 };
  const at = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return 0;
    const i = (y * size + x) * 4;
    if (ids[i + 3] !== 255) return 0;
    if (ids[i] === 255 && ids[i + 1] === 0 && ids[i + 2] === 0) return 1;
    if (ids[i] === 0 && ids[i + 1] === 255 && ids[i + 2] === 0) return 2;
    throw new Error('Unknown original grounding receiver ID');
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const role = at(x, y);
      if (!role) continue;
      let interior = true;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) interior &&= at(x + dx, y + dy) === role;
      if (!interior) continue;
      const pixel = y * size + x;
      receiver[pixel] = role;
      indices.push(pixel * 4);
      counts[role === 1 ? 'road' : 'paint']++;
    }
  return { size, receiver, indices, counts };
}
export type GroundingMask = ReturnType<typeof groundingReferenceMask>;
function dimensions(pixels: Uint8Array, mask: GroundingMask) {
  if (pixels.length !== mask.size * mask.size * 4)
    throw new Error('Grounding observation dimensions changed');
}

export function compareGroundingChannels(
  actual: Uint8Array,
  expected: Uint8Array,
  mask: GroundingMask,
  channels: readonly (readonly [number, number])[] = [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  requireOpaque = true,
) {
  dimensions(actual, mask);
  dimensions(expected, mask);
  if (
    !channels.length ||
    channels.some((pair) => pair.some((c) => !Number.isInteger(c) || c < 0 || c > 3))
  )
    throw new Error('Invalid grounding comparison channels');
  const empty = () => ({
    comparedPixels: 0,
    changedPixels: 0,
    maxChannelError: 0,
    meanChannelError: 0,
    missingPixels: 0,
  });
  const result = { road: empty(), paint: empty() };
  for (const i of mask.indices) {
    const row = result[mask.receiver[i / 4] === 1 ? 'road' : 'paint'];
    row.comparedPixels++;
    // The native 16-bit observation uses all four bytes as data. Coverage for
    // that output is proved independently by the receiver/presence captures.
    if (requireOpaque && actual[i + 3] !== 255) row.missingPixels++;
    let changed = false;
    for (const [a, b] of channels) {
      const error = Math.abs(actual[i + a] - expected[i + b]);
      row.maxChannelError = Math.max(row.maxChannelError, error);
      row.meanChannelError += error;
      changed ||= error !== 0;
    }
    if (changed) row.changedPixels++;
  }
  for (const row of Object.values(result))
    row.meanChannelError = row.comparedPixels
      ? row.meanChannelError / (row.comparedPixels * channels.length)
      : Infinity;
  return result;
}

export function compareGroundingCoverage(
  actual: Uint8Array,
  original: Uint8Array,
  mask: GroundingMask,
) {
  dimensions(actual, mask);
  dimensions(original, mask);
  let missingInterior = 0,
    wrongReceiver = 0,
    excessCoverage = 0;
  for (const i of mask.indices) {
    if (actual[i + 3] !== 255) missingInterior++;
    else if (
      actual[i] !== original[i] ||
      actual[i + 1] !== original[i + 1] ||
      actual[i + 2] !== original[i + 2]
    )
      wrongReceiver++;
  }
  for (let y = 0; y < mask.size; y++)
    for (let x = 0; x < mask.size; x++) {
      if (!actual[(y * mask.size + x) * 4 + 3]) continue;
      let nearOriginal = false;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const px = x + dx,
            py = y + dy;
          if (
            px >= 0 &&
            py >= 0 &&
            px < mask.size &&
            py < mask.size &&
            original[(py * mask.size + px) * 4 + 3]
          )
            nearOriginal = true;
        }
      if (!nearOriginal) excessCoverage++;
    }
  return { missingInterior, wrongReceiver, excessCoverage };
}

/** Presence bits come from the *unquantized native* before/after values. An
 * inactive term is exactly zero on both sides; an active term must stay active.
 * No epsilon division, nonpositive-denominator masking or candidate-selected ROI. */
export function groundingPresence(pixels: Uint8Array, mask: GroundingMask, requiredBits: number) {
  dimensions(pixels, mask);
  if (!Number.isInteger(requiredBits) || requiredBits < 0 || requiredBits > 15)
    throw new Error('Invalid native-term requirement');
  const empty = () => ({
    pixels: 0,
    missingRequired: 0,
    unexpectedlyActive: 0,
    invalidNative: 0,
    absentBoth: [0, 0, 0, 0],
  });
  const result = { road: empty(), paint: empty() };
  for (const i of mask.indices) {
    const row = result[mask.receiver[i / 4] === 1 ? 'road' : 'paint'];
    row.pixels++;
    if (pixels[i + 3] !== 255 || pixels[i] % 17 || pixels[i + 1] % 17 || pixels[i + 2] % 17) {
      row.invalidNative++;
      continue;
    }
    const before = pixels[i] / 17,
      after = pixels[i + 1] / 17;
    if ((before & requiredBits) !== requiredBits || (after & requiredBits) !== requiredBits)
      row.missingRequired++;
    if ((before | after) & (15 ^ requiredBits)) row.unexpectedlyActive++;
    if (pixels[i + 2] !== 0) row.invalidNative++;
    for (let channel = 0; channel < 4; channel++)
      if (!((before | after) & (1 << channel))) row.absentBoth[channel]++;
  }
  return result;
}

export function groundingNativeWord(pixels: Uint8Array, offset: number) {
  return pixels[offset] * 256 + pixels[offset + 1];
}
export function groundingNativeStats(pixels: Uint8Array, mask: GroundingMask) {
  dimensions(pixels, mask);
  const empty = () => ({
    pixels: 0,
    maxBeforeUnits: 0,
    maxAfterUnits: 0,
    nonzeroBefore: 0,
    nonzeroAfter: 0,
  });
  const result = { road: empty(), paint: empty() };
  for (const i of mask.indices) {
    const row = result[mask.receiver[i / 4] === 1 ? 'road' : 'paint'];
    const before = groundingNativeWord(pixels, i),
      after = groundingNativeWord(pixels, i + 2);
    row.pixels++;
    row.maxBeforeUnits = Math.max(row.maxBeforeUnits, before);
    row.maxAfterUnits = Math.max(row.maxAfterUnits, after);
    if (before > 0) row.nonzeroBefore++;
    if (after > 0) row.nonzeroAfter++;
  }
  return result;
}

/** Compare each renderer with its own measured sky/sun baselines, after native
 * clamp, intensity, albedo/AO and specular energy-conservation operations. */
export function groundingNativeClosure(
  mixed: Uint8Array,
  sky: Uint8Array,
  sun: Uint8Array,
  mask: GroundingMask,
) {
  for (const pixels of [mixed, sky, sun]) dimensions(pixels, mask);
  const empty = () => ({ pixels: 0, maxBeforeUnits: 0, maxAfterUnits: 0 });
  const result = { road: empty(), paint: empty() };
  for (const i of mask.indices) {
    const row = result[mask.receiver[i / 4] === 1 ? 'road' : 'paint'];
    row.pixels++;
    row.maxBeforeUnits = Math.max(
      row.maxBeforeUnits,
      Math.abs(
        groundingNativeWord(mixed, i) - groundingNativeWord(sky, i) - groundingNativeWord(sun, i),
      ),
    );
    row.maxAfterUnits = Math.max(
      row.maxAfterUnits,
      Math.abs(
        groundingNativeWord(mixed, i + 2) -
          groundingNativeWord(sky, i + 2) -
          groundingNativeWord(sun, i + 2),
      ),
    );
  }
  return result;
}
/** Called with original-only observations before candidate allocation. */
export function groundingClosureBound(originalMaximumUnits: number) {
  if (
    !Number.isInteger(originalMaximumUnits) ||
    originalMaximumUnits < 0 ||
    originalMaximumUnits > GROUNDING_LIMITS.referenceClosureMaxUnits
  )
    throw new Error('Original native-term superposition did not qualify');
  return originalMaximumUnits + GROUNDING_LIMITS.closureQuantizationAllowance;
}
