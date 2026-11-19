import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FestivalFramePipeline } from '../src/rendering/open-world/festival-frame-pipeline.ts';
import { FestivalRenderer } from '../src/rendering/open-world/festival-renderer.ts';
import { FESTIVAL_SHADOWS, FestivalShadows } from '../src/rendering/open-world/festival-shadows.ts';
import { TerrainStreamer } from '../src/rendering/open-world/terrain.ts';
import { graphicsPreset } from '../src/rendering/options.ts';
import { studioUniforms } from '../src/rendering/studio/studio-frame.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import type {
  TileMeshData,
  TileRequest,
  ToTileWorker,
} from '../src/workers/open-world-protocol.ts';

function mockRenderer(supported = true) {
  let target: T.WebGLRenderTarget | null = null;
  const renderer = {
    autoClear: true,
    shadowMap: { enabled: true, autoUpdate: true },
    toneMappingExposure: 1,
    capabilities: { maxTextureSize: 4096, maxSamples: 4 },
    extensions: { has: () => supported },
    getPixelRatio: () => 1,
    getSize: (v: T.Vector2) => v.set(320, 180),
    getDrawingBufferSize: (v: T.Vector2) => v.set(320, 180),
    getRenderTarget: () => target,
    setRenderTarget: (t: T.WebGLRenderTarget | null) => {
      target = t;
    },
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getContext: () => ({ isContextLost: () => false }),
    render: vi.fn((scene: T.Object3D) => {
      scene.traverseVisible((object) => {
        if (!(object instanceof T.DirectionalLight) || !object.castShadow) return;
        if (!object.shadow.autoUpdate && !object.shadow.needsUpdate) return;
        object.shadow.map ??= new T.WebGLRenderTarget(1, 1);
        object.shadow.needsUpdate = false;
      });
    }),
    readRenderTargetPixelsAsync: vi.fn(
      async (
        _target: T.WebGLRenderTarget,
        _x: number,
        _y: number,
        _w: number,
        _h: number,
        pixels: Uint8Array,
      ) => {
        for (let i = 0; i < pixels.length; i += 4) {
          pixels[i] = 75; // A uniformly dark scene: bounded positive adaptation.
          pixels[i + 3] = 255;
        }
        return pixels;
      },
    ),
  };
  return { renderer: renderer as unknown as T.WebGLRenderer, mock: renderer };
}

function frame(time = 10) {
  const p = new Float32Array(HEADER + CAR_STRIDE);
  p[H.TIME] = time;
  p[H.CARS] = 1;
  p[carBase(0) + F.Y] = 0.6;
  p[carBase(0) + F.QW] = 1;
  p[carBase(0) + F.VZ] = 50;
  p[carBase(0) + F.SPEED] = 50;
  return p;
}

function imageHost(supported = true) {
  const mock = mockRenderer(supported);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(57, 16 / 9, 0.3, 26000);
  camera.position.set(0, 2, -6);
  camera.lookAt(0, 1, 20);
  camera.updateMatrixWorld();
  const sun = new T.DirectionalLight();
  sun.position.set(-100, 200, -100);
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
  scene.add(sun, sun.target);
  const composer = new EffectComposer(mock.renderer);
  const graphics = { ...graphicsPreset('medium'), ambientOcclusion: false };
  const image = new FestivalFramePipeline(mock.renderer, camera, sun, scene, composer, graphics);
  const output = new OutputPass();
  composer.addPass(output);
  const prepare = (p = frame(), photo = false, reduced = false, cut = false, view = 'chase') =>
    image.prepare(p, graphics, 'day', view, 0, photo, cut, 1, reduced);
  return { ...mock, scene, camera, sun, composer, graphics, image, output, prepare };
}

describe('Festival production frame pipeline', () => {
  it('meters linear scene colour before output and actually gathers the configured motion in the scene pass', async () => {
    const h = imageHost();
    expect(h.composer.passes).toEqual([h.image.scenePass, h.image.exposure, h.output]);
    h.prepare();
    h.image.scenePass.setSize(320, 180);
    h.image.scenePass.render(h.renderer, h.composer.writeBuffer);
    expect(h.image.diagnostics().scenePass.motionBlur).toBe(true);
    expect(h.image.diagnostics().motionBlur.velocityFrames).toBe(1);
    expect(h.image.motion.uniforms.motionActive.value).toBe(1);
    const road = new T.Vector3(3.5, 0, 4);
    expect(
      h.image.motion.field.pixels(road, h.camera, new T.Vector2(320, 180)).length(),
    ).toBeGreaterThan(0.5);
    expect(
      studioUniforms.studioSunDir.value.distanceTo(h.sun.position.clone().normalize()),
    ).toBeLessThan(1e-6);
    h.image.exposure.render(h.renderer, h.composer.writeBuffer, h.composer.readBuffer);
    await vi.waitFor(() => expect(h.image.exposure.diagnostics().samples).toBe(1));
    h.prepare(frame(10.25));
    expect(h.renderer.toneMappingExposure).toBeGreaterThan(1);
    expect(h.renderer.toneMappingExposure).toBeLessThanOrEqual(2 ** 0.85);
    expect(h.image.studioFrame.diagnostics().frameDt).toBeCloseTo(0.25);
    h.image.dispose();
    h.composer.dispose();
  });

  it('keeps held live frames stable and resets camera history on travel and view changes', () => {
    const h = imageHost();
    h.prepare(frame(10));
    h.prepare(frame(10.02));
    expect(h.image.studioFrame.diagnostics().frameDt).toBeGreaterThan(0);
    const previous = h.image.motion.uniforms.motionWorldPrev.value.clone();
    h.prepare(frame(10.02));
    expect(h.image.studioFrame.diagnostics().frameDt).toBe(0);
    expect(h.image.motion.uniforms.motionWorldPrev.value.equals(previous)).toBe(true);
    h.prepare(frame(10.04), false, false, true);
    expect(h.image.studioFrame.diagnostics().frameDt).toBe(0);
    expect(
      studioUniforms.studioPrevViewProj.value.equals(studioUniforms.studioViewProj.value),
    ).toBe(true);
    h.prepare(frame(10.06), false, false, false, 'hood');
    expect(h.image.studioFrame.diagnostics().view).toContain(':hood:');
    expect(h.image.motion.diagnostics().camera).toBe('attached');
    expect(h.image.studioFrame.diagnostics().frameDt).toBe(0);
    h.image.dispose();
    h.composer.dispose();
  });

  it('honours photo, reduced-motion and disabled options, restoring live motion without stale temporal history', () => {
    const h = imageHost();
    h.prepare();
    h.prepare(frame(10.1), false, true);
    expect(h.image.motion.uniforms.motionActive.value).toBe(0);
    expect(h.image.exposure.diagnostics().active).toBe(true);
    expect(h.image.studioFrame.diagnostics().frameDt).toBe(0);
    h.prepare(frame(10.2), false, false);
    expect(h.image.motion.uniforms.motionActive.value).toBe(1);
    expect(h.image.studioFrame.diagnostics().frameDt).toBe(0);
    h.prepare(frame(10.3), true);
    expect(h.image.motion.enabled).toBe(false);
    expect(h.image.exposure.diagnostics().active).toBe(false);
    expect(h.renderer.toneMappingExposure).toBe(1);
    h.prepare(frame(10.4));
    expect(h.image.motion.enabled).toBe(true);
    expect(h.image.exposure.diagnostics().active).toBe(true);
    h.graphics.motionBlur = 0;
    h.graphics.autoExposure = false;
    h.image.configure(h.graphics);
    h.prepare(frame(10.5));
    expect(h.image.motion.uniforms.motionActive.value).toBe(0);
    expect(h.image.exposure.diagnostics().active).toBe(false);
    h.image.dispose();
    h.composer.dispose();
  });

  it('falls back without float buffers and disposes once without disposing the shared renderer', () => {
    const h = imageHost(false);
    h.prepare();
    expect(h.image.motion.enabled).toBe(false);
    expect(h.image.exposure.diagnostics().active).toBe(true);
    const sceneDispose = vi.spyOn(h.image.scenePass, 'dispose');
    h.image.dispose();
    h.image.dispose();
    h.prepare(frame(11));
    expect(sceneDispose).toHaveBeenCalledTimes(1);
    expect(h.image.exposure.diagnostics().active).toBe(false);
    expect(h.image.motion.enabled).toBe(false);
    h.composer.dispose();
  });

  it('discards an in-flight meter result after disposal and cannot be re-enabled', async () => {
    const h = imageHost();
    let release = () => {};
    const completion = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.mock.readRenderTargetPixelsAsync.mockImplementationOnce(
      async (_target, _x, _y, _w, _h, pixels) => {
        await completion;
        pixels.fill(255);
        return pixels;
      },
    );
    h.prepare();
    h.image.exposure.render(h.renderer, h.composer.writeBuffer, h.composer.readBuffer);
    expect(h.image.exposure.diagnostics().pending).toBe(true);
    h.image.dispose();
    release();
    await vi.waitFor(() => expect(h.image.exposure.diagnostics().pending).toBe(false));
    h.image.configure({ ...h.graphics, temporalAA: true });
    h.prepare(frame(11));
    expect(h.image.exposure.diagnostics()).toMatchObject({ active: false, samples: 0 });
    expect(h.image.scenePass.temporal.diagnostics().enabled).toBe(false);
    expect(h.image.motion.enabled).toBe(false);
    h.composer.dispose();
  });

  it('resets the real frame pipeline through Festival camera, photo and resize entry points', () => {
    const h = imageHost();
    const reset = vi.spyOn(h.image, 'reset');
    const fixture = Object.assign(Object.create(FestivalRenderer.prototype), {
      imagePipeline: h.image,
      renderer: h.renderer,
      camera: h.camera,
      composer: h.composer,
      canvas: { clientWidth: 320, clientHeight: 180 },
      graphics: h.graphics,
      fxaa: { uniforms: { resolution: { value: new T.Vector2() } } },
      target: new T.Vector3(),
      audioView: { reset: vi.fn() },
      orbit: { enabled: false, target: new T.Vector3(), update: vi.fn() },
      photo: false,
      mode: 'chase',
    }) as FestivalRenderer;
    vi.stubGlobal('devicePixelRatio', 1);
    try {
      fixture.changeCamera('hood');
      fixture.setPhoto(true);
      fixture.setPhoto(false);
      fixture.resize();
      expect(reset).toHaveBeenCalledTimes(4);
      expect(h.image.motion.diagnostics()).toMatchObject({ width: 320, height: 180 });
    } finally {
      vi.unstubAllGlobals();
      h.image.dispose();
      h.composer.dispose();
    }
  });
});

function shadowHost() {
  const mock = mockRenderer();
  const scene = new T.Scene();
  const sun = new T.DirectionalLight();
  sun.castShadow = true;
  scene.add(sun, sun.target);
  const shadows = new FestivalShadows(mock.renderer, scene, sun);
  shadows.configure(2048);
  const terrain = new T.Group();
  const ground = new T.Mesh(new T.BoxGeometry(1000, 600, 1000));
  ground.position.y = 200;
  ground.geometry.computeBoundingBox();
  terrain.add(ground);
  const tree = new T.Mesh(new T.BoxGeometry(2, 8, 2));
  const moving = new T.Group();
  scene.add(terrain, tree, moving);
  const frame = {
    subject: new T.Vector3(),
    lighting: 'day' as const,
    terrainRevision: 1,
    dt: 1 / 60,
    terrain,
    planting: [tree],
    hidden: [moving],
  };
  return { ...mock, scene, sun, shadows, terrain, ground, tree, moving, frame };
}

describe('Festival streamed static shadows', () => {
  it('installs shadow light 1, fits actual terrain relief, hides movers and restores caster state after baking', () => {
    const h = shadowHost();
    const seen: boolean[] = [];
    h.mock.render.mockImplementationOnce(() => {
      seen.push(h.ground.castShadow, h.tree.castShadow, h.moving.visible, h.sun.shadow.autoUpdate);
    });
    expect(h.shadows.update(h.frame)).toBe(true);
    expect(h.scene.children.filter((o) => o instanceof T.DirectionalLight)).toEqual([
      h.sun,
      h.shadows.far.light,
    ]);
    expect(seen).toEqual([true, true, false, false]);
    expect(h.ground.castShadow).toBe(false);
    expect(h.tree.castShadow).toBe(false);
    expect(h.moving.visible).toBe(true);
    expect(h.sun.shadow.autoUpdate).toBe(true);
    expect(h.shadows.bounds.max.y).toBeGreaterThanOrEqual(548);
    expect(h.shadows.bounds.getSize(new T.Vector3()).x).toBe(FESTIVAL_SHADOWS.halfExtent * 2);
    expect(h.shadows.far.baked).toBe(true);
    h.shadows.dispose();
  });

  it('coalesces tile churn, keeps a stationary map and settles pending tiles even with a held simulation', () => {
    const h = shadowHost();
    h.shadows.update(h.frame);
    for (let i = 0; i < 60; i++) {
      h.frame.terrainRevision++;
      h.shadows.update(h.frame);
    }
    expect(h.shadows.far.bakes).toBe(2);
    expect(h.shadows.diagnostics().pending).toBe(true);
    for (let i = 0; i < 60; i++) h.shadows.update(h.frame);
    expect(h.shadows.far.bakes).toBe(3);
    expect(h.shadows.diagnostics().pending).toBe(false);
    for (let i = 0; i < 120; i++) h.shadows.update(h.frame);
    expect(h.shadows.far.bakes).toBe(3);
    h.shadows.dispose();
  });

  it('preserves a pending middle-map request for the main scene, with moving objects visible', () => {
    const h = shadowHost();
    const mid = new T.DirectionalLight();
    mid.castShadow = true;
    mid.shadow.autoUpdate = false;
    mid.shadow.needsUpdate = true;
    h.scene.add(mid);
    h.shadows.update(h.frame);
    expect(mid.shadow.map).toBeNull();
    expect(mid.shadow.needsUpdate).toBe(true);
    expect(mid.shadow.autoUpdate).toBe(false);
    h.renderer.render(h.scene, new T.PerspectiveCamera());
    expect(mid.shadow.map).not.toBeNull();
    expect(h.moving.visible).toBe(true);
    h.shadows.dispose();
    h.shadows.dispose();
    expect(h.shadows.update(h.frame)).toBe(false);
  });

  it('refreshes immediately on travel, relighting and quality changes, and does no work when shadows are off', () => {
    const h = shadowHost();
    h.shadows.update(h.frame);
    h.frame.subject.x = 10000;
    expect(h.shadows.update(h.frame)).toBe(true);
    expect(h.shadows.bounds.containsPoint(h.frame.subject)).toBe(true);
    expect(h.shadows.update({ ...h.frame, lighting: 'sunset' })).toBe(true);
    h.shadows.configure(4096);
    expect(h.shadows.update(h.frame)).toBe(true);
    expect(h.shadows.far.light.shadow.mapSize.x).toBe(4096);
    h.shadows.configure(0);
    const bakes = h.shadows.far.bakes;
    h.frame.subject.x = -10000;
    expect(h.shadows.update(h.frame)).toBe(false);
    expect(h.shadows.far.bakes).toBe(bakes);
    h.shadows.dispose();
  });

  it('restores hidden movers and far-only casters after a failed shadow draw', () => {
    const h = shadowHost();
    h.mock.render.mockImplementationOnce(() => {
      throw new Error('GPU failure');
    });
    expect(() => h.shadows.update(h.frame)).toThrow('GPU failure');
    expect(h.moving.visible).toBe(true);
    expect(h.tree.castShadow).toBe(false);
    expect(h.ground.castShadow).toBe(false);
    expect(h.shadows.far.baked).toBe(false);
    expect(h.shadows.update(h.frame)).toBe(true);
    h.shadows.dispose();
  });
});

it('invalidates streamed shadows when displayed terrain changes, not merely when an unused child arrives', () => {
  let receive: (event: MessageEvent<TileMeshData>) => void = () => {};
  const pending: TileRequest[] = [];
  const worker = {
    addEventListener: (_type: string, listener: typeof receive) => {
      receive = listener;
    },
    removeEventListener: vi.fn(),
    postMessage: (message: ToTileWorker) => {
      if (message.type === 'tile') pending.push(message);
    },
  } as unknown as Worker;
  const terrain = new TerrainStreamer(worker);
  const camera = new T.PerspectiveCamera();
  camera.position.set(0, 1, 0);
  camera.updateMatrixWorld();
  const deliver = (request: TileRequest) => {
    const n = (request.res + 1) ** 2;
    receive({
      data: {
        type: 'tile',
        id: request.id,
        heights: new Float32Array(n),
        normals: new Float32Array(n * 3),
        splat: new Float32Array(n * 4),
        shade: new Float32Array(n * 4),
        trees: new Float32Array(),
        minY: 0,
        maxY: 0,
        ms: 1,
      },
    } as MessageEvent<TileMeshData>);
  };
  terrain.update(camera);
  expect(terrain.shadowRevision).toBe(0);
  deliver(pending.shift()!); // The coarse, covering tile is always first.
  terrain.update(camera);
  expect(terrain.shadowRevision).toBe(1);
  expect(terrain.stats.drawn).toBe(1);
  deliver(pending.shift()!); // One of four children cannot replace its parent.
  terrain.update(camera);
  expect(terrain.shadowRevision).toBe(1);
  const remaining = pending.splice(0);
  remaining.forEach(deliver);
  terrain.update(camera);
  // The bounded request queue now has room for the fourth child.
  pending.splice(0).forEach(deliver);
  terrain.update(camera);
  expect(terrain.stats.drawn).toBe(4);
  expect(terrain.shadowRevision).toBe(2);
  terrain.update(camera);
  expect(terrain.shadowRevision).toBe(2);
  terrain.dispose();
});
