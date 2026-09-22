export interface PixelContent {
  opaque: number;
  total: number;
  minimum: number;
  maximum: number;
  /** Largest within-channel change between opaque pixels; not RGB saturation. */
  spatialRange: number;
}
export function pixelContent(bytes: Uint8ClampedArray | Uint8Array): PixelContent {
  if (!bytes.length || bytes.length % 4) throw new Error('Invalid pixel buffer');
  let opaque = 0,
    minimum = 255,
    maximum = 0;
  const low = [255, 255, 255],
    high = [0, 0, 0];
  for (let i = 0; i < bytes.length; i += 4) {
    if (bytes[i + 3] < 250) continue;
    opaque++;
    minimum = Math.min(minimum, bytes[i], bytes[i + 1], bytes[i + 2]);
    maximum = Math.max(maximum, bytes[i], bytes[i + 1], bytes[i + 2]);
    for (let channel = 0; channel < 3; channel++) {
      low[channel] = Math.min(low[channel], bytes[i + channel]);
      high[channel] = Math.max(high[channel], bytes[i + channel]);
    }
  }
  return {
    opaque,
    total: bytes.length / 4,
    minimum,
    maximum,
    spatialRange: opaque ? Math.max(...high.map((value, i) => value - low[i])) : 0,
  };
}
export function requireImageContent(content: PixelContent) {
  if (
    ![content.opaque, content.total, content.minimum, content.maximum, content.spatialRange].every(
      Number.isFinite,
    ) ||
    !Number.isInteger(content.total) ||
    !Number.isInteger(content.opaque) ||
    content.minimum < 0 ||
    content.maximum > 255 ||
    content.spatialRange > 255 ||
    content.total < 1 ||
    content.opaque > content.total ||
    content.opaque < content.total * 0.9 ||
    content.maximum < 4 ||
    content.maximum <= content.minimum ||
    content.spatialRange < 1
  )
    throw new Error('Rendered image is empty, transparent or uniform; no evidence was saved');
}
/** Convert WebGL's bottom-up RGBA rows in-place, retaining one bounded row of
 * scratch storage. Explicit dimensions prevent partial images or overrun. */
export function flipPixelRows(bytes: Uint8Array, width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height * 4 !== bytes.length
  )
    throw new Error('Invalid RGBA dimensions');
  const stride = width * 4,
    row = new Uint8Array(stride);
  for (let y = 0; y < Math.floor(height / 2); y++) {
    const top = y * stride,
      bottom = (height - y - 1) * stride;
    row.set(bytes.subarray(top, top + stride));
    bytes.copyWithin(top, bottom, bottom + stride);
    bytes.set(row, bottom);
  }
}

/** Must be called in the SAME task as the production draw. Explicit WebGL
 * readback owns the actual final pixels before asynchronous PNG encoding and
 * avoids driver-dependent GPU-canvas to Canvas2D copies. This synchronous cost
 * is incurred only for a requested photograph, never every rendered frame. */
export function captureRenderedCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  if (
    !Number.isInteger(canvas.width) ||
    !Number.isInteger(canvas.height) ||
    canvas.width < 1 ||
    canvas.height < 1 ||
    canvas.width * canvas.height > 33_177_600
  )
    return Promise.reject(new Error('Invalid or oversized image dimensions'));
  let copy: HTMLCanvasElement | null = null;
  let probe: HTMLCanvasElement | null = null;
  const release = () => {
    if (copy) copy.width = copy.height = 1;
    if (probe) probe.width = probe.height = 1;
  };
  try {
    const gl = canvas.getContext('webgl2');
    if (gl?.isContextLost()) throw new Error('Graphics context is lost');
    copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Image snapshot context is unavailable');
    if (gl) {
      if (gl.drawingBufferWidth !== canvas.width || gl.drawingBufferHeight !== canvas.height)
        throw new Error('Drawing buffer changed before capture');
      // Do not silently photograph an intermediate HDR/probe framebuffer.
      if (gl.getParameter(gl.FRAMEBUFFER_BINDING) !== null)
        throw new Error('Final display framebuffer is not bound');
      const previousPack = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer | null;
      const stores = [
        gl.PACK_ALIGNMENT,
        gl.PACK_ROW_LENGTH,
        gl.PACK_SKIP_PIXELS,
        gl.PACK_SKIP_ROWS,
      ];
      const values = stores.map((store) => gl.getParameter(store) as number);
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      try {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        stores.forEach((store, i) => gl.pixelStorei(store, i === 0 ? 1 : 0));
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const error = gl.getError();
        if (error !== gl.NO_ERROR || gl.isContextLost())
          throw new Error(`Final framebuffer readback failed (WebGL ${error})`);
      } finally {
        stores.forEach((store, i) => gl.pixelStorei(store, values[i]));
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, previousPack);
      }
      flipPixelRows(pixels, canvas.width, canvas.height);
      context.putImageData(
        new ImageData(new Uint8ClampedArray(pixels.buffer), canvas.width, canvas.height),
        0,
        0,
      );
    } else context.drawImage(canvas, 0, 0);
    probe = document.createElement('canvas');
    probe.width = 64;
    probe.height = 36;
    const sample = probe.getContext('2d', { willReadFrequently: true });
    if (!sample) throw new Error('Image validation context is unavailable');
    sample.drawImage(copy, 0, 0, probe.width, probe.height);
    requireImageContent(pixelContent(sample.getImageData(0, 0, probe.width, probe.height).data));
    probe.width = probe.height = 1;
    return new Promise<Blob>((resolve, reject) => {
      copy!.toBlob((blob) => {
        release();
        if (blob && blob.size >= 64) resolve(blob);
        else reject(new Error('PNG encoder returned no image'));
      }, 'image/png');
    }).catch((error: unknown) => {
      release();
      throw error;
    });
  } catch (error) {
    release();
    return Promise.reject(error);
  }
}
