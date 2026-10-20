import * as T from 'three';
import { createWebGLRenderer } from '../../src/rendering/webgl-renderer.ts';

type DirtyFlag = 'flipY' | 'premultiplyAlpha';
type Factory = 'legacy' | 'production';

function twoColourTexture(flipY = true) {
  const source = document.createElement('canvas');
  source.width = source.height = 2;
  const paint = source.getContext('2d')!;
  paint.fillStyle = '#ff0000';
  paint.fillRect(0, 0, 2, 1);
  paint.fillStyle = '#0000ff';
  paint.fillRect(0, 1, 2, 1);
  const texture = new T.CanvasTexture(source);
  texture.flipY = flipY;
  texture.minFilter = texture.magFilter = T.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

/** Read actual 2D texture orientation after the replacement renderer's startup
 * reset. Ordinary uploads must still apply each texture's own flipY setting. */
function orientation(renderer: T.WebGLRenderer, flipY: boolean) {
  const texture = twoColourTexture(flipY);
  const target = new T.WebGLRenderTarget(8, 8, { depthBuffer: false, stencilBuffer: false });
  const geometry = new T.PlaneGeometry(2, 2);
  const material = new T.MeshBasicMaterial({ map: texture, toneMapped: false });
  const scene = new T.Scene();
  scene.add(new T.Mesh(geometry, material));
  const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.position.z = 1;
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const pixels = new Uint8Array(8 * 8 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 8, 8, pixels);
    const pixel = (y: number) => Array.from(pixels.slice((y * 8 + 4) * 4, (y * 8 + 5) * 4));
    return {
      flipY,
      top: pixel(6),
      bottom: pixel(1),
      uploadedFlipY: renderer.getContext().getParameter(renderer.getContext().UNPACK_FLIP_Y_WEBGL),
      glError: renderer.getContext().getError(),
    };
  } finally {
    renderer.setRenderTarget(null);
    target.dispose();
    texture.dispose();
    geometry.dispose();
    material.dispose();
  }
}

function recreate(dirtyFlag: DirtyFlag, factory: Factory) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const first = createWebGLRenderer(canvas);
  const gl = first.context;
  const attributes = gl.getContextAttributes();
  const adapter = gl.getExtension('WEBGL_debug_renderer_info');
  const adapterName = adapter
    ? String(gl.getParameter(adapter.UNMASKED_RENDERER_WEBGL))
    : 'unknown';
  const unpack = () => ({
    flipY: Boolean(gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL)),
    premultiplyAlpha: Boolean(gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL)),
  });
  const initialError = gl.getError();
  const source = twoColourTexture(dirtyFlag === 'flipY');
  source.premultiplyAlpha = dirtyFlag === 'premultiplyAlpha';
  let second: ReturnType<typeof createWebGLRenderer> | null = null;
  let firstDisposed = false;
  const texImage3D = gl.texImage3D;
  const fallbackUploads: {
    target: string;
    width: number;
    height: number;
    depth: number;
    unpack: ReturnType<typeof unpack>;
    error: number;
  }[] = [];
  try {
    first.renderer.initTexture(source);
    const afterUpload = { unpack: unpack(), error: gl.getError() };
    source.dispose();
    first.renderer.dispose();
    firstDisposed = true;
    const afterDisposal = { unpack: unpack(), error: gl.getError() };
    // Read errors at these two constructor allocations only, so the negative
    // control identifies each rejected fallback rather than one sticky GL flag.
    gl.texImage3D = (...args: unknown[]) => {
      const flags = unpack();
      Reflect.apply(texImage3D, gl, args);
      fallbackUploads.push({
        target:
          args[0] === gl.TEXTURE_2D_ARRAY
            ? 'TEXTURE_2D_ARRAY'
            : args[0] === gl.TEXTURE_3D
              ? 'TEXTURE_3D'
              : String(args[0]),
        width: Number(args[3]),
        height: Number(args[4]),
        depth: Number(args[5]),
        unpack: flags,
        error: gl.getError(),
      });
    };
    // Negative control: the previous production path reused the context and
    // constructed Three directly, without clearing either upload flag.
    second =
      factory === 'production'
        ? createWebGLRenderer(canvas)
        : {
            context: gl,
            renderer: new T.WebGLRenderer({
              canvas,
              context: gl,
              antialias: true,
              powerPreference: 'high-performance',
            }),
          };
    gl.texImage3D = texImage3D;
    return {
      dirtyFlag,
      factory,
      threeRevision: T.REVISION,
      adapter: adapterName,
      sameContext: second.context === gl && second.renderer.getContext() === gl,
      attributes,
      recreatedAttributes: gl.getContextAttributes(),
      initialError,
      afterUpload,
      afterDisposal,
      fallbackUploads,
      constructorErrorAfterPerCallDrain: gl.getError(),
      orientations:
        factory === 'production'
          ? [orientation(second.renderer, true), orientation(second.renderer, false)]
          : [],
    };
  } finally {
    gl.texImage3D = texImage3D;
    if (!firstDisposed) first.renderer.dispose();
    second?.renderer.dispose();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

export function captureWebGLRendererReuse() {
  return (['flipY', 'premultiplyAlpha'] as const).flatMap((dirtyFlag) =>
    (['legacy', 'production'] as const).map((factory) => recreate(dirtyFlag, factory)),
  );
}
