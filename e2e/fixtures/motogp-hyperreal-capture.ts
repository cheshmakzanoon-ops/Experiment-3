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
  ] = await Promise.all([
    import('../../src/simulation/world.ts'),
    import('../../src/simulation/config.ts'),
    import('../../src/rendering/renderer.ts'),
    import('../../src/rendering/options.ts'),
    import('../../src/simulation/protocol.ts'),
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
  // Same GPU fence as RacingRenderer.waitForPreparedFrame, with a review-only
  // deadline: a CPU rasteriser needs minutes for each newly visible program
  // (the cockpit view's first-person materials), not the shipped 45 s.
  const gpuFrames = (renderer as unknown as { gpuFrames: { ready(): boolean } }).gpuFrames;
  const settle = async () => {
    const deadline = performance.now() + 600000;
    while (!gpuFrames.ready()) {
      if (performance.now() >= deadline) throw new Error('GPU frame not ready within 600 s');
      await yieldGpu();
    }
  };
  try {
    const prepared = await renderer.prepare(
      current,
      () => {},
      () => false,
      yieldGpu,
    );
    if (!prepared) throw new Error('GP composition preparation cancelled');
    const moments = (o.moments ?? [24, 32, 40]).slice().sort((a, b) => a - b);
    const views = o.views ?? (['chase', 'cockpit', 'trackside'] as CameraMode[]);
    let time = 0;
    for (const moment of moments) {
      if (moment > time) {
        advance(moment - time);
        time = moment;
      }
      for (const view of views) {
        renderer.changeCamera(view);
        // Settle camera damping over real simulated motion (~0.4 s at 60 Hz).
        for (let f = 0; f < 24; f++) {
          advance(1 / 60);
          time += 1 / 60;
          renderer.draw(previous, current, 1, 1 / 60, false);
          if (f % 6 === 5) await settle();
        }
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
