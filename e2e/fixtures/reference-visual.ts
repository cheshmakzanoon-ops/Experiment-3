import * as T from 'three';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H } from '../../src/simulation/protocol.ts';

/** Fixed-state production captures. Temporary diagnostic variants below are
 * explicitly labelled and must never replace the failing full-preset gate. */
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
  const diagnostics: object[] = [];
  const capture = (view: string) => {
    captures.push({ view, image: canvas.toDataURL('image/png'), draws: renderer.renderer.info.render.calls, triangles: renderer.renderer.info.render.triangles });
    diagnostics.push({ view, camera: renderer.camera.position.toArray(), rotation: renderer.camera.quaternion.toArray(), projection: renderer.camera.projectionMatrix.toArray(), viewport: renderer.renderer.getViewport(new T.Vector4()).toArray(), scissor: renderer.renderer.getScissor(new T.Vector4()).toArray(), scissorTest: renderer.renderer.getScissorTest(), target: renderer.renderer.getRenderTarget()?.texture.name ?? null, glError: renderer.renderer.getContext().getError() });
  };
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
      { name: 'diagnostic-local-no-bloom', reflections: 'local' as const, bloom: false },
      { name: 'diagnostic-environment-no-bloom', reflections: 'environment' as const, bloom: false },
      { name: 'diagnostic-environment-bloom', reflections: 'environment' as const, bloom: true },
      { name: 'diagnostic-local-bloom', reflections: 'local' as const, bloom: true },
    ]) {
      renderer.setQuality('high', { ...full, reflections: variant.reflections, bloom: variant.bloom });
      for (let i = 0; i < 2; i++) {
        renderer.draw(frame, frame, 1, 1 / 60, false);
        if (i === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      capture(variant.name);
    }
    return { weather, seed: 1887, tick: frame[H.TICK], width: canvas.width, height: canvas.height, graphics: renderer.graphics, sourceUnchanged: original.every((v, i) => v === frame[i]), finite: frame.every(Number.isFinite), meanWaterMm: simulation.track.meanWater(), textures: renderer.renderer.info.memory.textures, geometries: renderer.renderer.info.memory.geometries, captures, diagnostics };
  } finally { renderer.dispose(); canvas.remove(); }
}
