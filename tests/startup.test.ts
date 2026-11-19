import * as T from 'three';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import { PreparationTrace } from '../src/rendering/preparation.ts';
import { expect, it, vi } from 'vitest';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import { CAR_STRIDE, HEADER, H, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import { rulesetFor } from '../src/simulation/events.ts';
import type { SessionOptions } from '../src/simulation/config.ts';
import { VenueLighting } from '../src/rendering/venue-lighting.ts';
import { Track } from '../src/simulation/track.ts';
import type { LightingMode } from '../src/rendering/daylight.ts';
import { DEFAULT_PHOTO, type PhotoSettings } from '../src/rendering/photo-camera.ts';
import { RecordedSignalDisplays } from '../src/rendering/recorded-signal-displays.ts';
import { GP_PHOTOGRAPHIC } from '../src/rendering/gp-photographic-light.ts';

function fixture(vehicle = 'apx01', entrants = 3) {
  const calls: string[] = [];
  // Match the native renderer's material ownership table and retained-program
  // list. Startup now initializes linked-program metadata before drawing.
  const materialProperties = new WeakMap<
    T.Material,
    { programs?: Map<string, T.WebGLProgram>; uniforms?: Record<string, T.IUniform> }
  >();
  let bound: T.WebGLRenderTarget | null = null;
  const sample = new Float32Array(HEADER + CAR_STRIDE * entrants);
  sample[H.CARS] = entrants;
  sample[H.TIME] = 0;
  const follow = 1;
  sample[carBase(follow) + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
  const target = {
    disposed: false,
    cars: [] as { root: T.Group; update: ReturnType<typeof vi.fn> }[],
    follow,
    quality: 'high',
    graphics: { autoExposure: true, toneMapper: 'aces' },
    gpLook: GP_PHOTOGRAPHIC,
    grade: { filmic: false },
    bikeShells: {
      update: vi.fn(() => {
        calls.push('bike-materials');
      }),
    },
    circuit: {
      signalHardware: null as { displays: RecordedSignalDisplays } | null,
      setMotorcyclePresentation: vi.fn((enabled: boolean) => {
        calls.push(`motorcycle-surface:${enabled}`);
      }),
    },
    scene: new T.Scene(),
    camera: new T.PerspectiveCamera(),
    lighting: 'day' as LightingMode,
    photo: null as PhotoSettings | null,
    environment: {
      update: vi.fn(() => {
        calls.push('snapshot-sky');
      }),
    },
    venueLighting: {
      update: vi.fn((_night: boolean, _anchor: T.Vector3, _strength: number) => {
        calls.push('venue-lighting');
      }),
    },
    mode: 'pod',
    preparation: new PreparationTrace(),
    composer: {
      renderToScreen: true,
      passes: [] as Pass[],
      isLastEnabledPass(index: number) {
        return !this.passes.slice(index + 1).some((pass) => pass.enabled);
      },
      readBuffer: new T.WebGLRenderTarget(8, 8, { type: T.HalfFloatType }),
      writeBuffer: new T.WebGLRenderTarget(8, 8, { type: T.HalfFloatType }),
    },
    scenePass: {
      enabled: true,
      needsSwap: true,
      renderToScreen: false,
      prepare: vi.fn(
        async (
          _renderer: T.WebGLRenderer,
          _writeBuffer: T.WebGLRenderTarget,
          _cancelled: () => boolean,
        ) => {
          calls.push('post-materials');
        },
      ),
    },
    exposure: {
      enabled: true,
      needsSwap: false,
      renderToScreen: false,
      prepareMaterial: vi.fn(async () => {
        calls.push('exposure-material');
      }),
    },
    warmupFrames: 0,
    preparePostProcessing: RacingRenderer.prototype.preparePostProcessing,
    waitForPreparedFrame: vi.fn(async () => {
      calls.push('gpu-ready');
    }),
    warmPitPresentation: vi.fn(async () => {
      calls.push('pit-materials');
    }),
    warmShadowCasters: vi.fn(() => {
      calls.push('shadow-casters');
    }),
    setCars(n: number) {
      while (this.cars.length < n) {
        const root = new T.Group();
        this.scene.add(root);
        this.cars.push({ root, update: vi.fn() });
      }
      calls.push(`cars:${n}`);
    },
    renderer: {
      properties: {
        get(material: T.Material) {
          let properties = materialProperties.get(material);
          if (!properties) {
            properties = {};
            materialProperties.set(material, properties);
          }
          return properties;
        },
      },
      info: { programs: [] as T.WebGLProgram[] },
      getRenderTarget: () => bound,
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      getViewport: (v: T.Vector4) => v.set(0, 0, 100, 100),
      getScissor: (v: T.Vector4) => v.set(0, 0, 100, 100),
      getScissorTest: () => false,
      setRenderTarget: (value: T.WebGLRenderTarget | null) => {
        bound = value;
      },
      setViewport: vi.fn(),
      setScissor: vi.fn(),
      setScissorTest: vi.fn(),
      compileAsync: vi.fn(async (_scene: T.Object3D, _camera: T.Camera, _targetScene?: T.Scene) => {
        expect(bound).toBe(target.composer.readBuffer);
        calls.push('compile');
      }),
    },
    changeCamera(mode: string) {
      this.mode = mode;
      calls.push(mode);
    },
    reset: vi.fn(),
    draw: vi.fn(
      (
        a: Float32Array,
        b: Float32Array,
        _alpha: number,
        _dt: number,
        menu: boolean,
        replay: boolean,
      ) => {
        expect(a).toBe(sample);
        expect(b[H.TIME]).toBe(0);
        expect(menu).toBe(false);
        expect(replay).toBe(true);
        calls.push('draw');
      },
    ),
  };
  target.composer.passes = [target.scenePass, target.exposure] as unknown as Pass[];
  return { target, calls, sample, typed: target as unknown as RacingRenderer };
}

function linkedProgramFixture() {
  const result = fixture('gpr1');
  const { target, calls } = result;
  const geometry = new T.BufferGeometry(),
    material = new T.MeshStandardMaterial();
  target.scene.add(new T.Mesh(geometry, material));
  const getUniforms = vi.fn(() => {
    calls.push('program-metadata');
    return { seq: [] as { id: string; type: number }[] };
  });
  const program = { usedTimes: 1, getUniforms } as unknown as T.WebGLProgram;
  const compile = target.renderer.compileAsync.getMockImplementation()!;
  target.renderer.compileAsync.mockImplementation((...args) => {
    // Native compileAsync acquires programs synchronously before awaiting
    // parallel compilation; the preparation owner snapshots that ownership.
    target.renderer.properties.get(material).programs = new Map([['scene', program]]);
    if (!target.renderer.info.programs.includes(program))
      target.renderer.info.programs.push(program);
    return compile(...args);
  });
  return {
    ...result,
    material,
    getUniforms,
    dispose() {
      geometry.dispose();
      material.dispose();
      target.composer.readBuffer.dispose();
      target.composer.writeBuffer.dispose();
    },
  };
}

it('prepares retained scene metadata before drawing and still waits for both GPU views', async () => {
  const { target, typed, sample, calls, getUniforms, dispose } = linkedProgramFixture();
  try {
    expect(
      await RacingRenderer.prototype.prepare.call(
        typed,
        sample,
        vi.fn(),
        () => false,
        async () => {},
      ),
    ).toBe(true);
    expect(getUniforms).toHaveBeenCalledTimes(3);
    expect(calls.indexOf('program-metadata')).toBeGreaterThan(calls.indexOf('compile'));
    expect(calls.indexOf('program-metadata')).toBeLessThan(calls.indexOf('draw'));
    expect(calls.indexOf('exposure-material')).toBeGreaterThan(calls.indexOf('post-materials'));
    expect(calls.indexOf('exposure-material')).toBeLessThan(calls.indexOf('draw'));
    expect(target.draw).toHaveBeenCalledTimes(2);
    expect(target.waitForPreparedFrame).toHaveBeenCalledTimes(2);
    expect(target.preparation.snapshot()?.status).toBe('complete');
    expect(target.renderer.getRenderTarget()).toBeNull();
  } finally {
    dispose();
  }
});

it.each([false, true])(
  'prepares retained textures before shadow/probe draws and honors texture-stage cancellation=%s',
  async (cancelAtTextures) => {
    const { target, typed, sample, calls, material, getUniforms, dispose } = linkedProgramFixture();
    const map = new T.DataTexture(new Uint8Array(16), 2, 2);
    map.userData.normalResidency = 'decoded-rgba8';
    map.needsUpdate = true;
    material.map = map;
    target.renderer.properties.get(material).uniforms = { map: { value: null } };
    getUniforms.mockImplementation(() => {
      calls.push('program-metadata');
      return { seq: [{ id: 'map', type: 0x8b5e }] };
    });
    const upload = vi.fn((texture: T.Texture) => {
      expect(texture).toBe(map);
      calls.push('scene-texture');
    });
    Object.assign(target.renderer, { initTexture: upload });
    let cancelled = false;
    try {
      expect(
        await RacingRenderer.prototype.prepare.call(
          typed,
          sample,
          (label) => {
            if (cancelAtTextures && label === 'Preparing retained scene textures…')
              cancelled = true;
          },
          () => cancelled,
          async () => {},
        ),
      ).toBe(!cancelAtTextures);
      expect(upload).toHaveBeenCalledTimes(cancelAtTextures ? 0 : 1);
      expect(target.draw).toHaveBeenCalledTimes(cancelAtTextures ? 0 : 2);
      expect(target.waitForPreparedFrame).toHaveBeenCalledTimes(cancelAtTextures ? 0 : 2);
      if (!cancelAtTextures) {
        expect(calls.indexOf('scene-texture')).toBeGreaterThan(calls.indexOf('program-metadata'));
        expect(calls.indexOf('scene-texture')).toBeGreaterThan(calls.indexOf('exposure-material'));
        expect(calls.indexOf('scene-texture')).toBeLessThan(calls.indexOf('shadow-casters'));
        expect(calls.indexOf('scene-texture')).toBeLessThan(calls.indexOf('draw'));
      }
      expect(target.preparation.snapshot()?.status).toBe(
        cancelAtTextures ? 'cancelled' : 'complete',
      );
    } finally {
      map.dispose();
      dispose();
    }
  },
);

it.each(['disabled', 'photo'] as const)(
  'does not prepare an inactive exposure meter when %s',
  async (state) => {
    const { target, typed, sample } = fixture();
    if (state === 'disabled') target.graphics.autoExposure = false;
    else target.photo = { ...DEFAULT_PHOTO };
    expect(
      await RacingRenderer.prototype.prepare.call(
        typed,
        sample,
        vi.fn(),
        () => false,
        async () => {},
      ),
    ).toBe(true);
    expect(target.exposure.prepareMaterial).not.toHaveBeenCalled();
    expect(target.draw).toHaveBeenCalledTimes(2);
    expect(target.waitForPreparedFrame).toHaveBeenCalledTimes(2);
  },
);

it('rejects retained program metadata failure before any startup draw', async () => {
  const { target, typed, sample, getUniforms, dispose } = linkedProgramFixture();
  getUniforms.mockImplementationOnce(() => {
    throw new Error('Scene metadata failed');
  });
  try {
    await expect(
      RacingRenderer.prototype.prepare.call(
        typed,
        sample,
        vi.fn(),
        () => false,
        async () => {},
      ),
    ).rejects.toThrow('Scene metadata failed');
    expect(target.draw).not.toHaveBeenCalled();
    expect(target.waitForPreparedFrame).not.toHaveBeenCalled();
    expect(target.preparation.snapshot()?.error).toBe('Scene metadata failed');
    expect(target.preparation.snapshot()?.status).toBe('failed');
    expect(target.renderer.getRenderTarget()).toBeNull();
  } finally {
    dispose();
  }
});

it.each([
  { vehicle: 'gpr1', lighting: 'day', studio: false, clearDay: GP_PHOTOGRAPHIC.clearSky },
  { vehicle: 'gpr1', lighting: 'sunset', studio: false, clearDay: GP_PHOTOGRAPHIC.clearSky },
  { vehicle: 'gpr1', lighting: 'night', studio: false, clearDay: null },
  { vehicle: 'gpr1', lighting: 'night', studio: true, clearDay: null },
  { vehicle: 'apx01', lighting: 'day', studio: false, clearDay: null },
  { vehicle: 'mx450', lighting: 'day', studio: false, clearDay: null },
] as const)(
  'prepares the followed $vehicle sky at $lighting / studio=$studio before compiling the scene',
  async ({ vehicle, lighting, studio, clearDay }) => {
    // The other two entrants retain their Formula identities: selection must
    // follow the actual rendered subject, not require a homogeneous GP grid.
    const { target, typed, sample, calls } = fixture(vehicle);
    sample[H.CLOUD] = 0.37;
    target.lighting = lighting;
    if (studio) target.photo = { ...DEFAULT_PHOTO, backdrop: 'studio' };
    const illumination = studio ? 'day' : lighting;
    const photoSky = {
      enabled: true,
      clearDay: 'previous sky' as string | null,
      ready: vi.fn(async (cover: number, mode: LightingMode) => {
        expect(photoSky.clearDay).toBe(clearDay);
        expect([cover, mode]).toEqual([sample[H.CLOUD], illumination]);
        calls.push('photo-ready');
      }),
    };
    Object.assign(target, { photoSky, gpLook: GP_PHOTOGRAPHIC });
    const before = new Float32Array(sample);
    expect(
      await RacingRenderer.prototype.prepare.call(
        typed,
        sample,
        vi.fn(),
        () => false,
        async () => {},
      ),
    ).toBe(true);
    expect(target.environment.update).toHaveBeenCalledExactlyOnceWith(
      target.renderer,
      target.scene,
      sample[H.CLOUD],
      illumination,
    );
    expect(calls.indexOf('snapshot-sky')).toBeGreaterThan(calls.indexOf('photo-ready'));
    expect(calls.indexOf('snapshot-sky')).toBeLessThan(calls.indexOf('compile'));
    const filmic = vehicle === 'gpr1' && !studio && lighting !== 'night';
    expect(typed.renderer.toneMapping).toBe(filmic ? T.AgXToneMapping : T.ACESFilmicToneMapping);
    expect(target.grade.filmic).toBe(filmic);
    expect(target.draw).toHaveBeenCalledTimes(2);
    expect(target.waitForPreparedFrame).toHaveBeenCalledTimes(2);
    expect(sample).toEqual(before);
  },
);

it.each(['cancelled', 'disposed'] as const)(
  'does no sky capture or native scene work if %s at the recorded-sky yield',
  async (state) => {
    const { target, typed, sample } = fixture();
    let cancelled = false;
    expect(
      await RacingRenderer.prototype.prepare.call(
        typed,
        sample,
        (label) => {
          if (label === 'Preparing recorded sky lighting…') {
            if (state === 'cancelled') cancelled = true;
            else target.disposed = true;
          }
        },
        () => cancelled,
        async () => {},
      ),
    ).toBe(false);
    expect(target.environment.update).not.toHaveBeenCalled();
    expect(target.renderer.compileAsync).not.toHaveBeenCalled();
    expect(target.draw).not.toHaveBeenCalled();
    expect(target.waitForPreparedFrame).not.toHaveBeenCalled();
    expect(target.preparation.snapshot()?.status).toBe('cancelled');
  },
);

it('reports an actual sky-capture failure before scene compilation or readiness', async () => {
  const { target, typed, sample } = fixture();
  target.environment.update.mockImplementationOnce(() => {
    throw new Error('Recorded sky capture failed');
  });
  await expect(
    RacingRenderer.prototype.prepare.call(
      typed,
      sample,
      vi.fn(),
      () => false,
      async () => {},
    ),
  ).rejects.toThrow('Recorded sky capture failed');
  expect(target.renderer.compileAsync).not.toHaveBeenCalled();
  expect(target.draw).not.toHaveBeenCalled();
  expect(target.waitForPreparedFrame).not.toHaveBeenCalled();
  expect(target.preparation.snapshot()).toMatchObject({
    status: 'failed',
    error: 'Recorded sky capture failed',
  });
});

it('selects the recorded marshal display material before the first scene compile', async () => {
  const { target, typed, sample } = fixture();
  const displays = new RecordedSignalDisplays(),
    geometry = new T.BoxGeometry(0.09, 0.72, 1.15),
    original = new T.MeshStandardMaterial(),
    panel = new T.Mesh(geometry, original);
  displays.bind(panel, 0);
  target.circuit.signalHardware = { displays };
  target.scene.add(panel);
  sample[H.LENGTH] = 3000;
  const before = sample.slice();
  const compile = target.renderer.compileAsync.getMockImplementation()!;
  target.renderer.compileAsync.mockImplementation((...args) => {
    expect(panel.material).toBe(displays.materials[0]);
    return compile(...args);
  });
  try {
    expect(panel.material).toBe(original);
    expect(
      await RacingRenderer.prototype.prepare.call(
        typed,
        sample,
        vi.fn(),
        () => false,
        async () => {},
      ),
    ).toBe(true);
    expect(target.renderer.compileAsync).toHaveBeenCalledTimes(3);
    expect(target.draw).toHaveBeenCalledTimes(2);
    expect(target.waitForPreparedFrame).toHaveBeenCalledTimes(2);
    expect(panel.material).toBe(displays.materials[0]);
    expect(sample).toEqual(before);
  } finally {
    displays.dispose();
    geometry.dispose();
    original.dispose();
    target.composer.readBuffer.dispose();
    target.composer.writeBuffer.dispose();
  }
});

it('finishes pass-owned preparation before warming either view and preserves both GPU waits', async () => {
  const { target, typed, sample, calls } = fixture();
  let finish: () => void = () => {};
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  target.scenePass.prepare.mockImplementation((renderer, buffer, stopped) => {
    expect(renderer).toBe(target.renderer);
    expect(buffer).toBe(target.composer.writeBuffer);
    expect(stopped()).toBe(false);
    calls.push('post-start');
    entered();
    return new Promise<void>((resolve) => {
      finish = () => {
        calls.push('post-finish');
        resolve();
      };
    });
  });
  const pending = RacingRenderer.prototype.prepare.call(
    typed,
    sample,
    vi.fn(),
    () => false,
    async () => {},
  );
  await started;
  expect(target.draw).not.toHaveBeenCalled();
  expect(target.warmShadowCasters).not.toHaveBeenCalled();
  expect(target.waitForPreparedFrame).not.toHaveBeenCalled();
  finish();
  expect(await pending).toBe(true);
  expect(target.scenePass.prepare).toHaveBeenCalledOnce();
  expect(calls.indexOf('post-finish')).toBeLessThan(calls.indexOf('draw'));
  expect(target.draw).toHaveBeenCalledTimes(2);
  expect(target.waitForPreparedFrame).toHaveBeenCalledTimes(2);
  target.composer.readBuffer.dispose();
  target.composer.writeBuffer.dispose();
});

it.each(['cancelled', 'disposed'] as const)(
  'does not warm a view after pass preparation is %s',
  async (reason) => {
    const { target, typed, sample } = fixture();
    let cancelled = false;
    target.scenePass.prepare.mockImplementation(async (_renderer, _buffer, stopped) => {
      expect(stopped()).toBe(false);
      if (reason === 'disposed') target.disposed = true;
      else cancelled = true;
      expect(stopped()).toBe(true);
    });
    expect(
      await RacingRenderer.prototype.prepare.call(
        typed,
        sample,
        vi.fn(),
        () => cancelled,
        async () => {},
      ),
    ).toBe(false);
    expect(target.draw).not.toHaveBeenCalled();
    expect(target.waitForPreparedFrame).not.toHaveBeenCalled();
    expect(target.preparation.snapshot()?.status).toBe('cancelled');
    target.composer.readBuffer.dispose();
    target.composer.writeBuffer.dispose();
  },
);

it('rejects pass-owned shader preparation failure before any warmup draw', async () => {
  const { target, typed, sample } = fixture();
  target.scenePass.prepare.mockRejectedValue(new Error('Post material compilation failed'));
  await expect(
    RacingRenderer.prototype.prepare.call(
      typed,
      sample,
      vi.fn(),
      () => false,
      async () => {},
    ),
  ).rejects.toThrow('Post material compilation failed');
  expect(target.draw).not.toHaveBeenCalled();
  expect(target.waitForPreparedFrame).not.toHaveBeenCalled();
  expect(target.preparation.snapshot()?.status).toBe('failed');
  target.composer.readBuffer.dispose();
  target.composer.writeBuffer.dispose();
});

it.each([
  { lighting: 'day', studio: false, count: 0, strength: 1 },
  { lighting: 'sunset', studio: false, count: 4, strength: 0.18 },
  { lighting: 'night', studio: false, count: 4, strength: 1 },
  { lighting: 'night', studio: true, count: 0, strength: 1 },
] as const)(
  'compiles the first prepared view with its actual venue-light slots: $lighting / studio=$studio',
  async ({ lighting, studio, count, strength }) => {
    const { target, typed, sample, calls } = fixture();
    const venue = new VenueLighting(new Track());
    target.lighting = lighting;
    if (studio) target.photo = { ...DEFAULT_PHOTO, backdrop: 'studio' };
    target.scene.add(venue.root);
    target.setCars(3);
    target.cars[target.follow].root.position.set(30, 1, 20);
    const lightCount = () => {
      let value = 0;
      target.scene.traverseVisible((object) => {
        if ((object as T.PointLight).isPointLight) value++;
      });
      return value;
    };
    // Negative control: new zero-intensity slots are visible to Three's
    // compiler until the production update establishes the view's light list.
    expect(lightCount()).toBe(4);
    expect(venue.lights.every((light) => light.intensity === 0)).toBe(true);
    target.venueLighting.update.mockImplementation((night, anchor, value) => {
      calls.push('venue-lighting');
      venue.update(night, anchor, value);
    });
    const observations: number[] = [];
    target.renderer.compileAsync.mockImplementation(async () => {
      calls.push('compile');
      observations.push(lightCount());
    });
    const before = sample.slice();
    try {
      expect(
        await RacingRenderer.prototype.prepare.call(
          typed,
          sample,
          vi.fn(),
          () => false,
          async () => {},
        ),
      ).toBe(true);
      expect(observations).toEqual([count, count, count]);
      expect(target.venueLighting.update).toHaveBeenCalledExactlyOnceWith(
        count > 0,
        target.cars[target.follow].root.position,
        strength,
      );
      expect(calls.indexOf('venue-lighting')).toBeLessThan(calls.indexOf('compile'));
      expect(target.draw).toHaveBeenCalledTimes(2);
      expect(target.waitForPreparedFrame).toHaveBeenCalledTimes(2);
      expect(target.warmPitPresentation).toHaveBeenCalledTimes(1);
      expect(sample).toEqual(before);
      expect(target.preparation.snapshot()?.status).toBe('complete');
    } finally {
      const geometries = new Set<T.BufferGeometry>(),
        materials = new Set<T.Material>();
      venue.root.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          materials.add(material);
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      target.composer.readBuffer.dispose();
    }
  },
);
it.each([
  { label: 'MX250 gate', machines: Array<string>(8).fill('mx250') },
  { label: 'MX450 gate', machines: Array<string>(8).fill('mx450') },
  { label: 'mixed exhibition', machines: ['mx250', 'apx01', 'mx450', 'gpr1'] },
  { label: 'Formula grid', machines: ['apx01', 'apx01', 'apx01'] },
])(
  'keeps bike LODs and omits hidden Formula hosts during preparation: $label',
  async ({ machines }) => {
    const { target, typed, sample } = fixture(machines[1], machines.length),
      geometry = new T.BufferGeometry(),
      material = new T.MeshStandardMaterial(),
      retained: T.Object3D[] = [],
      omitted: T.Object3D[] = [];
    target.setCars(machines.length);
    const mesh = (parent: T.Object3D) => {
      const object = new T.Mesh(geometry, material);
      parent.add(object);
      return object;
    };
    retained.push(mesh(target.scene));
    const bikeRoots: T.Group[] = [];
    machines.forEach((machine, id) => {
      sample[carBase(id) + RACE_BASE + R.VEHICLE] = vehicleIndex(machine);
      const host = mesh(target.cars[id].root);
      if (machine === 'apx01') retained.push(host);
      else {
        omitted.push(host);
        const bike = new T.Group();
        bikeRoots.push(bike);
        target.scene.add(bike);
        // Low-distance LOD and service geometry are hidden now but may be
        // needed later. Only the unrelated Formula host may be omitted.
        for (let level = 0; level < 4; level++) {
          const detail = new T.Group();
          detail.visible = level === 0;
          bike.add(detail);
          retained.push(mesh(detail));
        }
      }
    });
    target.bikeShells.update.mockImplementation(() => {
      machines.forEach((machine, id) => {
        target.cars[id].root.visible = machine === 'apx01';
      });
    });
    target.draw.mockImplementation(() => {
      // Camera-specific equipment can appear during the chase/onboard warmup.
      // Each later compile must inspect the current tree, not a stale list.
      if (bikeRoots[0]) retained.push(mesh(bikeRoots[0]));
    });
    target.renderer.compileAsync.mockImplementation(async (view, camera, originalScene) => {
      expect(camera).toBe(target.camera);
      if (bikeRoots.length) {
        expect(view).not.toBe(target.scene);
        expect(originalScene).toBe(target.scene);
      } else {
        expect(view).toBe(target.scene);
        expect(originalScene).toBeUndefined();
      }
      const compiled: T.Object3D[] = [];
      view.traverse((object) => {
        if (object instanceof T.Mesh) compiled.push(object);
      });
      expect(new Set(compiled)).toEqual(new Set(retained));
      for (const object of omitted) expect(compiled).not.toContain(object);
      for (const car of target.cars) expect(car.root.parent).toBe(target.scene);
    });
    const before = sample.slice();
    try {
      expect(
        await RacingRenderer.prototype.prepare.call(
          typed,
          sample,
          vi.fn(),
          () => false,
          async () => {},
          false,
        ),
      ).toBe(true);
      expect(target.renderer.compileAsync).toHaveBeenCalledTimes(3);
      expect(target.waitForPreparedFrame).toHaveBeenCalledTimes(2);
      expect(target.warmShadowCasters).toHaveBeenCalledTimes(1);
      expect(target.preparation.snapshot()?.status).toBe('complete');
      expect(sample).toEqual(before);
    } finally {
      geometry.dispose();
      material.dispose();
      target.composer.readBuffer.dispose();
    }
  },
);
it.each([
  { vehicle: 'apx01', motorcycle: false, grandPrix: false },
  { vehicle: 'gpr1', motorcycle: true, grandPrix: true },
  { vehicle: 'gpr2', motorcycle: true, grandPrix: true },
  { vehicle: 'sbk1000', motorcycle: true, grandPrix: false },
  { vehicle: 'ss600', motorcycle: true, grandPrix: false },
  { vehicle: 'mx450', motorcycle: true, grandPrix: false },
])(
  'yields construction, compiles and warms $vehicle camera passes without modifying simulation time',
  async ({ vehicle, motorcycle, grandPrix }) => {
    const { target, typed, sample, calls } = fixture(vehicle);
    const yieldFrame = vi.fn(async () => {
      calls.push('yield');
    });
    expect(
      await RacingRenderer.prototype.prepare.call(typed, sample, vi.fn(), () => false, yieldFrame),
    ).toBe(true);
    expect(target.cars).toHaveLength(3);
    expect(target.renderer.compileAsync).toHaveBeenCalledTimes(3);
    expect(target.draw).toHaveBeenCalledTimes(2);
    expect(target.waitForPreparedFrame).toHaveBeenCalledTimes(2);
    expect(target.warmPitPresentation).toHaveBeenCalledTimes(1);
    expect(calls.indexOf('pit-materials')).toBeGreaterThan(calls.indexOf('draw'));
    expect(target.mode).toBe('pod');
    expect(target.warmupFrames).toBe(2);
    expect(target.preparation.snapshot()?.status).toBe('complete');
    expect(target.renderer.getRenderTarget()).toBeNull();
    expect(sample[H.TICK]).toBe(0);
    expect(target.bikeShells.update).toHaveBeenCalledExactlyOnceWith(
      sample,
      sample,
      1,
      target.cars,
      target.camera,
      target.quality,
      target.follow,
    );
    expect(target.circuit.setMotorcyclePresentation).toHaveBeenCalledExactlyOnceWith(
      motorcycle,
      grandPrix,
    );
    expect(calls.indexOf('bike-materials')).toBeLessThan(calls.indexOf('compile'));
    expect(calls.indexOf(`motorcycle-surface:${motorcycle}`)).toBeLessThan(
      calls.indexOf('compile'),
    );
    expect(calls.indexOf('compile')).toBeGreaterThan(calls.indexOf('cars:3'));
    expect(calls.indexOf('draw')).toBeGreaterThan(calls.indexOf('compile'));
    // Every caster's depth program compiles once, between material compiles
    // and the first warmup draw.
    expect(target.warmShadowCasters).toHaveBeenCalledTimes(1);
    expect(calls.indexOf('shadow-casters')).toBeGreaterThan(calls.indexOf('compile'));
    expect(calls.indexOf('shadow-casters')).toBeLessThan(calls.indexOf('draw'));
  },
);
it.each([
  { vehicle: 'mx450', mode: 'race', ruleset: 'motocross-moto', service: false },
  { vehicle: 'mx250', mode: 'race', ruleset: 'motocross-moto', service: false },
  { vehicle: 'mx450', mode: 'practice', ruleset: undefined, service: true },
  { vehicle: 'mx250', mode: 'time-trial', ruleset: undefined, service: true },
  { vehicle: 'gpr1', mode: 'race', ruleset: 'gp-motorcycle', service: true },
  { vehicle: 'apx01', mode: 'race', ruleset: 'formula-grand-prix', service: true },
])(
  'warms only reachable pit service while completing both GPU views: $vehicle / $mode / $ruleset',
  async ({ vehicle, mode, ruleset, service }) => {
    const { target, typed, sample } = fixture(vehicle);
    const before = sample.slice();
    const progress = vi.fn();
    const permitted = rulesetFor({ mode: mode as SessionOptions['mode'], ruleset }).service
      .pitStops;
    expect(permitted).toBe(service);
    expect(
      await RacingRenderer.prototype.prepare.call(
        typed,
        sample,
        progress,
        () => false,
        async () => {},
        permitted,
      ),
    ).toBe(true);
    expect(target.warmPitPresentation).toHaveBeenCalledTimes(service ? 1 : 0);
    const stages = progress.mock.calls.map(([message]) => String(message));
    expect(stages.some((message) => message.includes('pit-service'))).toBe(service);
    expect(target.renderer.compileAsync).toHaveBeenCalledTimes(3);
    expect(target.warmShadowCasters).toHaveBeenCalledTimes(1);
    expect(target.draw).toHaveBeenCalledTimes(2);
    expect(target.waitForPreparedFrame).toHaveBeenCalledTimes(2);
    expect(target.warmupFrames).toBe(2);
    expect(target.mode).toBe('pod');
    expect(sample).toEqual(before);
    expect(target.preparation.snapshot()?.status).toBe('complete');
  },
);
it('keeps the GPU completion gate when a no-service motocross warmup stalls', async () => {
  const { target, typed, sample } = fixture('mx450');
  target.waitForPreparedFrame.mockRejectedValueOnce(new Error('GPU preparation did not complete'));
  await expect(
    RacingRenderer.prototype.prepare.call(
      typed,
      sample,
      vi.fn(),
      () => false,
      async () => {},
      rulesetFor({ mode: 'race', ruleset: 'motocross-moto' }).service.pitStops,
    ),
  ).rejects.toThrow('GPU preparation did not complete');
  expect(target.warmPitPresentation).not.toHaveBeenCalled();
  expect(target.draw).toHaveBeenCalledTimes(1);
  expect(target.preparation.snapshot()?.status).toBe('failed');
  expect(target.mode).toBe('pod');
});
it.each([
  { vehicles: ['gpr1', 'gpr2', 'gpr1'], bikeBuilds: 0 },
  { vehicles: ['apx01', 'gpr1', 'gpr2'], bikeBuilds: 1 },
  { vehicles: ['mx450', 'mx450', 'mx450'], bikeBuilds: 1 },
])(
  'allows cancellation before motorcycle construction only for a complete GP field: $vehicles',
  async ({ vehicles, bikeBuilds }) => {
    const { target, typed, sample } = fixture(vehicles[1]);
    vehicles.forEach((vehicle, id) => {
      sample[carBase(id) + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
    });
    // Existing hosts isolate the new yield from the original per-car yields.
    target.setCars(vehicles.length);
    const before = sample.slice();
    const progress = vi.fn();
    let cancelled = false;
    expect(
      await RacingRenderer.prototype.prepare.call(
        typed,
        sample,
        progress,
        () => cancelled,
        async () => {
          // The stage must already be reported when the browser can repaint.
          expect(progress).toHaveBeenCalled();
          cancelled = true;
        },
      ),
    ).toBe(false);
    expect(target.bikeShells.update).toHaveBeenCalledTimes(bikeBuilds);
    expect(target.renderer.compileAsync).not.toHaveBeenCalled();
    expect(target.draw).not.toHaveBeenCalled();
    expect(target.preparation.snapshot()?.status).toBe('cancelled');
    expect(sample).toEqual(before);
  },
);
it('stops cancelled construction before touching any further GPU resources', async () => {
  const { target, typed, sample } = fixture();
  let cancelled = false;
  const result = await RacingRenderer.prototype.prepare.call(
    typed,
    sample,
    vi.fn(),
    () => cancelled,
    async () => {
      cancelled = true;
    },
  );
  expect(result).toBe(false);
  expect(target.cars).toHaveLength(1);
  expect(target.preparation.snapshot()?.status).toBe('cancelled');
  expect(target.draw).not.toHaveBeenCalled();
  expect(target.renderer.compileAsync).not.toHaveBeenCalled();
});
it('requires the complete selected circuit before a showroom can prepare driving', async () => {
  const { target, typed, sample } = fixture('mx450');
  Object.assign(target, { showroomOnly: true });
  const before = sample.slice();
  await expect(
    RacingRenderer.prototype.prepare.call(
      typed,
      sample,
      vi.fn(),
      () => false,
      async () => {},
    ),
  ).rejects.toThrow('Build the selected circuit before preparing a race');
  expect(target.cars).toHaveLength(0);
  expect(target.draw).not.toHaveBeenCalled();
  expect(target.renderer.compileAsync).not.toHaveBeenCalled();
  expect(sample).toEqual(before);
  expect(target.preparation.snapshot()?.status).toBe('failed');
});
it('a shader failure rejects initialization instead of starting unprepared gameplay', async () => {
  const { target, typed, sample } = fixture();
  target.renderer.compileAsync.mockRejectedValueOnce(new Error('Shader failure'));
  await expect(
    RacingRenderer.prototype.prepare.call(
      typed,
      sample,
      vi.fn(),
      () => false,
      async () => undefined,
    ),
  ).rejects.toThrow('Shader failure');
  expect(target.preparation.snapshot()?.error).toBe('Shader failure');
  expect(target.renderer.getRenderTarget()).toBeNull();
  expect(target.draw).not.toHaveBeenCalled();
});
it('restores the selected camera when a GPU warmup pass throws', async () => {
  const { target, typed, sample } = fixture();
  target.draw.mockImplementationOnce(() => {
    throw new Error('GPU pass failed');
  });
  await expect(
    RacingRenderer.prototype.prepare.call(
      typed,
      sample,
      vi.fn(),
      () => false,
      async () => undefined,
    ),
  ).rejects.toThrow('GPU pass failed');
  expect(target.mode).toBe('pod');
  expect(target.reset).toHaveBeenCalled();
});

it('never treats an unfinished GPU preparation deadline as successful completion', async () => {
  let now = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const target = { gpuFrames: { ready: vi.fn(() => false) } } as unknown as RacingRenderer;
  try {
    await expect(
      RacingRenderer.prototype.waitForPreparedFrame.call(
        target,
        () => false,
        async () => {
          now += 45001;
        },
      ),
    ).rejects.toThrow('GPU preparation did not complete');
  } finally {
    clock.mockRestore();
  }
});

it('does not apply graphics or compile when preparation fails', async () => {
  const target = {
    disposed: false,
    waitForPreparedFrame: vi.fn(async () => {
      throw new Error('GPU preparation did not complete');
    }),
    setQuality: vi.fn(),
  };
  await expect(
    RacingRenderer.prototype.prepareQuality.call(
      target as unknown as RacingRenderer,
      'low',
      {} as never,
      () => false,
      async () => {},
    ),
  ).rejects.toThrow('GPU preparation did not complete');
  expect(target.setQuality).not.toHaveBeenCalled();
});
