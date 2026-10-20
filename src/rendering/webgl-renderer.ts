import * as T from 'three';

/** Create the circuit renderer on a new or previously used canvas. */
export function createWebGLRenderer(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('webgl2', {
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  if (!context)
    throw new Error(
      'This browser or graphics driver does not provide WebGL2. Enable hardware acceleration, then reload.',
    );
  // Renderer disposal retains the context's upload state. Three allocates its
  // fallback 3D/array textures inside the constructor, before normal texture
  // uploads set their own flags; either stale flag makes those allocations fail.
  context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, false);
  context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  const renderer = new T.WebGLRenderer({
    canvas,
    context,
    antialias: true,
    powerPreference: 'high-performance',
  });
  return { renderer, context };
}
