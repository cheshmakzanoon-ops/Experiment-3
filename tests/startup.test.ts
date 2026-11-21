import * as T from 'three';
import { PreparationTrace } from '../src/rendering/preparation.ts';
import { expect, it, vi } from 'vitest';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import { CAR_STRIDE, HEADER, H, O, OFFROAD_BASE, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import { rulesetFor } from '../src/simulation/events.ts';
import type { SessionOptions } from '../src/simulation/config.ts';
import { VenueLighting } from '../src/rendering/venue-lighting.ts';
import { Track } from '../src/simulation/track.ts';
import type { LightingMode } from '../src/rendering/daylight.ts';
import { DEFAULT_PHOTO, type PhotoSettings } from '../src/rendering/photo-camera.ts';

function fixture(vehicle = 'apx01', entrants = 3) {
  const calls: string[] = [];
  // Match the native renderer's material ownership table and retained-program
  // list. Startup now initializes linked-program metadata before drawing.
  const materialProperties = new WeakMap<T.Material, { programs?: Map<string, T.WebGLProgram> }>();
  let bound: T.WebGLRenderTarget | null = null;
  const sample = new Float32Array(HEADER + CAR_STRIDE * entrants);
  sample[H.CARS] = entrants;
  sample[H.TIME] = 0;
  const follow = 1;
  sample[carBase(follow) + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
  const target = {
    cars: [] as { root: T.Group; update: ReturnType<typeof vi.fn> }[],
    follow,
    quality: 'high',
    bikeShells: {
      warmFieldDetails: vi.fn((compile: () => Promise<void>) => compile()),
      update: vi.fn(() => {
        calls.push('bike-materials');
      }),
    },
    circuit: {
      track: { circuit: {} },
      setGrandPrixGrid: vi.fn(),
      setMotorcyclePresentation: vi.fn((enabled: boolean) => {
        calls.push(`motorcycle-surface:${enabled}`);
      }),
    },
    scene: new T.Scene(),
    camera: new T.PerspectiveCamera(),
    lighting: 'day' as LightingMode,
    photo: null as PhotoSettings | null,
    venueLighting: {
      update: vi.fn((_night: boolean, _anchor: T.Vector3, _strength: number) => {
        calls.push('venue-lighting');
      }),
    },
    mode: 'pod',
    preparation: new PreparationTrace(),
    composer: { readBuffer: new T.WebGLRenderTarget(8, 8, { type: T.HalfFloatType }) },
    warmupFrames: 0,
    waitForPreparedFrame: vi.fn(async () => {
      calls.push('gpu-ready');
    }),
    warmPitPresentation: vi.fn(async () => {
      calls.push('pit-materials');
    }),
    gpuFrames: { submittedFrame: vi.fn(() => calls.push('shadow-fence')) },
    warmShadowCasters: vi.fn((_roadField: boolean) => {
      calls.push('shadow-casters');
      return false;
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
        _wallDelta?: number,
        pass?: 'scene' | 'venue-probe' | 'venue-shadows' | 'held-colour',
      ) => {
        expect(a).toBe(sample);
        expect(b[H.TIME]).toBe(0);
        expect(menu).toBe(false);
        expect(replay).toBe(true);
        calls.push(!pass || pass === 'scene' ? 'draw' : pass);
      },
    ),
  };
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
    return {};
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
    getUniforms,
    dispose() {
      geometry.dispose();
      material.dispose();
      target.composer.readBuffer.dispose();
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
    expect(target.draw).toHaveBeenCalledTimes(2);
    expect(target.waitForPreparedFrame).toHaveBeenCalledTimes(2);
    expect(target.preparation.snapshot()?.status).toBe('complete');
    expect(target.renderer.getRenderTarget()).toBeNull();
  } finally {
    dispose();
  }
});

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
it.each([false, true])(
  'retires the discarded road-grid shadow pass before chase when shadows are %s',
  async (enabled) => {
    const { calls, sample, target, typed } = fixture('gpr1');
    ['gpr1', 'gpr2', 'ss600'].forEach((id, i) => {
      sample[carBase(i) + RACE_BASE + R.VEHICLE] = vehicleIndex(id);
    });
    target.warmShadowCasters.mockImplementation(() => {
      calls.push('shadow-casters');
      return enabled;
    });
    await RacingRenderer.prototype.prepare.call(
      typed,
      sample,
      vi.fn(),
      () => false,
      async () => {},
      false,
    );
    expect(target.warmShadowCasters).toHaveBeenCalledWith(true);
    expect(target.gpuFrames.submittedFrame).toHaveBeenCalledTimes(enabled ? 1 : 0);
    const between = calls.slice(calls.indexOf('shadow-casters') + 1, calls.indexOf('draw'));
    expect(between).toEqual(enabled ? ['shadow-fence', 'gpu-ready', 'chase'] : ['chase']);
  },
);
it('retires the MX venue depth pass before submitting the real chase and cockpit', async () => {
  const { calls, sample, target, typed } = fixture('mx250');
  Object.assign(target.circuit, { offroad: {}, track: { circuit: { offroad: { kind: 'motocross' } } } });
  Object.assign(target.bikeShells, { prepareDirtField: vi.fn(async () => true) });
  for (let i = 0; i < sample[H.CARS]; i++)
    sample[carBase(i) + RACE_BASE + R.VEHICLE] = vehicleIndex('mx250');
  target.warmShadowCasters.mockImplementation(() => {
    calls.push('shadow-casters');
    return true;
  });
  await RacingRenderer.prototype.prepare.call(typed, sample, vi.fn(), () => false, async () => {}, false);
  expect(calls.slice(calls.indexOf('shadow-casters') + 1, calls.indexOf('draw'))).toEqual([
    'shadow-fence', 'gpu-ready', 'chase',
  ]);
});
it.each([false, true])('keeps the opening MX cubemap on its own GPU fence, cancellation %s', async (stop) => {
  const { calls, sample, target, typed } = fixture('mx450');
  Object.assign(target.circuit, { offroad: {}, track: { circuit: { offroad: { kind: 'motocross' } } } });
  Object.assign(target, { graphics: { reflections: 'local' } });
  Object.assign(target.bikeShells, { prepareDirtField: vi.fn(async () => true) });
  for (let i = 0; i < sample[H.CARS]; i++)
    sample[carBase(i) + RACE_BASE + R.VEHICLE] = vehicleIndex('mx450');
  let cancelled = false;
  target.waitForPreparedFrame.mockImplementation(async () => {
    calls.push('gpu-ready');
    if (stop && calls.includes('venue-probe')) cancelled = true;
  });
  expect(await RacingRenderer.prototype.prepare.call(
    typed, sample, vi.fn(), () => cancelled, async () => {}, false,
  )).toBe(!stop);
  const passes = calls.filter((name) => ['venue-probe', 'shadow-fence', 'gpu-ready', 'draw'].includes(name));
  expect(passes).toEqual(stop ? ['venue-probe', 'shadow-fence', 'gpu-ready'] :
    ['venue-probe', 'shadow-fence', 'gpu-ready', 'draw', 'gpu-ready', 'draw', 'gpu-ready']);
  expect(target.warmupFrames).toBe(stop ? 0 : 2);
});
it('reuses only the identical live gate on a slow GPU while waiting for an advancing worker sample', () => {
  const { sample, target, typed } = fixture('mx450');
  const shown = sample.slice(), next = sample.slice(), input = sample.slice();
  next[H.TICK] = 4;
  next[H.TIME] = 1 / 30;
  input[carBase(0) + OFFROAD_BASE + O.BODY] = -0.7;
  const rig = Object.assign(target, {
    follow: 0, mode: 'chase', renderedMode: 'chase', presentedBackdrop: 'circuit',
    lookX: 0, lookY: 0, presented: { value: shown }, gpuFrames: { completionLatencyMs: 11000 },
  });
  Object.assign(target.circuit, { track: { circuit: { offroad: { kind: 'motocross' } } } });
  const held = (a: Float32Array, b: Float32Array, alpha: number) =>
    RacingRenderer.prototype.canReuseDirtGate.call(typed, a, b, alpha);
  expect(held(sample, sample, 1)).toBe(true);
  expect(held(sample, next, 0)).toBe(true);
  expect(held(sample, next, 0.00000006)).toBe(true);
  expect(held(sample, next, 0.01)).toBe(false);
  expect(held(sample, next, 1)).toBe(false);
  expect(held(sample, input, 1)).toBe(false);
  expect(held(sample, next, NaN)).toBe(false);
  rig.mode = 'cockpit';
  expect(held(sample, sample, 1)).toBe(false);
  rig.mode = 'chase';
  rig.lookX = 0.02;
  expect(held(sample, sample, 1)).toBe(false);
  rig.lookX = 0;
  rig.gpuFrames.completionLatencyMs = 16;
  expect(held(sample, sample, 1)).toBe(false);
  rig.gpuFrames.completionLatencyMs = 11000;
  rig.follow = 1;
  expect(held(sample, sample, 1)).toBe(false);
  rig.follow = 0;
  Object.assign(target.circuit, { track: { circuit: {} } });
  expect(held(sample, sample, 1)).toBe(false);
});

it('warms both hidden MX views on the full target and retains the finished probe for the visible gate', async () => {
  const { calls, sample, target, typed } = fixture('mx450');
  const colour = new T.WebGLRenderTarget(1280, 800, { samples: 4 });
  const mx = Object.assign(target, {
    follow: 0, graphics: { reflections: 'local' }, scenePass: { target: colour },
    reflection: { localProbeActive: true, probeDiagnostics: { capturedAt: 0, starts: { immediate: 1 } } },
    resetPresentationState: vi.fn(), preparedDirtProbeStarts: null as number | null,
  });
  Object.assign(target.circuit, { offroad: {}, track: { circuit: { offroad: { kind: 'motocross' } } } });
  Object.assign(target.renderer, { shadowMap: { enabled: true } });
  Object.assign(target.bikeShells, {
    prepareDirtField: vi.fn(async () => true), motocrossPresentation: vi.fn(() => ({ root: new T.Group() })),
  });
  const views: [string, boolean, number, number][] = [];
  const draw = target.draw.getMockImplementation()!;
  target.draw.mockImplementation((...args) => {
    if (args[7] === 'held-colour') views.push([target.mode, colour.scissorTest, colour.scissor.z, colour.scissor.w]);
    return draw(...args);
  });
  for (let i = 0; i < sample[H.CARS]; i++)
    sample[carBase(i) + RACE_BASE + R.VEHICLE] = vehicleIndex('mx450');
  try {
    await RacingRenderer.prototype.prepare.call(typed, sample, vi.fn(), () => false, async () => {}, false);
    const passes = calls.filter((name) => ['venue-probe', 'venue-shadows', 'held-colour', 'gpu-ready'].includes(name));
    expect(passes).toEqual([
      'venue-probe', 'gpu-ready', 'venue-shadows', 'gpu-ready', 'held-colour', 'gpu-ready',
      'venue-shadows', 'gpu-ready', 'held-colour', 'gpu-ready',
    ]);
    expect(views).toEqual([['chase', true, 320, 200], ['cockpit', true, 320, 200]]);
    expect(mx).toMatchObject({
      warmupDirtCockpitColour: { width: 320, height: 200, targetWidth: 1280, targetHeight: 800 },
    });
    expect(colour.scissorTest).toBe(false);
    expect(colour.scissor.toArray()).toEqual([0, 0, 1280, 800]);
    expect(mx.preparedDirtProbeStarts).toBe(1);
    expect(mx.resetPresentationState).toHaveBeenCalledOnce();
    expect(mx.reset).not.toHaveBeenCalled();
    expect(target.warmupFrames).toBe(2);
  } finally {
    colour.dispose();
  }
});
it.each([
  { vehicle: 'gpr1', time: 0, capturedAt: 0, tick: 0, follow: 0, retain: true },
  { vehicle: 'gpr2', time: 0, capturedAt: 0, tick: 0, follow: 0, retain: true },
  { vehicle: 'gpr1', time: 0, capturedAt: null, tick: 0, follow: 0, retain: false },
  { vehicle: 'gpr2', time: 2, capturedAt: 0, tick: 0, follow: 0, retain: false },
  { vehicle: 'gpr1', time: 0, capturedAt: 0, tick: 1, follow: 0, retain: false },
  { vehicle: 'gpr2', time: 0, capturedAt: 0, tick: 0, follow: 1, retain: false },
  { vehicle: 'ss600', time: 0, capturedAt: 0, tick: 0, follow: 0, retain: false },
])('keeps only a completed player GP grid reflection for $vehicle at $tick / $capturedAt / $follow', async (row) => {
  const { sample, target, typed } = fixture(row.vehicle);
  for (let id = 0; id < sample[H.CARS]; id++) {
    sample[carBase(id) + RACE_BASE + R.VEHICLE] = vehicleIndex(row.vehicle);
  }
  sample[H.TICK] = row.tick;
  sample[H.TIME] = row.time;
  const rig = Object.assign(target, {
    follow: row.follow,
    graphics: { reflections: 'local' },
    reflection: { localProbeActive: true, probeDiagnostics: { capturedAt: row.capturedAt, starts: { immediate: 1 } } },
    resetPresentationState: vi.fn(),
    preparedGPProbeStarts: null as number | null,
  });
  Object.assign(target.bikeShells, { gpPresentation: () => ({ rearViews: [] }) });
  // This case also exercises a non-grid snapshot at a different time.
  target.draw.mockImplementation(() => {});
  expect(await RacingRenderer.prototype.prepare.call(typed, sample, vi.fn(), () => false, async () => {}, false)).toBe(true);
  expect(rig.preparedGPProbeStarts).toBe(row.retain ? 1 : null);
  expect(rig.resetPresentationState).toHaveBeenCalledTimes(row.retain ? 1 : 0);
  expect(rig.reset).toHaveBeenCalledTimes(row.retain ? 0 : 1);
});

it.each([null, 'venue-probe', 'venue-shadows', 'held-colour'] as const)(
  'finishes the GP environment and chase submissions before pit service, stopped at %s',
  async (stopAt) => {
    const { calls, sample, target, typed } = fixture('gpr2');
    const colour = new T.WebGLRenderTarget(1280, 800, { samples: 4 });
    Object.assign(target, { scenePass: { target: colour } });
    const drawn: [string, boolean][] = [];
    const draw = target.draw.getMockImplementation()!;
    target.draw.mockImplementation((...args) => {
      if (args[7] === 'held-colour') drawn.push([target.mode, colour.scissorTest]);
      return draw(...args);
    });
    for (const [i, id] of ['gpr1', 'gpr2', 'ss600'].entries())
      sample[carBase(i) + RACE_BASE + R.VEHICLE] = vehicleIndex(id);
    Object.assign(target, { graphics: { reflections: 'local' } });
    Object.assign(target.renderer, { shadowMap: { enabled: true } });
    const initial = sample.slice();
    let cancelled = false;
    target.waitForPreparedFrame.mockImplementation(async () => {
      if (stopAt && calls.includes(stopAt)) cancelled = true;
      calls.push('gpu-ready');
    });
    const complete = await RacingRenderer.prototype.prepare.call(
      typed, sample, vi.fn(), () => cancelled, async () => {}, true,
    );
    const expected = [
      'venue-probe', 'gpu-ready', 'venue-shadows', 'gpu-ready', 'held-colour', 'gpu-ready',
      'pit-materials', 'gpu-ready', 'venue-shadows', 'gpu-ready', 'held-colour', 'gpu-ready',
    ];
    const end = stopAt ? expected.indexOf(stopAt) + 2 : expected.length;
    expect(calls.filter((step) => expected.includes(step))).toEqual(expected.slice(0, end));
    expect(complete).toBe(stopAt === null);
    expect(sample).toEqual(initial);
    if (complete) expect(drawn).toEqual([['chase', true], ['cockpit', false]]);
    expect(colour.scissorTest).toBe(false);
    colour.dispose();
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
it('reuses motorcycle stands for another GP field and requires car jacks for a later mixed field', () => {
  const { target, typed } = fixture('gpr1');
  const canPrepare = (gpGrid: boolean) => RacingRenderer.prototype.canPrepareGrid.call(typed, gpGrid);
  Object.assign(target, { showroomOnly: false, gpPitStandsOnly: true });
  expect(canPrepare(true)).toBe(true);
  expect(canPrepare(false)).toBe(false);
  Object.assign(target, { gpPitStandsOnly: false });
  expect(canPrepare(true)).toBe(true);
  expect(canPrepare(false)).toBe(true);
  Object.assign(target, { showroomOnly: true });
  expect(canPrepare(true)).toBe(false);
  expect(canPrepare(false)).toBe(false);
});
it.each([false, true])('gives decoded showroom parts one owner across GP entry (cancelled %s)', (cancelled) => {
  const source = Object.create(RacingRenderer.prototype) as RacingRenderer;
  const next = Object.create(RacingRenderer.prototype) as RacingRenderer;
  const parts = Array.from({ length: 5 }, () => ({ dispose: vi.fn() }));
  Object.assign(source, {
    heroShells: parts[0],
    rivalLevels: parts.slice(1, 4),
    driverAsset: parts[4],
  });
  const transfer = source.releaseCarTemplates();
  source.releaseCarTemplates().dispose();
  if (!cancelled) {
    const assets = transfer.take()!;
    expect(assets.shells).toBe(parts[0]);
    expect(assets.rivals).toEqual(parts.slice(1, 4));
    expect(assets.driver).toBe(parts[4]);
    Object.assign(next, {
      heroShells: assets.shells,
      rivalLevels: assets.rivals,
      driverAsset: assets.driver,
    });
    transfer.dispose();
    for (const part of parts) expect(part.dispose).not.toHaveBeenCalled();
    next.releaseCarTemplates().dispose();
  }
  transfer.dispose();
  expect(transfer.take()).toBeNull();
  for (const part of parts) expect(part.dispose).toHaveBeenCalledOnce();
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

it.each([
  ['gpr1', 'gpr2'],
  ['sbk1000', 'ss600'],
  ['nr900', 'cr750'],
  ['mx450', 'mx250'],
  ['sm450', 'mx250'],
] as const)(
  'defers Formula pit measurements for %s and %s until each slot represents a car',
  (first, second) => {
    const cars = [0, 1].map((id) => {
      const root = new T.Group();
      const wheelSpins = Array.from({ length: 4 }, () => new T.Group());
      root.add(...wheelSpins);
      return { id, root, wheelSpins };
    });
    const setWheelGunFits = vi.fn();
    const target = {
      cars,
      pendingFormulaPitFits: new Set([0, 1]),
      deferredFormulaArt: new Set([0, 1]),
      circuit: { track: { circuit: {} } },
      installFormulaArt: vi.fn(),
      pitCrew: { setWheelGunFits, pitJacks: null },
    };
    const renderer = target as unknown as RacingRenderer;
    const frame = new Float32Array(HEADER + 2 * CAR_STRIDE);
    const slot = (id: number) => carBase(id) + RACE_BASE + R.VEHICLE;
    frame[slot(0)] = vehicleIndex(first);
    frame[slot(1)] = vehicleIndex(second);
    RacingRenderer.prototype.setCars.call(renderer, 2, frame);
    expect(setWheelGunFits).not.toHaveBeenCalled();
    expect(target.installFormulaArt).not.toHaveBeenCalled();
    frame[slot(1)] = vehicleIndex('apx01');
    RacingRenderer.prototype.setCars.call(renderer, 2, frame);
    RacingRenderer.prototype.setCars.call(renderer, 2, frame);
    expect(setWheelGunFits).toHaveBeenCalledTimes(1);
    expect(setWheelGunFits.mock.calls[0][0]).toBe(1);
    expect(setWheelGunFits.mock.calls[0][1]).toHaveLength(4);
    RacingRenderer.prototype.setCars.call(renderer, 2);
    expect(setWheelGunFits).toHaveBeenCalledTimes(2);
    expect(setWheelGunFits.mock.calls[1][0]).toBe(0);
    expect(target.installFormulaArt.mock.calls.map(([car]) => car.id)).toEqual([1, 0]);
  },
);
