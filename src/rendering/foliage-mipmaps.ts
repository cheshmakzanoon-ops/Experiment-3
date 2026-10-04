/** Alpha-tested foliage needs coverage-preserving minification: averaging many
 * small leaves into a low-alpha texel must not erase the entire distant tree.
 * RGB remains the browser's premultiplied-image resample; only alpha is scaled.
 */
export function alphaCoverage(pixels: Uint8ClampedArray, cutoff: number): number {
  let solid = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] / 255 >= cutoff) solid++;
  return solid / (pixels.length / 4);
}
export function preserveCoverage(
  pixels: Uint8ClampedArray,
  target: number,
  cutoff: number,
): number {
  if (
    !pixels.length ||
    pixels.length % 4 ||
    !Number.isFinite(target + cutoff) ||
    target < 0 ||
    target > 1 ||
    cutoff <= 0 ||
    cutoff >= 1
  )
    throw new Error('Invalid foliage alpha-coverage input');
  const histogram = new Uint32Array(256),
    count = pixels.length / 4;
  for (let i = 3; i < pixels.length; i += 4) histogram[pixels[i]]++;
  let covered = 0,
    threshold = 255,
    best = Infinity;
  for (let a = 255; a > 0; a--) {
    covered += histogram[a];
    const error = Math.abs(covered / count - target);
    if (
      error < best ||
      (error === best &&
        Math.abs(a - Math.ceil(cutoff * 255)) < Math.abs(threshold - Math.ceil(cutoff * 255)))
    ) {
      threshold = a;
      best = error;
    }
  }
  // A zero-alpha hole remains a hole. A small terminal mip cannot represent
  // arbitrary fractional coverage; choose the closest representable result.
  if (target <= best) {
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 0;
  } else {
    const cutoffByte = Math.ceil(cutoff * 255),
      scale = cutoffByte / threshold;
    for (let i = 3; i < pixels.length; i += 4) {
      const alpha = pixels[i],
        scaled = Math.min(255, Math.round(alpha * scale));
      // Quantization must preserve the histogram's selected partition. With
      // threshold 255, for example, both 254 and 255 used to round to byte 115
      // at cutoff .45, turning a requested half-covered mip into a solid one.
      // Keep zero-alpha holes at zero and enforce the chosen side of the cut.
      pixels[i] =
        alpha === 0
          ? 0
          : alpha >= threshold
            ? Math.max(cutoffByte, scaled)
            : Math.min(cutoffByte - 1, scaled);
    }
  }
  return alphaCoverage(pixels, cutoff);
}

/** Build once per texture-size change, never on a frame/camera/LOD update. */
export function foliageMipmaps(
  source: CanvasImageSource & { width: number; height: number },
  limit: number,
  cutoff: number,
): HTMLCanvasElement[] {
  const original = document.createElement('canvas');
  original.width = source.width;
  original.height = source.height;
  const context = original.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Foliage coverage requires Canvas 2D');
  context.drawImage(source, 0, 0);
  const target = alphaCoverage(
      context.getImageData(0, 0, original.width, original.height).data,
      cutoff,
    ),
    factor = Math.min(1, limit / Math.max(source.width, source.height)),
    levels: HTMLCanvasElement[] = [];
  let width = Math.max(1, Math.round(source.width * factor)),
    height = Math.max(1, Math.round(source.height * factor));
  while (true) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Foliage mipmap requires Canvas 2D');
    ctx.drawImage(source, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    preserveCoverage(pixels.data, target, cutoff);
    ctx.putImageData(pixels, 0, 0);
    levels.push(canvas);
    if (width === 1 && height === 1) break;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }
  return levels;
}
