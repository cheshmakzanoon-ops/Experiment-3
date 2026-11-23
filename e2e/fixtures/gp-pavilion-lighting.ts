import * as T from 'three';
import { buildVenueLandmark } from '../../src/rendering/venue-landmark.ts';
import { CIRCUITS } from '../../src/simulation/circuits.ts';
import { Track } from '../../src/simulation/track.ts';

/** Meter the night emission on the actual GP circuit shell. Orthographic rays
 * along Z give each framebuffer row a known height on the building. */
export function captureGpPavilion() {
  const track = new Track('clear', false, undefined, CIRCUITS.montejaral);
  const { display, structure } = buildVenueLandmark(track);
  const renderer = new T.WebGLRenderer({
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  const width = 384,
    height = 256,
    halfHeight = 23;
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x101620, 0);
  const halfWidth = (halfHeight * width) / height;
  const camera = new T.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.1, 120);
  camera.position.set(0, 0, 72);
  camera.lookAt(0, 0, 0);
  display.position.set(0, 0, 0);
  const scene = new T.Scene();
  scene.add(display, new T.HemisphereLight(0xcad8ee, 0xc3a285, 0.7));
  const gl = renderer.getContext();
  function frame(emission: number) {
    display.material.emissiveIntensity = emission;
    renderer.render(scene, camera);
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }
  try {
    const unlit = frame(0),
      lit = frame(1.6),
      image = renderer.domElement.toDataURL('image/png');
    const restored = frame(0);
    let shellPixels = 0,
      litPixels = 0,
      outsideGallery = 0,
      restoredPixels = 0;
    for (let i = 0; i < lit.length; i += 4) {
      if (lit[i + 3] < 128) continue;
      shellPixels++;
      const changed = Math.max(
        Math.abs(lit[i] - unlit[i]),
        Math.abs(lit[i + 1] - unlit[i + 1]),
        Math.abs(lit[i + 2] - unlit[i + 2]),
      );
      if (changed > 6) {
        litPixels++;
        const metres = (((Math.floor(i / (4 * width)) + 0.5) / height) * 2 - 1) * halfHeight;
        if (metres < -7.4 || metres > 0.65) outsideGallery++;
      }
      if (
        restored[i] !== unlit[i] ||
        restored[i + 1] !== unlit[i + 1] ||
        restored[i + 2] !== unlit[i + 2]
      )
        restoredPixels++;
    }
    return {
      shellPixels,
      litPixels,
      outsideGallery,
      restoredPixels,
      image,
      draws: renderer.info.render.calls,
      glError: gl.getError(),
    };
  } finally {
    const materials = new Set<T.Material>();
    for (const root of [structure, display])
      root.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
        if (o instanceof T.InstancedMesh) o.dispose();
      });
    materials.forEach((m) => m.dispose());
    renderer.dispose();
  }
}
