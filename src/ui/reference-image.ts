/** A hash proves identity, not visible image content. These bounded checks reject
 * empty readbacks; they never score or approve artistic/reference quality. */
export function referencePixelSample(pixels: Uint8ClampedArray) {
  if (!pixels.length || pixels.length % 4) throw new Error('Invalid PNG pixel sample');
  let opaque = 0;
  let nonblack = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 255) opaque++;
    if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 0 && pixels[i + 3]) nonblack++;
  }
  if (opaque !== pixels.length / 4 || nonblack === 0)
    throw new Error('PNG readback is transparent or entirely black; no visual evidence saved');
  return { samples: pixels.length / 4, opaque, nonblack, visualAccepted: false as const };
}

export async function validateReferenceImage(blob: Blob, width: number, height: number) {
  if (
    blob.type !== 'image/png' ||
    blob.size < 64 ||
    blob.size > 16 * 1024 * 1024 ||
    ![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 16384) ||
    width * height > 32 * 1024 * 1024
  )
    throw new Error('PNG exceeds the bounded reference capture dimensions or byte limit');
  const header = new DataView(await blob.slice(0, 24).arrayBuffer());
  if (header.getUint32(16) !== width || header.getUint32(20) !== height)
    throw new Error('PNG dimensions differ from the rendered frame');
  const image = await createImageBitmap(blob, {
    resizeWidth: 32,
    resizeHeight: 18,
    resizeQuality: 'high',
  });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 18;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('PNG pixel validation is unavailable');
    context.drawImage(image, 0, 0, 32, 18);
    return referencePixelSample(context.getImageData(0, 0, 32, 18).data);
  } finally {
    image.close();
  }
}
