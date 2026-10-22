import type { QualityPreset } from '../../src/rendering/options.ts';
import type { CameraMode } from '../../src/rendering/renderer.ts';

export { installOfflineAssets } from './motogp-race-review.ts';

export interface HyperrealCaptureOptions {
  weather?: 'clear' | 'rain';
  preset?: QualityPreset;
  circuit?: string;
  vehicles?: string[];
  opponents?: number;
  /** Simulation seconds at which to capture; each moment captures every view. */
  moments?: number[];
  views?: CameraMode[];
  width?: number;
  height?: number;
  seed?: number;
}

/** Hyperrealism review capture: the production Simulation and RacingRenderer
 * driven through a live GP race (AI rides the player bike), sampled at
 * several moments of the lap from each camera. The canvas is read in the same
 * task as the draw that produced it, so the default framebuffer has not yet
 * been presented and cleared. Not the full app shell, UI or native pit factory. */
export async function captureGPMoments(o: HyperrealCaptureOptions = {}) {
  const [
    { Simulation },
    { DEFAULT_OPTIONS },
    { RacingRenderer },
    { graphicsPreset },
    { F, B, BIKE_BASE, carBase },
    { GpuFrameGate },
  ] = await Promise.all([
    import('../../src/simulation/world.ts'),
    import('../../src/simulation/config.ts'),
    import('../../src/rendering/renderer.ts'),
    import('../../src/rendering/options.ts'),
    import('../../src/simulation/protocol.ts'),
    import('../../src/rendering/gpu-frame-gate.ts'),
  ]);
  const weather = o.weather ?? 'clear';
  const preset = o.preset ?? 'high';
  const opponents = o.opponents ?? 5;
  const vehicles =
    o.vehicles ?? Array.from({ length: opponents + 1 }, (_, i) => (i % 2 ? 'gpr2' : 'gpr1'));
  const simulation = new Simulation({
    ...DEFAULT_OPTIONS,
    circuit: (o.circuit ?? 'poggio-alto') as never,
    mode: 'race',
    laps: 3,
    ruleset: 'gp-motorcycle',
    vehicles,
    weather,
    compound: weather === 'rain' ? 'wet' : 'medium',
    opponents,
    seed: o.seed ?? 34100,
  });
  simulation.autoPlayer = true;
  const width = o.width ?? 1280,
    height = o.height ?? 720;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `display:block;width:${width}px;height:${height}px`;
  document.body.style.cssText = 'margin:0';
  document.body.append(canvas);
  const renderer = new RacingRenderer(canvas, simulation.track);
  renderer.setQuality(preset, { ...graphicsPreset(preset), resolutionScale: 1 });
  const yieldGpu = () => new Promise<void>((resolve) => setTimeout(resolve, 12));
  const step = 1 / 120;
  let previous = simulation.makeFrame();
  let current = simulation.makeFrame();
  const advance = (seconds: number) => {
    const ticks = Math.max(1, Math.round(seconds / step));
    for (let i = 0; i < ticks; i++) simulation.step(step);
    previous = current;
    current = simulation.makeFrame();
  };
  const captures: {
    view: string;
    moment: number;
    image: string;
    draws: number;
    triangles: number;
    speedKph: number;
    leanDeg: number;
    brake: number;
    throttle: number;
  }[] = [];
  // Review-only GPU fence: a CPU rasteriser (llvmpipe) can spend minutes on one
  // full High/Medium circuit frame, so the shipped 120 s stall limit and 45 s
  // preparation deadline are replaced for this capture only.
  const internals = renderer as unknown as { gpuFrames: InstanceType<typeof GpuFrameGate> };
  internals.gpuFrames.dispose();
  const gpuFrames = (internals.gpuFrames = new GpuFrameGate(
    renderer.renderer.getContext() as WebGL2RenderingContext,
    undefined,
    1000,
    10000,
    1800000,
  ));
  const settle = async () => {
    const started = performance.now();
    while (!gpuFrames.ready()) {
      if (performance.now() - started >= 1800000) throw new Error('GPU frame not ready in 30 min');
      await yieldGpu();
    }
    return (performance.now() - started) / 1000;
  };
  try {
    const prepared = await renderer.prepare(
      current,
      () => {},
      () => false,
      yieldGpu,
    );
    if (!prepared) throw new Error('GP composition preparation cancelled');
    console.log(`prepared ${preset} scene in ${(performance.now() / 1000).toFixed(1)} s`);
    const moments = (o.moments ?? [24, 32, 40]).slice().sort((a, b) => a - b);
    const views = o.views ?? (['chase', 'cockpit', 'trackside'] as CameraMode[]);
    let time = 0;
    for (const moment of moments) {
      if (moment > time) {
        advance(moment - time);
        time = moment;
      }
      for (const view of views) {
        const started = performance.now();
        renderer.changeCamera(view);
        // Settle camera damping over ~0.5 s of real simulated motion. Few long
        // steps (draw clamps dt to 0.08 s): each draw of a 5–6 M triangle High
        // scene costs seconds on a CPU rasteriser. Newly visible programs
        // compile on the first draw, so the fence is awaited right after it.
        for (let f = 0; f < 6; f++) {
          advance(1 / 12);
          time += 1 / 12;
          renderer.draw(previous, current, 1, 1 / 12, false);
          if (f === 0) console.log(`first ${view} frame GPU ${(await settle()).toFixed(1)} s`);
        }
        await settle();
        renderer.draw(previous, current, 1, 1 / 60, false);
        const image = canvas.toDataURL('image/jpeg', 0.92);
        const base = carBase(0);
        captures.push({
          view,
          moment,
          image,
          draws: renderer.renderer.info.render.calls,
          triangles: renderer.renderer.info.render.triangles,
          speedKph: current[base + F.SPEED] * 3.6,
          leanDeg: (current[base + BIKE_BASE + B.LEAN] * 180) / Math.PI,
          brake: current[base + F.BRAKE],
          throttle: current[base + F.THROTTLE],
        });
        // The review runner persists each frame immediately when it exposes this.
        await (
          globalThis as { saveCapture?: (name: string, url: string) => Promise<void> }
        ).saveCapture?.(`${view}-${moment}s.jpg`, image);
        console.log(
          `captured ${view}@${moment}s in ${((performance.now() - started) / 1000).toFixed(1)} s`,
        );
      }
    }
    return {
      captures,
      finite: current.every(Number.isFinite),
      weather,
      preset,
      circuit: o.circuit ?? 'poggio-alto',
      glError: renderer.renderer.getContext().getError(),
    };
  } finally {
    renderer.dispose();
    canvas.remove();
  }
}
