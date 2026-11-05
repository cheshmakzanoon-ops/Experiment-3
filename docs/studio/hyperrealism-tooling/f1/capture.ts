/** Local look-development capture (not committed): boots a real circuit race with the
 * production RacingRenderer and the authored F1 cars, and returns PNG frames. */
import { RacingRenderer, type CameraMode } from '../../src/rendering/renderer.ts';
import { graphicsPreset, type QualityPreset } from '../../src/rendering/options.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import type { CircuitId } from '../../src/simulation/circuits.ts';
import type { LightingMode } from '../../src/rendering/daylight.ts';

let sim: Simulation | null = null;
let view: RacingRenderer | null = null;
let a: Float32Array, b: Float32Array;
let canvas: HTMLCanvasElement;

interface BootOptions {
  circuit?: CircuitId;
  preset: QualityPreset;
  width: number;
  height: number;
  /** Simulated seconds before the first frame (lights + racing). */
  warmSeconds: number;
  lighting?: LightingMode;
  weather?: 'clear' | 'rain' | 'overcast';
  opponents?: number;
}

async function boot(o: BootOptions) {
  const started = performance.now();
  sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'race',
    opponents: o.opponents ?? 7,
    circuit: o.circuit,
    weather: (o.weather ?? 'clear') as typeof DEFAULT_OPTIONS.weather,
  });
  sim.autoPlayer = true;
  for (let i = 0; i < Math.round(o.warmSeconds * 120); i++) sim.step(1 / 120);
  a = sim.makeFrame();
  b = sim.makeFrame();
  canvas = document.createElement('canvas');
  canvas.style.cssText = `width:${o.width}px;height:${o.height}px;display:block`;
  document.body.append(canvas);
  view = await RacingRenderer.create(
    canvas,
    sim.track,
    () => {},
    () => false,
    { quality: o.preset, graphics: graphicsPreset(o.preset) },
  );
  if (!view) throw new Error('Renderer construction cancelled');
  if (o.lighting) view.lighting = o.lighting;
  return { bootMs: Math.round(performance.now() - started), circuit: sim.track.circuit.id };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Render `frames` frames, each `simSteps` 120 Hz simulation steps apart. */
async function advance(frames: number, simSteps = 2, tag = '') {
  for (let f = 0; f < frames; f++) {
    const t0 = performance.now();
    a.set(b);
    for (let k = 0; k < simSteps; k++) sim!.step(1 / 120);
    sim!.writeFrame(b);
    view!.draw(a, b, 1, simSteps / 120, false, false, simSteps / 120);
    await tick();
    console.log(`F1CAP ${tag} frame ${f + 1}/${frames} ${Math.round(performance.now() - t0)} ms`);
  }
}

/** Settle `settle` frames 0.2 s apart (camera and exposure converge), then
 * `frames` frames at 60 Hz (motion blur / temporal history), then capture. */
async function shoot(mode: CameraMode, frames: number, follow = 0, settle = 6) {
  const started = performance.now();
  view!.follow = follow;
  view!.changeCamera(mode);
  await advance(settle, 24, `${mode} settle`);
  await advance(Math.max(0, frames - 1), 2, `${mode} final`);
  // Last frame and read-back in ONE task: once the frame is presented the
  // (non-preserved) drawing buffer is cleared and toDataURL returns black.
  a.set(b);
  sim!.step(1 / 120);
  sim!.step(1 / 120);
  sim!.writeFrame(b);
  view!.draw(a, b, 1, 1 / 60, false, false, 1 / 60);
  const image = canvas.toDataURL('image/png');
  return { image, ms: Math.round(performance.now() - started) };
}

/** Advance the race without rendering (seconds of simulated time). */
function skip(seconds: number) {
  for (let i = 0; i < Math.round(seconds * 120); i++) sim!.step(1 / 120);
  sim!.writeFrame(b);
  a.set(b);
}

function setPreset(preset: QualityPreset) {
  view!.setQuality(preset, graphicsPreset(preset));
}

(window as unknown as { F1Capture: unknown }).F1Capture = { boot, shoot, skip, setPreset, advance };
(window as unknown as { F1CaptureReady: boolean }).F1CaptureReady = true;
