import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H } from '../../src/simulation/protocol.ts';

/** Fixed-seed, fixed-tick views through the shipping renderer. These are visual
 * review evidence, not an automated claim of resemblance to a commercial game.
 * No screenshot from the user's reference collection is loaded into this scene. */
export async function captureReferenceViews(weather: 'clear' | 'rain') {
  const simulation = new Simulation({
    ...DEFAULT_OPTIONS, mode: 'practice', weather, opponents: 2, seed: 1887,
  });
  for (let i = 0; i < 96; i++) simulation.step(1 / 120);
  const frame = simulation.makeFrame(), original = frame.slice();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:1280px;height:720px';
  document.body.style.cssText = 'margin:0;background:#000';
  document.body.append(canvas);
  const renderer = new RacingRenderer(canvas, simulation.track);
  renderer.setQuality('high', { ...graphicsPreset('high'), resolutionScale: 1 });
  const captures: { view: string; image: string; draws: number; triangles: number }[] = [];
  try {
    for (const view of ['hero', 'cockpit'] as const) {
      renderer.changeCamera('cockpit');
      renderer.reset();
      // The same immutable simulation sample is used in both views. A second
      // frame resolves first-use shader/probe state; it does not advance physics.
      for (let i = 0; i < 2; i++) {
        renderer.draw(frame, frame, 1, 1 / 60, view === 'hero');
        if (i === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      captures.push({
        view,
        image: canvas.toDataURL('image/png'),
        draws: renderer.renderer.info.render.calls,
        triangles: renderer.renderer.info.render.triangles,
      });
    }
    return {
      weather, seed: 1887, tick: frame[H.TICK], width: canvas.width, height: canvas.height,
      graphics: renderer.graphics,
      sourceUnchanged: original.every((value, i) => value === frame[i]),
      finite: frame.every(Number.isFinite),
      meanWaterMm: simulation.track.meanWater(),
      textures: renderer.renderer.info.memory.textures,
      geometries: renderer.renderer.info.memory.geometries,
      captures,
    };
  } finally {
    renderer.dispose();
    canvas.remove();
  }
}
