import * as T from 'three';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H } from '../../src/simulation/protocol.ts';

/** Fixed-state production captures. Blank/invalid-pixel checks are regression
 * gates, not automated claims of commercial-game likeness or hardware FPS. */
export async function captureReferenceViews(weather: 'clear' | 'rain') {
  const simulation = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', weather, opponents: 2, seed: 1887 });
  for (let i = 0; i < 96; i++) simulation.step(1 / 120);
  const frame = simulation.makeFrame(), original = frame.slice();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:1280px;height:720px';
  document.body.style.cssText = 'margin:0;background:#000';
  document.body.append(canvas);
  const renderer = new RacingRenderer(canvas, simulation.track);
  const full = { ...graphicsPreset('high'), resolutionScale: 1 };
  renderer.setQuality('high', full);
  const captures: { view: string; image: string; draws: number; triangles: number }[] = [];
  const probeSamples: { face: number; nonfinite: number; maximum: number; minimum: number; hits: object[] }[] = [];
  const originalProbe = T.CubeCamera.prototype.update;
  // Read the actual half-float source, before PMREM spreads one bad texel across
  // its roughness mips. Readback exists only in this test fixture, never gameplay.
  T.CubeCamera.prototype.update = function(gl, scene) {
    originalProbe.call(this, gl, scene);
    const target = this.renderTarget;
    for (let face = 0; face < 6; face++) {
      const bits = new Uint16Array(target.width * target.height * 4);
      (gl as T.WebGLRenderer).readRenderTargetPixels(target, 0, 0, target.width, target.height, bits, face);
      let nonfinite = 0, maximum = 0, minimum = Infinity;
      const hits: object[] = [];
      for (let i = 0; i < bits.length; i++) {
        if (i % 4 === 3) continue;
        const value = T.DataUtils.fromHalfFloat(bits[i]);
        if (!Number.isFinite(value)) {
          nonfinite++;
          if (hits.length === 0) {
            const x = (i / 4 | 0) % target.width, y = (i / 4 / target.width | 0);
            const ray = new T.Raycaster();
            ray.setFromCamera(new T.Vector2((x + .5) / target.width * 2 - 1, (y + .5) / target.height * 2 - 1), this.children[face] as T.PerspectiveCamera);
            for (const hit of ray.intersectObjects(scene.children, true).slice(0, 8)) {
              const material = (hit.object as T.Mesh).material;
              const one = Array.isArray(material) ? material[hit.face?.materialIndex ?? 0] : material;
              hits.push({ x, y, name: hit.object.name, distance: hit.distance, material: one?.name, type: one?.type, point: hit.point.toArray() });
            }
          }
        } else { maximum = Math.max(maximum, value); minimum = Math.min(minimum, value); }
      }
      probeSamples.push({ face, nonfinite, maximum, minimum, hits });
    }
  };
  const capture = (view: string) => captures.push({ view, image: canvas.toDataURL('image/png'), draws: renderer.renderer.info.render.calls, triangles: renderer.renderer.info.render.triangles });
  try {
    for (const view of ['hero', 'cockpit'] as const) {
      renderer.changeCamera('cockpit'); renderer.reset();
      for (let i = 0; i < 2; i++) {
        renderer.draw(frame, frame, 1, 1 / 60, view === 'hero');
        if (i === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      capture(view);
    }
    for (const variant of [
      { name: 'local-no-bloom', reflections: 'local' as const, bloom: false },
      { name: 'environment-no-bloom', reflections: 'environment' as const, bloom: false },
      { name: 'environment-bloom', reflections: 'environment' as const, bloom: true },
      { name: 'local-bloom', reflections: 'local' as const, bloom: true },
    ]) {
      renderer.setQuality('high', { ...full, reflections: variant.reflections, bloom: variant.bloom });
      for (let i = 0; i < 2; i++) {
        renderer.draw(frame, frame, 1, 1 / 60, false);
        if (i === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      capture(variant.name);
    }
    return { weather, seed: 1887, tick: frame[H.TICK], width: canvas.width, height: canvas.height, graphics: renderer.graphics, sourceUnchanged: original.every((v, i) => v === frame[i]), finite: frame.every(Number.isFinite), meanWaterMm: simulation.track.meanWater(), textures: renderer.renderer.info.memory.textures, geometries: renderer.renderer.info.memory.geometries, captures, probeSamples, glError: renderer.renderer.getContext().getError() };
  } finally { T.CubeCamera.prototype.update = originalProbe; renderer.dispose(); canvas.remove(); }
}
