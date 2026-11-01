/** Real festival session, workers, input and renderer on one WebGL context.
 * Isolated from the unrelated circuit's initial asset load for reproducible
 * festival screenshots and lifecycle tests. Does not enter the app bundle. */
import * as T from 'three';
import '@fontsource-variable/saira';
import { FestivalSession } from '../../src/session/free-roam.ts';
import { InputController } from '../../src/input/controller.ts';
import { DEFAULT_SETTINGS } from '../../src/storage/data.ts';
import { graphicsPreset, type QualityPreset } from '../../src/rendering/options.ts';
import type { FestivalStatus } from '../../src/simulation/open-world/session.ts';
import type { FestivalRenderer } from '../../src/rendering/open-world/festival-renderer.ts';
import type { WeatherPreset } from '../../src/simulation/config.ts';
import type { LightingMode } from '../../src/rendering/daylight.ts';
import { SOLVANE } from '../../src/simulation/open-world/region-data.ts';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { F, carBase } from '../../src/simulation/protocol.ts';
import { pixelDifference } from './pixel-difference.ts';

declare const __APEX_SOURCE_FINGERPRINT__: string;
declare const __APEX_SOURCE_COMMIT__: string | null;

const params = new URLSearchParams(location.search);
const quality = (params.get('quality') ?? 'medium') as QualityPreset;
const canvas = document.querySelector<HTMLCanvasElement>('#world')!;
const root = document.querySelector<HTMLElement>('#app')!;
const loading = document.querySelector<HTMLElement>('#loading')!;
const gl = new T.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: params.get('capture') === '1',
});
gl.toneMapping = T.ACESFilmicToneMapping;
gl.outputColorSpace = T.SRGBColorSpace;
gl.shadowMap.type = T.PCFSoftShadowMap;
const settings = structuredClone(DEFAULT_SETTINGS);
// Optional saved discoveries exercise the production fast-travel path for
// remote scenery review; an ordinary fixture boot starts undiscovered.
const reviewDiscoveries =
  params.get('discovered') === 'all' ? SOLVANE.events.map((event) => event.id) : [];
const captureFrames = params.get('capture') === '1' ? Number(params.get('frames') ?? 0) : 0;
let session: FestivalSession | null = null,
  exited = false,
  rendering = true,
  draws = 0;
const input = new InputController(settings, (action) => session?.action(action));
const results: unknown[] = [];
const state = () => {
  // Observation only. Production methods/worker messages perform every action.
  const internal = session as unknown as {
    status: FestivalStatus | null;
    renderer: FestivalRenderer | null;
    current: Float32Array | null;
  } | null;
  return {
    sourceIdentity: {
      fingerprint:
        typeof __APEX_SOURCE_FINGERPRINT__ === 'string' ? __APEX_SOURCE_FINGERPRINT__ : null,
      commit: typeof __APEX_SOURCE_COMMIT__ === 'string' ? __APEX_SOURCE_COMMIT__ : null,
    },
    ready: !!session,
    paused: session?.isPaused,
    exited,
    status: internal?.status,
    render: internal?.renderer?.stats,
    camera: internal?.renderer?.mode,
    position: internal?.renderer?.camera.position.toArray(),
    photo: internal?.renderer?.photo,
    results,
    draws,
    memory: { ...gl.info.memory },
    player: internal?.current
      ? {
          x: internal.current[carBase(0) + F.X],
          y: internal.current[carBase(0) + F.Y],
          z: internal.current[carBase(0) + F.Z],
        }
      : null,
    details:
      (internal?.renderer as unknown as { details?: { stats: unknown } })?.details?.stats ?? null,
    street: internal?.renderer?.streetDetails?.stats ?? null,
    contacts: internal?.renderer?.contacts.stats ?? null,
    roads: internal?.renderer?.roads.stats ?? null,
    water: internal?.renderer?.water.coast.stats ?? null,
    atmosphere: internal?.renderer
      ? {
          falloff: internal.renderer.atmosphere.uniforms.apexAerialFalloff.value.toArray(),
          extinction: internal.renderer.atmosphere.uniforms.apexAerialExtinction.value.toArray(),
        }
      : null,
    pace: internal?.renderer?.guidance.cue ?? null,
    lampSockets:
      (internal?.renderer as unknown as { streetLights?: { activeSockets: number[] } })
        ?.streetLights?.activeSockets ?? [],
    practicalLights: internal?.renderer?.practicalLights.state ?? null,
    aero: internal?.renderer?.scene.getObjectByName('EH-3 articulated rear aero')?.visible ?? false,
    frame: internal?.current ? Array.from(internal.current) : null,
  };
};
Object.assign(window, {
  horizonReview: {
    state,
    // Fixed-camera inspection only, excluded from the shipped application.
    // Pauses through the real session; never changes a car, worker, physics
    // sample, material, mesh or quality level. Gameplay evidence uses input.
    inspect: (position: [number, number, number], target: [number, number, number]) => {
      if (!session) throw new Error('Session is not loaded');
      if (!session.isPaused) session.action('pause');
      const renderer = (session as unknown as { renderer: FestivalRenderer }).renderer;
      renderer.setPhoto(true);
      const orbit = (renderer as unknown as { orbit: OrbitControls }).orbit;
      orbit.enableDamping = false;
      orbit.maxDistance = 20000;
      orbit.maxPolarAngle = Math.PI;
      orbit.target.fromArray(target);
      renderer.camera.position.fromArray(position);
      orbit.update();
    },
    // Frozen production-composer comparison. Only real practical-light
    // intensities are zeroed for the control and restored before return.
    // Keeping the light count fixed also keeps the compiled shader variants
    // comparable. No session tick, particle update or exposure edit occurs.
    practicalOptics: (name: string) => {
      if (!session?.isPaused || rendering)
        throw new Error('Optics review requires paused, manual drawing');
      const internal = session as unknown as { renderer: FestivalRenderer; current: Float32Array };
      const renderer = internal.renderer;
      const lights = renderer.practicalLights.root.children.filter(
        (node): node is T.SpotLight => node instanceof T.SpotLight,
      );
      const intensities = lights.map((light) => light.intensity);
      const sourceFrame = internal.current.slice();
      const cameraBefore = renderer.camera.matrixWorld.elements.slice();
      const composer = (renderer as unknown as { composer: { render: (dt: number) => void } })
        .composer;
      const context = gl.getContext();
      const images: { name: string; image: string }[] = [];
      const errors: number[] = [];
      const autoReset = gl.info.autoReset;
      const render = (enabled: boolean, label: string, save = true) => {
        lights.forEach((light, index) => {
          light.intensity = enabled ? intensities[index] : 0;
        });
        gl.info.reset();
        composer.render(0);
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        context.readPixels(
          0,
          0,
          canvas.width,
          canvas.height,
          context.RGBA,
          context.UNSIGNED_BYTE,
          pixels,
        );
        const error = context.getError();
        if (error !== context.NO_ERROR) errors.push(error);
        if (save) images.push({ name: `${name}-${label}`, image: canvas.toDataURL('image/png') });
        return {
          pixels,
          calls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
          memory: { ...gl.info.memory },
        };
      };
      try {
        const before = render(false, 'before');
        const after = render(true, 'after');
        const repeat = render(false, 'repeat', false);
        const difference = pixelDifference(before.pixels, after.pixels);
        const repeatDifference = pixelDifference(before.pixels, repeat.pixels);
        let changedByAtLeastTwo = 0;
        for (let i = 0; i < before.pixels.length; i += 4)
          if (
            [0, 1, 2].some(
              (channel) => Math.abs(before.pixels[i + channel] - after.pixels[i + channel]) >= 2,
            )
          )
            changedByAtLeastTwo++;
        return {
          sourceIdentity: state().sourceIdentity,
          method: 'same frozen production composer; only practical SpotLight intensity off/on/off',
          lights: lights.map((light, index) => ({
            name: light.name,
            visible: light.visible,
            castShadow: light.castShadow,
            intensity: intensities[index],
            position: light.position.toArray(),
            target: light.target.position.toArray(),
          })),
          practicalLights: { ...renderer.practicalLights.state },
          difference: { ...difference, changedByAtLeastTwo },
          repeatDifference,
          physicsUnchanged: sourceFrame.every((value, index) => value === internal.current[index]),
          cameraUnchanged: cameraBefore.every(
            (value, index) => value === renderer.camera.matrixWorld.elements[index],
          ),
          before: { calls: before.calls, triangles: before.triangles, memory: before.memory },
          after: { calls: after.calls, triangles: after.triangles, memory: after.memory },
          errors,
          images,
        };
      } finally {
        lights.forEach((light, index) => {
          light.intensity = intensities[index];
        });
        gl.info.autoReset = autoReset;
      }
    },
    command: (command: Parameters<FestivalSession['command']>[0]) => session?.command(command),
    // Stop submitting GPU frames only for a still capture. This does not alter
    // simulation state, renderer quality, assets, or the production code path.
    rendering: (enabled: boolean) => {
      rendering = enabled;
    },
    image: () => canvas.toDataURL('image/png'),
    draw: () => {
      if (session) {
        session.frame(performance.now());
        draws++;
      }
    },
  },
});
async function boot() {
  session = await FestivalSession.start(
    {
      canvas,
      renderer: gl,
      element: root,
      quality,
      graphics: graphicsPreset(quality),
      lighting: (params.get('lighting') ?? 'day') as LightingMode,
      loading: (text) => {
        loading.textContent = text;
        loading.hidden = false;
      },
      loaded: () => {
        loading.hidden = true;
      },
      toast: (message) => console.info('Festival:', message),
      exit: () => {
        exited = true;
        session?.dispose();
        session = null;
        input.dispose();
      },
      driving: (on) => input.setEnabled(on),
      onResult: (result) => results.push(result),
      load: async () =>
        reviewDiscoveries.length
          ? {
              version: 1,
              discovered: reviewDiscoveries,
              best: {},
              vehicle: params.get('vehicle') ?? 'eh3',
              traffic: true,
            }
          : null,
    },
    {
      weather: (params.get('weather') ?? 'clear') as WeatherPreset,
      vehicle: params.get('vehicle') ?? undefined,
      session: 'horizon-browser-review',
      travel: params.get('travel') ?? undefined,
    },
  );
  input.setEnabled(session.drivingInputEnabled);
  let previous = performance.now();
  const tick = (time: number) => {
    if (!session) return;
    if (!session.drivingInputEnabled) input.pollActions(['pause']);
    else session.input(input.update(Math.min(0.08, (time - previous) / 1000)));
    previous = time;
    if (rendering) {
      session.frame(time);
      draws++;
      if (captureFrames > 0 && draws >= captureFrames) rendering = false;
    }
    requestAnimationFrame(tick);
  };
  window.addEventListener('resize', () => session?.resize());
  requestAnimationFrame(tick);
}
void boot().catch((error) => {
  loading.textContent = String(error);
  console.error(error);
});
