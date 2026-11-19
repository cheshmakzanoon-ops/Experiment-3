import * as T from 'three';
import { disposeSceneTexture } from '../../src/rendering/assets/texture-source-ownership.ts';
import { scannedGround } from '../../src/rendering/ground/scan-store.ts';
import { installScannedMaps } from '../../src/rendering/ground/scanned-ground.ts';

/** Native ImageBitmap re-upload across independent WebGL renderers. This is
 * the real cache/map-swap/disposal path with synthetic pixels, not an artwork
 * or gameplay benchmark. CPU tests separately invoke RacingRenderer.dispose. */
export async function capture() {
  const size = 64,
    bitmapSize = 4;
  const bitmap = async (pixel: (x: number, y: number) => number[]) => {
    const data = new Uint8ClampedArray(bitmapSize * bitmapSize * 4);
    for (let y = 0; y < bitmapSize; y++)
      for (let x = 0; x < bitmapSize; x++) data.set(pixel(x, y), (y * bitmapSize + x) * 4);
    return createImageBitmap(new ImageData(data, bitmapSize, bitmapSize), {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
  };
  const decoded = await Promise.all([
    bitmap((x, y) => [x < 2 ? 170 : 45, y < 2 ? 145 : 35, (x + y) % 2 ? 160 : 55, 255]),
    bitmap(() => [128, 128, 255, 255]),
    bitmap(() => [255, 192, 0, 255]),
  ]);
  const sources = decoded.map((image) => {
    const texture = new T.Texture(image);
    texture.flipY = false;
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.minFilter = texture.magFilter = T.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  });
  const [map, normalMap, orm] = sources;
  scannedGround.setPreset('high');
  scannedGround.adopt('concrete', {
    id: 'ground-concrete',
    metres: 1,
    maps: { map, normalMap, roughnessMap: orm, metalnessMap: orm, aoMap: orm },
    formats: { color: 'webp', normal: 'webp', orm: 'webp' },
    dispose() {
      for (const texture of sources) texture.dispose();
    },
  });
  const registrations = scannedGround.diagnostics().materials,
    images: Record<string, string> = {},
    cycles: Array<{
      maximumDifference: number;
      nonBlackPixels: number;
      uniqueColors: number;
      cloneSourcesShared: boolean;
      sourceSizeAfterDispose: number[][];
      contextAlive: boolean;
    }> = [],
    glErrors: number[] = [];
  let reference: Uint8Array | null = null;
  let backend: { vendor: string; renderer: string } | null = null;
  for (let cycle = 0; cycle < 3; cycle++) {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 unavailable');
    const renderer = new T.WebGLRenderer({ canvas, context: gl });
    renderer.setSize(size, size, false);
    renderer.toneMapping = T.NoToneMapping;
    renderer.outputColorSpace = T.LinearSRGBColorSpace;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    backend ??= {
      vendor: String(gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR)),
      renderer: String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)),
    };
    const material = new T.MeshStandardMaterial({ roughness: 0.7, metalness: 0 });
    installScannedMaps(
      material,
      'concrete',
      [0.2, 0.2, 0.2],
      1 / scannedGround.uniforms.concrete.info.value.x,
    );
    const clones = [material.map!, material.normalMap!, material.roughnessMap!],
      cloneSourcesShared = clones.every((texture, i) => texture.source === sources[i].source),
      geometry = new T.PlaneGeometry(2, 2),
      scene = new T.Scene(),
      camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 10),
      sun = new T.DirectionalLight(0xffffff, 2);
    camera.position.z = 2;
    sun.position.set(0, 0, 2);
    scene.add(new T.Mesh(geometry, material), sun, new T.AmbientLight(0xffffff, 0.5));
    renderer.render(scene, camera);
    const pixels = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    reference ??= pixels.slice();
    let maximumDifference = 0,
      nonBlackPixels = 0;
    const colors = new Set<string>();
    for (let i = 0; i < pixels.length; i++)
      maximumDifference = Math.max(maximumDifference, Math.abs(pixels[i] - reference[i]));
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 32) nonBlackPixels++;
      colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    }
    images[`renderer-${cycle + 1}`] = canvas.toDataURL('image/png');
    geometry.dispose();
    material.dispose();
    for (const texture of clones) disposeSceneTexture(texture);
    renderer.dispose();
    cycles.push({
      maximumDifference,
      nonBlackPixels,
      uniqueColors: colors.size,
      cloneSourcesShared,
      sourceSizeAfterDispose: decoded.map((image) => [image.width, image.height]),
      contextAlive: !gl.isContextLost(),
    });
    for (let error = gl.getError(); error !== gl.NO_ERROR; error = gl.getError())
      glErrors.push(error);
    renderer.forceContextLoss();
  }
  // Negative control: an unretained bitmap is actually closed, rather than
  // globally skipping image cleanup to make the reuse test succeed.
  const exclusive = await bitmap(() => [90, 120, 30, 255]),
    exclusiveTexture = new T.Texture(exclusive);
  disposeSceneTexture(exclusiveTexture);
  const exclusiveSize = [exclusive.width, exclusive.height];
  const closedControl = await bitmap(() => [190, 40, 90, 255]);
  closedControl.close();
  let closedControlRejected = false;
  try {
    const copy = await createImageBitmap(closedControl);
    copy.close();
  } catch (error) {
    closedControlRejected = error instanceof DOMException && error.name === 'InvalidStateError';
  }
  const registrationsAfter = scannedGround.diagnostics().materials;
  return {
    width: size,
    height: size,
    cycles,
    registrations,
    registrationsAfter,
    exclusiveSize,
    closedControlRejected,
    glErrors,
    backend,
    physicalHardwareValidated: false,
    images,
  };
}
