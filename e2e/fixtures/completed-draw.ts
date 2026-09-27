type ReadbackContext = Pick<WebGL2RenderingContext, 'RGBA' | 'UNSIGNED_BYTE' | 'isContextLost'> & {
  // Only the CPU-array overload participates; a PIXEL_PACK_BUFFER offset is not
  // a completion witness and must not be accepted by this fixture boundary.
  readPixels(
    x: number,
    y: number,
    width: number,
    height: number,
    format: number,
    type: number,
    destination: Uint8Array,
  ): void;
};

/** Test-only completion witness. Never call this from the game's frame loop. */
export function completedDrawMilliseconds(
  gl: ReadbackContext,
  draw: () => void,
  pixel: Uint8Array,
  now: () => number = () => performance.now(),
): number {
  if (pixel.byteLength !== 4) throw new Error('A completed draw needs one RGBA8 pixel');
  if (gl.isContextLost()) throw new Error('Cannot measure a lost WebGL context');
  const start = now();
  draw();
  // Chromium deliberately implements WebGL finish() as Flush(). A CPU readback
  // instead waits for this draw's colour output; it cannot report only command
  // submission while queued software-GPU work lands in a later sample.
  // Includes the one-pixel transfer/round trip: this is NOT a GPU timer query.
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  if (gl.isContextLost()) throw new Error('WebGL context lost during measured draw');
  const duration = now() - start;
  if (!Number.isFinite(duration) || duration < 0) throw new Error('Invalid completed draw time');
  return duration;
}
