import * as T from 'three';
import { assetUrl, type ShippedFile } from './third-party.ts';

/**
 * Loading of the shipped Ultra HDR skies as GPU-decodable texture pairs.
 *
 * The file is fetched once, split at the manifest's gain-map offset and both
 * JPEGs are decoded by the browser (createImageBitmap, off the main thread,
 * no colour management). The base becomes an sRGB texture (the sampler
 * linearises it), the gain map an R8 texture; both mipmapped, longitude
 * repeating. `photo-sky-shader.ts` reconstructs radiance from the pair.
 * Without a browser image decoder (unit tests in node) loading rejects and
 * callers keep the procedural path.
 */
export interface GainMapTextures {
  base: T.Texture;
  gain: T.Texture;
  gainMax: number;
  width: number;
  height: number;
  /** Encoded bytes fetched (download cost). */
  bytes: number;
  dispose(): void;
}

export function gainMapSupported() {
  return (
    typeof fetch === 'function' &&
    (typeof createImageBitmap === 'function' || typeof Image !== 'undefined')
  );
}

type DecodedSky = ImageBitmap | HTMLImageElement | HTMLCanvasElement;
interface DecodeSize {
  width: number;
  height: number;
}

async function decode(bytes: Uint8Array, size?: DecodeSize): Promise<DecodedSky> {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, {
        colorSpaceConversion: 'none',
        premultiplyAlpha: 'none',
        imageOrientation: 'none',
        ...(size && { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high' }),
      });
    } catch {
      /* fall through to an image element */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    if (!size) return image;
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No image resampler available');
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function texture(image: DecodedSky, name: string, srgb: boolean) {
  const t = new T.Texture(image as unknown as HTMLImageElement);
  try {
    t.name = name;
    t.flipY = false;
    t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
    if (!srgb) t.format = T.RedFormat;
    t.wrapS = T.RepeatWrapping;
    t.wrapT = T.ClampToEdgeWrapping;
    t.magFilter = T.LinearFilter;
    t.minFilter = T.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = srgb ? 4 : 1;
    t.needsUpdate = true;
    return t;
  } catch (error) {
    t.dispose();
    throw error;
  }
}

/** Fetch and decode one shipped `.hdr.jpg` (it must carry a gain-map layout). */
export async function loadGainMapTextures(
  file: ShippedFile,
  signal?: AbortSignal,
  maxBaseWidth?: number,
): Promise<GainMapTextures> {
  const layout = file.gainMap;
  if (!layout) throw new Error(`${file.path} has no gain-map layout`);
  if (!gainMapSupported()) throw new Error('No image decoder in this environment');
  const response = await fetch(assetUrl(file.path), { signal });
  if (!response.ok) throw new Error(`${file.path}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== file.bytes)
    throw new Error(`${file.path}: ${bytes.length} bytes, expected ${file.bytes}`);
  // Scale both JPEGs by the same factor: the gain map samples the same rays as the base.
  const ratio = maxBaseWidth && file.width ? Math.min(1, maxBaseWidth / file.width) : 1;
  const size = (width?: number, height?: number) =>
    ratio < 1 && width && height
      ? {
          width: Math.max(1, Math.round(width * ratio)),
          height: Math.max(1, Math.round(height * ratio)),
        }
      : undefined;
  const [a, b] = await Promise.allSettled([
    decode(bytes.subarray(0, layout.offset), size(file.width, file.height)),
    decode(bytes.subarray(layout.offset), size(layout.width, layout.height)),
  ]);
  if (a.status === 'rejected' || b.status === 'rejected') {
    for (const part of [a, b])
      if (part.status === 'fulfilled' && 'close' in part.value) part.value.close();
    throw a.status === 'rejected' ? a.reason : (b as PromiseRejectedResult).reason;
  }
  const baseImage = a.value,
    gainImage = b.value;
  let base: T.Texture | undefined,
    gain: T.Texture | undefined,
    disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    // Each handle owns its bitmap; a failing disposal listener must not strand
    // the other handle or either decoded image.
    try {
      base?.dispose();
    } finally {
      try {
        gain?.dispose();
      } finally {
        try {
          if ('close' in baseImage) baseImage.close();
        } finally {
          if ('close' in gainImage) gainImage.close();
        }
      }
    }
  };
  try {
    base = texture(baseImage, `${file.path} base`, true);
    gain = texture(gainImage, `${file.path} gain`, false);
    return {
      base,
      gain,
      gainMax: layout.gainMax,
      width: baseImage.width,
      height: baseImage.height,
      bytes: bytes.length,
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

/** Linear half-float equirectangular radiance of a texture pair (one draw),
 * for consumers that want an ordinary HDR texture (PMREM, scene.background). */
export function decodeGainMapToHalfFloat(
  renderer: T.WebGLRenderer,
  pair: GainMapTextures,
  scale = 1,
) {
  const previous = renderer.getRenderTarget(),
    face = renderer.getActiveCubeFace(),
    mip = renderer.getActiveMipmapLevel();
  const target = new T.WebGLRenderTarget(pair.width, pair.height, {
    type: T.HalfFloatType,
    format: T.RGBAFormat,
    colorSpace: T.LinearSRGBColorSpace,
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: T.LinearMipmapLinearFilter,
    magFilter: T.LinearFilter,
    wrapS: T.RepeatWrapping,
  });
  let material: T.RawShaderMaterial | undefined,
    geometry: T.PlaneGeometry | undefined;
  try {
    try {
      target.texture.mapping = T.EquirectangularReflectionMapping;
      material = new T.RawShaderMaterial({
        glslVersion: T.GLSL3,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          base: { value: pair.base },
          gain: { value: pair.gain },
          gainMax: { value: pair.gainMax },
          scale: { value: scale },
        },
        vertexShader: `precision highp float;
      in vec3 position; in vec2 uv; out vec2 vUv;
      void main() { vUv = vec2(uv.x, 1.0 - uv.y); gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }`,
        fragmentShader: `precision highp float;
      uniform sampler2D base; uniform sampler2D gain; uniform float gainMax; uniform float scale;
      in vec2 vUv; out vec4 radiance;
      void main() {
        radiance = vec4(texture(base, vUv).rgb * exp2(texture(gain, vUv).r * gainMax) * scale, 1.0);
      }`,
      });
      geometry = new T.PlaneGeometry(1, 1);
      const quad = new T.Mesh(geometry, material);
      const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      try {
        renderer.setRenderTarget(target);
        renderer.render(quad, camera);
      } finally {
        renderer.setRenderTarget(previous, face, mip);
      }
    } finally {
      try {
        material?.dispose();
      } finally {
        geometry?.dispose();
      }
    }
    // Ownership transfers only after drawing, restoration and temporary
    // resource disposal have all completed.
    return target;
  } catch (error) {
    target.dispose();
    throw error;
  }
}
