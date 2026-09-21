import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { Track } from '../../src/simulation/track.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { validatePhoto } from '../../src/rendering/photo-camera.ts';
import { referenceEvent, observeRace } from '../../src/rendering/reference-events.ts';
import { REFERENCES } from '../../src/ui/reference-catalogue.ts';
import { referenceRoute } from '../../src/ui/reference-routes.ts';
import { Interface } from '../../src/ui/interface.ts';
import { teamHub } from '../../src/ui/team-hub.ts';
import { newTeam } from '../../src/storage/team-career.ts';
import { DEFAULT_SETTINGS } from '../../src/storage/data.ts';
import { PhotoStudio } from '../../src/ui/photo-studio.ts';
import { DEFAULT_LIVERY } from '../../src/storage/livery.ts';
import { drivingAcademy } from '../../src/ui/driving-academy.ts';
import { PracticeProgramme } from '../../src/simulation/practice-programme.ts';
import { TeamMediaView } from '../../src/ui/team-media.ts';
import { H } from '../../src/simulation/protocol.ts';
import type { SessionOptions } from '../../src/simulation/config.ts';
export interface RecordedEvent {
  weather: 'clear' | 'rain';
  options: SessionOptions;
  frames: number[][];
  surface: { water: number[]; rubber: number[]; marbles: number[] };
  continuousConditionSeconds: number;
}
let renderer: RacingRenderer | null = null,
  canvas: HTMLCanvasElement | null = null;
let ui: Interface | null = null,
  studio: PhotoStudio | null = null,
  media: TeamMediaView | null = null;
let weather = '';
let prepared = false;
let retainedBuffer = false;
/** Intentionally composed production components. No blocked application URL is
 * bypassed and no worker/startup/input journey is claimed by this inspection. */
export function begin(kind: 'clear' | 'rain', retain = false) {
  finish();
  weather = kind;
  document.body.style.cssText = 'margin:0;width:1920px;height:1080px;overflow:hidden';
  document.body.innerHTML =
    '<canvas id="gameCanvas" style="position:fixed;inset:0;width:1920px;height:1080px"></canvas><main id="app"></main>';
  canvas = document.querySelector<HTMLCanvasElement>('#gameCanvas')!;
  const track = new Track(kind);
  retainedBuffer = retain;
  if (
    retain &&
    !canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true })
  )
    throw new Error('Retained diagnostic WebGL2 buffer unavailable');
  renderer = new RacingRenderer(canvas, track);
  renderer.setQuality('high', { ...graphicsPreset('high'), resolutionScale: 1 });
  const app = document.querySelector<HTMLElement>('#app')!;
  ui = new Interface(app, track, {
    action: () => {},
    start: () => {},
    apply: () => {},
    seek: () => {},
    replaySpeed: () => {},
    exportSetup: () => {},
    importSetup: () => {},
  });
  document.querySelector<HTMLElement>('#loading')!.hidden = true;
  ui.showMode('photo');
  studio = new PhotoStudio(app, {
    change: (p) => renderer!.setPhoto(p, renderer!.cars.length),
    preview: (l) => renderer!.cars[0]?.setLivery(l),
    save: async () => {},
    capture: () => {},
    close: () => studio!.close(),
  });
}
async function probe(png: string) {
  const image = new Image();
  image.src = png;
  await image.decode();
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 18;
  const context = c.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, 32, 18);
  const p = context.getImageData(0, 0, 32, 18).data;
  let opaque = 0,
    nonblack = 0;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3]) opaque++;
    if (p[i] + p[i + 1] + p[i + 2]) nonblack++;
  }
  return { opaque, nonblack };
}
export async function capture(id: number, record: RecordedEvent) {
  if (!renderer || !canvas || !ui || !studio || weather !== record.weather)
    throw new Error('Wrong workbench or weather');
  const entry = REFERENCES.find((r) => r.id === id),
    route = entry && referenceRoute(entry);
  if (!entry || !route || route.destination === 'gap')
    throw new Error('Reference has no implemented counterpart');
  if (!record.frames.length || record.frames.length > 76)
    throw new Error('Missing or excessive recorded history');
  const frames = record.frames.map((f) => new Float32Array(f));
  const frame = frames.at(-1)!;
  for (const f of frames) observeRace(f); // Reject corrupted input before rendering.
  for (let i = 1; i < frames.length; i++)
    if (frames[i][H.TIME] <= frames[i - 1][H.TIME] || frames[i][H.TIME] - frames[i - 1][H.TIME] > 1)
      throw new Error('Discontinuous event history');
  const rule = referenceEvent(id),
    observation = observeRace(frame);
  if (
    rule &&
    (!observation.events.includes(rule.kind) ||
      record.continuousConditionSeconds < rule.holdSeconds)
  )
    throw new Error('The supplied snapshots do not show this event');
  const original = frame.slice();
  // Follow the production loading contract: cooperative car/shader/reflection
  // preparation happens before photography. A constructor is not a warmed app.
  if (!prepared) {
    const ready = await renderer.prepare(
      frame,
      () => {},
      () => false,
    );
    if (!ready) throw new Error('Production preparation did not finish');
    prepared = true;
  }
  media?.dispose();
  media = null;
  studio.close();
  ui.closeModal();
  ui.options = record.options;
  ui.showMode(rule ? 'driving' : 'photo');
  renderer.setPhoto(null);
  renderer.lighting = [25, 79, 80, 87].includes(id) ? 'night' : 'day';
  renderer.changeCamera(rule?.camera ?? 'chase');
  renderer.circuit.updateSurface(
    new Float32Array(record.surface.water),
    new Float32Array(record.surface.rubber),
    new Float32Array(record.surface.marbles),
  );
  renderer.effectPlayback.reset();
  // Same production effect integrator, warmed from real recorded chronology.
  // The selected surface map is a final-frame observation, not a surface replay.
  for (const f of frames.slice(0, -3)) renderer.effectPlayback.update(f);
  if (route.destination === 'photo')
    renderer.setPhoto(validatePhoto(route.photo, frame[H.CARS]), frame[H.CARS]);
  const r = renderer,
    interfaceView = ui,
    c = canvas;
  const measured = await new Promise<Record<string, unknown>>((resolve, reject) =>
    requestAnimationFrame(() => {
      try {
        const warm = frames.slice(-3);
        for (let i = 0; i < warm.length; i++) {
          const previous = warm[Math.max(0, i - 1)],
            next = warm[i];
          r.draw(previous, next, 1, Math.max(0, next[H.TIME] - previous[H.TIME]), false, true);
          interfaceView.update(next, r, true, 1);
        }
        // Update secondary canvases before the final render/readback task.
        // The encoded PNG, rather than a later canvas copy, is the tested image.
        for (let i = 0; i < 3; i++) interfaceView.update(frame, r, true, 1);
        // Hold the exact final state for a reliable same-task PNG readback.
        r.draw(frame, frame, 1, 0, false, true);
        r.draw(frame, frame, 1, 0, false, true);
        const gl = r.renderer.getContext();
        const centralPixel = new Uint8Array(4);
        gl.readPixels(960, 540, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, centralPixel);
        const state = {
          glError: gl.getError(),
          contextLost: gl.isContextLost(),
          centralPixel: Array.from(centralPixel),
          drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
          retainedBuffer,
          contextAttributes: gl.getContextAttributes(),
          renderTarget: r.renderer.getRenderTarget()?.texture.name ?? null,
          framebufferBound: gl.getParameter(gl.FRAMEBUFFER_BINDING) !== null,
          viewport: Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array),
          scissor: gl.getParameter(gl.SCISSOR_TEST),
          width: c.width,
          height: c.height,
        };
        resolve({ ...state, png: c.toDataURL('image/png') });
      } catch (e) {
        reject(e);
      }
    }),
  );
  // Judge the exact encoded PNG, not a later GPU-to-GPU copy of a discarded buffer.
  const pixels = await probe(measured.png as string);
  if (!frame.every((n, i) => n === original[i]))
    throw new Error('Presentation mutated the recorded physics');
  let interfaceKind: string = rule ? 'actual-snapshot-HUD' : 'none';
  if (route.destination === 'team') {
    ui.modalContent(teamHub(newTeam(), route.hub ?? 'overview'));
    interfaceKind = 'new-local-team-component';
  }
  if (route.destination === 'settings') {
    ui.settings(structuredClone(DEFAULT_SETTINGS));
    interfaceKind = 'real-default-settings-component';
  }
  if (route.destination === 'academy' && !route.night) {
    ui.modalContent(drivingAcademy(new PracticeProgramme().progress(), 'off', false));
    interfaceKind = 'actual-unstarted-programme-component';
  }
  if ([5, 31, 75].includes(id)) {
    studio.open(DEFAULT_LIVERY, frame[H.CARS]);
    studio.compose(route.photo ?? {});
    interfaceKind = 'actual-photo-and-decal-controls';
  }
  if (route.destination === 'media') {
    ui.modalContent('<div id="referenceMedia"></div>');
    media = new TeamMediaView(document.querySelector<HTMLElement>('#referenceMedia')!, newTeam());
    media.seek(id === 38 ? 17 : id === 86 ? 24 : 8);
    media.draw();
    interfaceKind = 'original-captioned-media-component';
  }
  return {
    ...measured,
    ...pixels,
    id,
    observation,
    requirement: rule,
    interfaceKind,
    camera: rule?.camera ?? (r.photo ? 'photo' : r.mode),
    photo: r.photo,
    lighting: r.lighting,
    stats: { draws: r.stats().drawCalls, triangles: r.stats().triangles },
    continuousConditionSeconds: record.continuousConditionSeconds,
    historyFrames: frames.length,
    automated: true,
    humanVerified: false,
    visualAccepted: false,
    scope:
      'Composed production renderer/UI components with ordinary automated simulation history. Not normal application navigation, worker execution, human driving, a full surface replay or approved reference parity.',
  };
}
export function finish() {
  media?.dispose();
  media = null;
  studio?.close();
  studio = null;
  ui?.closeModal();
  ui = null;
  renderer?.dispose();
  renderer = null;
  canvas?.remove();
  canvas = null;
  weather = '';
  prepared = false;
}
