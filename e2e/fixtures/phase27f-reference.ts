import { RacingRenderer, type CameraMode } from '../../src/rendering/renderer.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { validatePhoto } from '../../src/rendering/photo-camera.ts';
import { REFERENCES } from '../../src/ui/reference-catalogue.ts';
import { referenceRoute } from '../../src/ui/reference-routes.ts';
import { H, F, carBase } from '../../src/simulation/protocol.ts';
let renderer: RacingRenderer | null = null;
let sim: Simulation | null = null;
let frame: Float32Array | null = null;
let canvas: HTMLCanvasElement | null = null;
/** Deliberately labelled component evidence. No normal-navigation, human-drive,
 * frontend screenshot or scene-completeness claim is made by this workbench. */
export function begin(kind: 'clear' | 'rain' | 'grid') {
  finish();
  sim = new Simulation({
    ...DEFAULT_OPTIONS,
    opponents: 3,
    mode: kind === 'grid' ? 'race' : 'practice',
    weather: kind === 'rain' ? 'rain' : 'clear',
    compound: kind === 'rain' ? 'wet' : 'medium',
    seed: 1887,
  });
  sim.autoPlayer = kind !== 'grid';
  canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:1920px;height:1080px;display:block';
  document.body.style.cssText = 'margin:0';
  document.body.append(canvas);
  renderer = new RacingRenderer(canvas, sim.track);
  renderer.setQuality('high', { ...graphicsPreset('high'), resolutionScale: 1 });
  const ticks = kind === 'grid' ? 0 : 720;
  for (let i = 0; i < ticks; i++) sim.step(1 / 120);
  frame = sim.makeFrame();
  renderer.draw(frame, frame, 1, 0, false);
  // Four real successive worker-equivalent snapshots warm the contact effects;
  // no emitter, water, pose, lap or weather value is overwritten for a picture.
  if (kind !== 'grid')
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) sim.step(1 / 120);
      const next = sim.makeFrame();
      renderer.draw(frame, next, 1, 1 / 30, false);
      frame = next;
    }
  return { cars: frame[H.CARS], time: frame[H.TIME], rain: frame[H.RAIN] };
}
export const REFERENCE_CAMERAS: Readonly<Record<number, CameraMode>> = {
  3: 'cockpit',
  8: 'pod',
  24: 'chase',
  27: 'cockpit',
  29: 'chase',
  30: 'cockpit',
  36: 'chase',
  39: 'trackside',
  70: 'cockpit',
  79: 'trackside',
  84: 'cockpit',
  85: 'chase',
  87: 'chase',
  88: 'cockpit',
  93: 'cockpit',
  94: 'pod',
  96: 'cockpit',
};
export async function capture(id: number) {
  if (!renderer || !canvas || !frame || !sim) throw new Error('Start the capture workbench first');
  const entry = REFERENCES.find((e) => e.id === id),
    route = entry && referenceRoute(entry);
  const camera = REFERENCE_CAMERAS[id];
  if (!entry || (!camera && route?.destination !== 'photo' && id !== 80))
    throw new Error('No relevant production camera or photo inspection route');
  const original = frame.slice(),
    water = sim.track.water.slice();
  renderer.night = [79, 80, 87].includes(id);
  if (camera) {
    renderer.setPhoto(null);
    renderer.changeCamera(camera);
  } else {
    renderer.setPhoto(
      validatePhoto(
        id === 80 ? { azimuth: 125, elevation: 16, distance: 3.2, focalLength: 60 } : route?.photo,
        frame[H.CARS],
      ),
      frame[H.CARS],
    );
  }
  const r = renderer,
    f = frame,
    c = canvas;
  const capture = await new Promise<{
    png: string;
    opaqueSamples: number;
    nonblackSamples: number;
    glError: number;
    contextLost: boolean;
  }>((resolve, reject) =>
    requestAnimationFrame(() => {
      try {
        // Warm the changed view's temporal/reflection targets, then read the held
        // presentation in the same task. Both draws retain identical physics.
        r.draw(f, f, 1, 0, false);
        r.draw(f, f, 1, 0, false);
        const png = c.toDataURL('image/png');
        const probe = document.createElement('canvas');
        probe.width = 32;
        probe.height = 18;
        const context = probe.getContext('2d')!;
        context.drawImage(c, 0, 0, 32, 18);
        const pixels = context.getImageData(0, 0, 32, 18).data;
        let opaqueSamples = 0,
          nonblackSamples = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] > 0) opaqueSamples++;
          if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 0) nonblackSamples++;
        }
        const gl = r.renderer.getContext();
        resolve({
          png,
          opaqueSamples,
          nonblackSamples,
          glError: gl.getError(),
          contextLost: gl.isContextLost(),
        });
      } catch (error) {
        reject(error);
      }
    }),
  );
  if (!frame.every((v, i) => v === original[i]) || !sim.track.water.every((v, i) => v === water[i]))
    throw new Error('Capture mutated physical state');
  const stats = renderer.stats();
  return {
    ...capture,
    id,
    referenceHash: entry.sha256,
    simulationTime: frame[H.TIME],
    circuitS: frame[carBase(0) + F.S],
    rain: frame[H.RAIN],
    cloud: frame[H.CLOUD],
    width: canvas.width,
    height: canvas.height,
    view: renderer.photo,
    camera: camera ?? 'photo',
    night: renderer.night,
    draws: stats.drawCalls,
    triangles: stats.triangles,
    scope: 'production-renderer-component-photo-not-full-application-or-human-approval',
    humanVerified: false,
    visualAccepted: false,
  };
}
export function finish() {
  renderer?.dispose();
  canvas?.remove();
  renderer = null;
  sim = null;
  frame = null;
  canvas = null;
}
