import { expect, it, vi } from 'vitest';
import * as T from 'three';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import { SkyEnvironment, configureSky } from '../src/rendering/daylight.ts';
import { PhotoSky } from '../src/rendering/assets/photo-sky.ts';
import { GP_PHOTOGRAPHIC } from '../src/rendering/gp-photographic-light.ts';
import { MENU_CLOUD_COVER } from '../src/rendering/menu-preview.ts';
import { PreparationTrace } from '../src/rendering/preparation.ts';
import { CAR_STRIDE, HEADER, H, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import { programHarness } from './helpers/three-program-harness.ts';

// Only image decoding is replaced. The real photo catalogue, sky selection,
// bindings, cache and installed Three PMREM consumer all run below. This is a
// native submission/ownership test, not browser rasterization evidence.
vi.mock('../src/rendering/assets/gain-map.ts', async () => {
  const three = await import('three');
  return {
    gainMapSupported: () => true,
    loadGainMapTextures: async (file: { path: string }) => {
      const base = new three.Texture(),
        gain = new three.Texture();
      base.name = `${file.path} base`;
      gain.name = `${file.path} gain`;
      return {
        base,
        gain,
        gainMax: 8,
        width: 4096,
        height: 2048,
        bytes: 0,
        dispose() {
          base.dispose();
          gain.dispose();
        },
      };
    },
  };
});

function fixture() {
  const h = programHarness(),
    sky = new Sky(),
    photoSky = new PhotoSky('green');
  // Session preparation starts on the canvas. The harness's initial cubemap
  // deliberately has independent logical viewport state for compile tests.
  h.renderer.setRenderTarget(null);
  configureSky(sky);
  photoSky.setQuality('high');
  const environment = new SkyEnvironment(sky, undefined, photoSky);
  environment.highDetail = true;
  const scene = new T.Scene(),
    car = new T.Group();
  scene.add(sky, car);
  const submissions: object[] = [];
  const render = h.renderer.render;
  h.renderer.render = (object, camera) => {
    const target = h.renderer.getRenderTarget();
    const material = (object as T.Mesh).material as T.Material | undefined;
    const uniforms = sky.material.uniforms;
    submissions.push({
      owner: material?.name ?? object.type,
      clearDay: photoSky.clearDay,
      width: target?.width,
      height: target?.height,
      viewport: target?.viewport.toArray(),
      toneMapping: h.renderer.toneMapping,
      autoClear: h.renderer.autoClear,
      camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray() },
      sky:
        object instanceof T.Scene
          ? {
              cover: uniforms.cloudCover.value,
              ground: uniforms.groundAmount.value,
              irradiance: uniforms.groundIrradiance.value.toArray(),
              baseA: (uniforms.photoBaseA.value as T.Texture | null)?.name,
              baseB: (uniforms.photoBaseB.value as T.Texture | null)?.name,
              gainA: (uniforms.photoGainA.value as T.Texture | null)?.name,
              gainB: (uniforms.photoGainB.value as T.Texture | null)?.name,
              photoA: uniforms.photoA.value.toArray(),
              photoB: uniforms.photoB.value.toArray(),
              weight: uniforms.photoWeight.value,
              amount: uniforms.photoAmount.value,
            }
          : null,
    });
    render.call(h.renderer, object, camera);
  };
  const frame = new Float32Array(HEADER + CAR_STRIDE);
  frame[H.CARS] = 1;
  frame[H.CLOUD] = MENU_CLOUD_COVER;
  frame[carBase(0) + RACE_BASE + R.VEHICLE] = vehicleIndex('gpr1');
  const target = {
    disposed: false,
    cars: [{ root: car, update() {} }],
    follow: 0,
    quality: 'high',
    graphics: { autoExposure: true, toneMapper: 'aces' },
    grade: { filmic: false },
    mode: 'chase',
    lighting: 'day',
    photo: null,
    gpLook: GP_PHOTOGRAPHIC,
    photoSky,
    environment,
    scene,
    camera: new T.PerspectiveCamera(),
    renderer: h.renderer,
    preparation: new PreparationTrace(),
    composer: {
      renderToScreen: true,
      passes: [] as Pass[],
      isLastEnabledPass(index: number) {
        return !this.passes.slice(index + 1).some((pass) => pass.enabled);
      },
      readBuffer: new T.WebGLRenderTarget(960, 600, { type: T.HalfFloatType }),
      writeBuffer: new T.WebGLRenderTarget(960, 600, { type: T.HalfFloatType }),
    },
    scenePass: {
      enabled: true,
      needsSwap: true,
      renderToScreen: false,
      prepare: vi.fn(async () => {}),
    },
    exposure: {
      enabled: true,
      needsSwap: false,
      renderToScreen: false,
      prepareMaterial: vi.fn(async () => {}),
    },
    preparePostProcessing: RacingRenderer.prototype.preparePostProcessing,
    circuit: { setMotorcyclePresentation() {} },
    venueLighting: { update() {} },
    bikeShells: { update() {} },
    setCars() {},
    warmShadowCasters() {},
    warmupFrames: 0,
    changeCamera(mode: string) {
      this.mode = mode;
    },
    reset() {},
    draw: vi.fn(() => {
      // Both retained warmup views ask for exactly this same held sky.
      expect(environment.update(h.renderer, scene, frame[H.CLOUD], 'day')).toBe(false);
    }),
    waitForPreparedFrame: vi.fn(async () => {}),
  };
  target.composer.passes = [target.scenePass, target.exposure] as unknown as Pass[];
  return {
    ...h,
    frame,
    target,
    sky,
    environment,
    photoSky,
    scene,
    submissions,
    async prepare() {
      return RacingRenderer.prototype.prepare.call(
        target as unknown as RacingRenderer,
        frame,
        () => {},
        () => false,
        async () => {},
        false,
      );
    },
    dispose() {
      environment.dispose();
      photoSky.dispose();
      sky.geometry.dispose();
      sky.material.dispose();
      target.composer.readBuffer.dispose();
      target.composer.writeBuffer.dispose();
    },
  };
}

it('removes only the unused generic sky captures and keeps every native GP sky submission', async () => {
  const generic = fixture(),
    snapshot = fixture();
  try {
    // Historical circuit-construction path: prepare the generic menu sky
    // before the actual session selects its GP photograph.
    await generic.photoSky.ready(MENU_CLOUD_COVER, 'day');
    generic.environment.update(generic.renderer, generic.scene, MENU_CLOUD_COVER, 'day');
    expect(generic.environment.captures).toBe(2);
    const unusedSubmissions = generic.submissions.length;
    const oldTexture = generic.scene.environment!;
    const oldEpoch = oldTexture.userData.aurelSkyEpoch;
    expect(await generic.prepare()).toBe(true);
    const before = snapshot.state(),
      frame = new Float32Array(snapshot.frame);
    expect(await snapshot.prepare()).toBe(true);
    expect(snapshot.state()).toEqual(before);
    expect(snapshot.frame).toEqual(frame);
    expect(snapshot.environment.captures).toBe(2);
    expect(generic.environment.captures).toBe(4);
    expect(snapshot.environment.blends).toBe(1);
    expect(generic.environment.blends).toBe(2);
    expect(generic.scene.environment?.userData.aurelSkyEpoch).not.toBe(oldEpoch);
    // Native six-face cameras, 256px bins, every blur/mip draw, photographed
    // sampler bindings and the final linear blend are unchanged.
    expect(snapshot.submissions).toEqual(generic.submissions.slice(unusedSubmissions));
    const skyDraws = snapshot.submissions.filter((draw) => 'sky' in draw && draw.sky !== null);
    expect(skyDraws).toHaveLength(12);
    for (const view of [generic, snapshot]) {
      expect(view.environment.diagnostics()).toMatchObject({
        cover: MENU_CLOUD_COVER,
        cachedBins: [0, 1],
        size: 256,
        retainedTargets: 4,
      });
      expect(view.target.draw).toHaveBeenCalledTimes(2);
      expect(view.target.waitForPreparedFrame).toHaveBeenCalledTimes(2);
      expect(view.target.preparation.snapshot()?.status).toBe('complete');
      const owned = view.environment as unknown as {
        cached: Map<number, T.WebGLRenderTarget>;
        outputs: T.WebGLRenderTarget[];
      };
      const disposed = [...owned.cached.values(), ...owned.outputs].map((target) => {
        const listener = vi.fn();
        target.addEventListener('dispose', listener);
        return listener;
      });
      view.environment.dispose();
      expect(view.scene.environment).toBeNull();
      view.environment.dispose();
      for (const listener of disposed) expect(listener).toHaveBeenCalledOnce();
    }
  } finally {
    generic.dispose();
    snapshot.dispose();
  }
});
