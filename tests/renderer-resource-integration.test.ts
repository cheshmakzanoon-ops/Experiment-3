import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as T from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildQueue, type BuildProgress } from '../src/rendering/build-queue.ts';
import { GpuTimer } from '../src/rendering/gpu-timer.ts';
import { DrawLedger } from '../src/rendering/draw-ledger.ts';
import { GpuFrameGate } from '../src/rendering/gpu-frame-gate.ts';
import {
  F,
  H,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  HEADER,
  CAR_STRIDE,
} from '../src/simulation/protocol.ts';
import { prepareVenueGround } from '../src/rendering/venue-kit/preparation.ts';
import { prepareVenueField, venueField, venueFieldReady } from '../src/rendering/venue-kit/plan.ts';
import { VenueField } from '../src/rendering/venue-kit/field.ts';
import { trackPoint, type Track } from '../src/simulation/track.ts';

/** Select complete production factory/disposal methods without importing the
 * renderer's asset loaders. The constructor and loaders are explicit inert
 * boundaries; cancellation, exception order and disposal are actual source. */
const source = ts.createSourceFile(
  'renderer.ts',
  readFileSync(new URL('../src/rendering/renderer.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const owner = source.statements.find(
  (node): node is ts.ClassDeclaration =>
    ts.isClassDeclaration(node) && node.name?.text === 'RacingRenderer',
);
function member(name: string) {
  const node = owner?.members.find(
    (item): item is ts.MethodDeclaration =>
      ts.isMethodDeclaration(item) && item.name.getText(source) === name,
  );
  if (!node) throw new Error('Missing RacingRenderer.' + name);
  return node;
}
function compile<T>(code: string, dependencies: Record<string, unknown>, result: string): T {
  const javascript = ts.transpileModule('class Owner { ' + code + ' }', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(dependencies), javascript + '; return ' + result + ';')(
    ...Object.values(dependencies),
  ) as T;
}

function gpu(cleanupError?: unknown) {
  let armed = false;
  const calls: string[] = [];
  const gl = {
    QUERY_RESULT_AVAILABLE: 1,
    QUERY_RESULT: 2,
    getExtension: () => ({ TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 }),
    isContextLost: () => false,
    getParameter: () => false,
    createQuery: () => {
      calls.push('allocate');
      return {};
    },
    beginQuery: () => calls.push('begin'),
    endQuery: () => calls.push('end'),
    getQueryParameter: () => false,
    deleteQuery: () => {
      calls.push('delete');
      if (armed) throw cleanupError;
    },
  };
  const timer = new GpuTimer(gl as unknown as WebGL2RenderingContext);
  timer.begin();
  timer.end();
  return { timer, calls, arm: () => (armed = true) };
}

function factoryFixture(options: { fail?: boolean; error?: unknown; cleanup?: boolean } = {}) {
  const events: string[] = [];
  const release = (name: string) => ({ dispose: vi.fn(() => events.push('release:' + name)) });
  const cleanupError = new Error('optional timer delete failed');
  const g = gpu(cleanupError);
  if (options.cleanup) g.arm();
  const construction = new BuildQueue();
  construction.add('Engine dependency', 0, () => {
    events.push('dependency');
    if (options.fail) throw options.error;
  });
  const track = { circuit: { id: 'resource-fixture' } } as unknown as Track;
  const state = {
    disposed: false,
    graphics: { reflections: 'off' },
    preset: 'medium',
    scene: new T.Scene(),
    sun: new T.DirectionalLight(),
    cars: [],
    renderer: release('backend'),
    circuit: {
      construction,
      track,
      group: new T.Group(),
      props: new T.Group(),
      disposePlanting: vi.fn(),
      secondaryStands: release('stands'),
      wetReflection: release('wet'),
      disposalMaterials: () => new Set<T.Material>(),
      stateTexture: release('stateTexture'),
    },
    photoSky: { ...release('sky'), ready: vi.fn(async () => {}) },
    setCars: vi.fn(() => events.push('cars')),
    textures: { ...release('textures'), register: vi.fn(() => events.push('register')) },
    bikeShells: { disposeAll: vi.fn(() => events.push('release:bikes')) },
    gridPreparation: release('gridPreparation'),
    pitCrew: release('pitCrew'),
    gridPerformance: release('gridPerformance'),
    reflection: release('reflection'),
    shadowProxies: release('shadowProxies'),
    farShadow: release('farShadow'),
    gpuTimer: g.timer,
    gpuFrames: release('fence'),
    motionBlur: release('motionBlur'),
    exposure: release('exposure'),
    weatherPresentation: release('weather'),
    bloom: release('bloom'),
    fxaa: release('fxaa'),
    scenePass: release('scenePass'),
    grade: release('grade'),
    ultra: release('ultra'),
    environment: release('environment'),
    composer: release('composer'),
    releaseCarTemplates: () => release('templates'),
  };
  const ground = {
    attach: vi.fn(),
    detach: vi.fn(() => events.push('release:ground')),
    ready: vi.fn(async () => true),
  };
  const warn = vi.fn();
  const dispose = compile<(this: typeof state) => void>(
    member('dispose').getText(source),
    {
      T,
      scannedGround: ground,
      disposeTextureLoaders: async () => {},
      disposeSceneTexture: vi.fn(),
      console: { warn },
    },
    'Owner.prototype.dispose',
  );
  const renderer = Object.assign(state, { dispose: () => dispose.call(state) });
  const create = compile<
    (
      canvas: unknown,
      track: Track,
      progress: (value: BuildProgress) => void,
      cancelled: () => boolean,
    ) => Promise<typeof renderer | null>
  >(
    member('create').getText(source),
    {
      RacingRenderer: function () {
        return renderer;
      },
      loadLazyData: async () => {},
      prepareVenueGround,
      isGpCourse: () => false,
      isMotocrossVenue: () => true,
      scannedGround: ground,
      MENU_CLOUD_COVER: 0,
      OWNER_BUILD: false,
      loadHeroShells: async () => null,
      loadRivalLevels: async () => null,
      loadDriverAsset: async () => null,
      loadVenueVegetation: async () => null,
      reflectInWetRoad: vi.fn(() => events.push('reflect')),
      console: { warn },
    },
    'Owner.create',
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });
  return { state, renderer, create, track, events, construction, g, warn, cleanupError, ground };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('renderer factory owns construction and optional timer teardown', () => {
  it.each([new Error('construction failed'), undefined, 0])(
    'preserves the original construction failure when timer cleanup also fails (%s)',
    async (error) => {
      const f = factoryFixture({ fail: true, error, cleanup: true });
      let caught = false;
      let failure: unknown;
      try {
        await f.create(
          {},
          f.track,
          () => {},
          () => false,
        );
      } catch (value) {
        caught = true;
        failure = value;
      }
      expect(caught).toBe(true);
      expect(failure).toBe(error);
      expect(f.state.disposed).toBe(true);
      expect(f.state.gpuFrames.dispose).toHaveBeenCalledOnce();
      expect(f.state.composer.dispose).toHaveBeenCalledOnce();
      expect(f.state.renderer.dispose).toHaveBeenCalledOnce();
      expect(f.g.calls.filter((call) => call === 'delete')).toHaveLength(1);
      expect(f.warn.mock.calls).toEqual([['Circuit renderer cleanup failed:', f.cleanupError]]);
      expect(f.construction.ready).toBe(false);
      expect(f.state.setCars).not.toHaveBeenCalled();
      expect(() => f.renderer.dispose()).not.toThrow();
      expect(f.state.renderer.dispose).toHaveBeenCalledOnce();
    },
  );

  it.each(['Engine dependency', 'Scene ready'])(
    'cancels at actual queue progress %s and preserves cleanup failure diagnostics',
    async (label) => {
      const f = factoryFixture({ cleanup: true });
      let cancelled = false;
      const result = await f.create(
        {},
        f.track,
        (progress) => {
          if (progress.label === label) cancelled = true;
        },
        () => cancelled,
      );
      expect(result).toBeNull();
      expect(f.state.disposed).toBe(true);
      expect(f.construction.ready).toBe(false);
      expect(f.construction.statistics.cancelled).toBe(true);
      expect(f.state.setCars).toHaveBeenCalledTimes(label === 'Engine dependency' ? 0 : 1);
      expect(f.events).not.toContain('register');
      expect(f.events).not.toContain('reflect');
      expect(f.state.gpuFrames.dispose).toHaveBeenCalledOnce();
      expect(f.state.renderer.dispose).toHaveBeenCalledOnce();
      expect(f.warn.mock.calls).toEqual([['Circuit renderer cleanup failed:', f.cleanupError]]);
    },
  );

  it('publishes a successful factory result with its queue complete and owners still live', async () => {
    const f = factoryFixture();
    const result = await f.create(
      {},
      f.track,
      () => {},
      () => false,
    );
    expect(result).toBe(f.renderer);
    expect(f.construction.ready).toBe(true);
    expect(f.events).toEqual(['dependency', 'cars', 'register', 'reflect']);
    expect(f.state.renderer.dispose).not.toHaveBeenCalled();
    expect(f.warn).not.toHaveBeenCalled();
    f.renderer.dispose();
    expect(f.state.renderer.dispose).toHaveBeenCalledOnce();
    expect(f.state.gpuFrames.dispose).toHaveBeenCalledOnce();
  });
});

function rasterTrack() {
  return {
    circuit: { catalogue: {} },
    points: Array.from({ length: 33 }, (_, i) => ({ ...trackPoint(), x: i * 10, s: i * 10 })),
  } as unknown as Track;
}

describe('venue preparation caller releases its actual shared generator on cancellation', () => {
  it.each(['progress', 'yield', 'complete'])(
    'cancels from %s without another raster step or leaked waiter',
    async (boundary) => {
      const track = rasterTrack();
      let cancelled = false;
      const advances = vi.spyOn(VenueField.prototype, 'advance');
      vi.spyOn(performance, 'now').mockReturnValue(0);
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        if (boundary === 'yield') cancelled = true;
        queueMicrotask(() => callback(0));
        return 1;
      });
      const result = await prepareVenueGround(
        track,
        (progress) => {
          if (
            (boundary === 'progress' && progress.completed === 1) ||
            (boundary === 'complete' && progress.fraction === 1)
          )
            cancelled = true;
        },
        () => cancelled,
      );
      expect(result).toBe(false);
      expect(advances).toHaveBeenCalledTimes(
        boundary === 'yield' ? 0 : boundary === 'progress' ? 1 : 8,
      );
      if (boundary === 'complete') {
        expect(venueFieldReady(track)).toBe(true);
        const cached = venueField(track);
        expect(
          await prepareVenueGround(
            track,
            () => {},
            () => false,
          ),
        ).toBe(true);
        expect(venueField(track)).toBe(cached);
      } else {
        expect(venueFieldReady(track)).toBe(false);
        const prior = advances.mock.contexts[0];
        advances.mockClear();
        const replacement = prepareVenueField(track);
        replacement.next();
        expect(advances.mock.contexts[0]).not.toBe(prior);
        replacement.return(undefined as unknown as VenueField);
      }
    },
  );
});

/** The complete contiguous frame-submission region of draw(), selected as AST
 * statements from the real info reset through its final timing assignment.
 * Earlier vehicle/camera presentation is out of scope. No statement or branch
 * inside this submission transaction is replaced by a fixture implementation. */
const draw = member('draw');
const resetIndex = draw.body!.statements.findIndex(
  (statement) => statement.getText(source) === 'this.renderer.info.reset();',
);
if (resetIndex < 0) throw new Error('Missing renderer frame-submission boundary');
const frameCode = draw
  .body!.statements.slice(resetIndex)
  .map((statement) => statement.getText(source))
  .join('\n');
const submitFrame = compile<(this: object, values: Record<string, unknown>) => void>(
  'submit(values) { const { studio, mxPaddock, illumination, daylight, b, presented, o, car, ' +
    'followedDefinition, followedBike, formulaBody, motocrossFollow, gpFollow, gpGrid, menu, replay, ' +
    'pass, dt, cameraMode, pregame, speed, gpLook, sunSpread, formulaGrid, start } = values; ' +
    'let reflectionMaterials = []; ' +
    frameCode +
    ' }',
  {
    F,
    H,
    W,
    WHEEL_BASE,
    WHEEL_STRIDE,
    frameLiquidRain: () => 0,
    subjectLens: () => null,
    skySunKey: () => '',
    GP_SHUTTER: 1,
    METER_KEY: { day: 1 },
    MX_ARENA_PHOTOGRAPHIC: {},
    TONE_MAPPING: { aces: 0 },
    postLensFrame: () => {},
  },
  'Owner.prototype.submit',
);

function frameFixture(fault: 'extension' | 'begin' | 'end' | 'poll', renderError?: Error) {
  const events: string[] = [];
  let armed = fault !== 'poll';
  let failDraw = !!renderError;
  let queryId = 0;
  const probe = (stage: string) => {
    events.push(stage);
    if (armed && stage === fault) {
      armed = false;
      throw new Error('optional timer ' + fault);
    }
  };
  const gl = {
    QUERY_RESULT_AVAILABLE: 1,
    QUERY_RESULT: 2,
    SYNC_GPU_COMMANDS_COMPLETE: 5,
    CONDITION_SATISFIED: 6,
    getExtension: () => {
      probe('extension');
      return { TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 };
    },
    isContextLost: () => false,
    getParameter: () => false,
    createQuery: () => {
      events.push('query');
      return { id: ++queryId };
    },
    beginQuery: () => probe('begin'),
    endQuery: () => probe('end'),
    getQueryParameter: () => {
      probe('poll');
      return false;
    },
    deleteQuery: () => events.push('deleteQuery'),
    fenceSync: () => {
      events.push('fence');
      return {};
    },
    flush: () => events.push('flush'),
    clientWaitSync: () => 6,
    deleteSync: () => events.push('deleteFence'),
  };
  const timer = new GpuTimer(gl as unknown as WebGL2RenderingContext);
  if (fault === 'poll') {
    timer.begin();
    timer.end();
    armed = true;
  }
  const gate = new GpuFrameGate(gl as unknown as WebGL2RenderingContext);
  const info = { calls: 0, triangles: 0 };
  const ledger = new DrawLedger(info);
  const count = (name: string) => {
    events.push(name);
    info.calls++;
    info.triangles += 3;
  };
  const scene = { overrideMaterial: { original: true }, matrixWorldAutoUpdate: true };
  const originalOverride = scene.overrideMaterial;
  const camera = new T.PerspectiveCamera();
  const car = { root: new T.Group() };
  const state = {
    renderer: {
      info: {
        reset: () => {
          events.push('reset');
          info.calls = info.triangles = 0;
        },
      },
      shadowMap: { autoUpdate: true },
      toneMappingExposure: 1,
      toneMapping: 0,
    },
    scene,
    camera,
    drawLedger: ledger,
    gpuTimer: timer,
    gpuFrames: gate,
    scenePresentation: { restore: vi.fn(() => events.push('restore')) },
    circuit: {
      construction: { ready: true },
      wetReflection: { suspend: () => {}, update: () => count('wet') },
      track: { at: () => ({ y: 0, bank: 0 }) },
    },
    environment: { update: () => count('environment') },
    refreshReflectionExclusions: () => {},
    reflection: { updateProbe: () => count('probe'), renderMirrors: () => count('mirrors') },
    graphics: {
      reflections: 'off',
      motionBlur: 0,
      autoExposure: false,
      lensEffects: false,
      toneMapper: 'aces',
    },
    sky: { material: { uniforms: { probeSkyIntensity: { value: 1 } } } },
    motionBlur: { setStrength: () => {}, field: { wheelCount: 0 }, prepareFrame: () => {} },
    scenePass: { heatHaze: false },
    heatHaze: { clear: () => {} },
    exposure: { prepare: () => 1 },
    grade: {},
    bloom: {},
    ultra: { prepareFrame: () => {}, afterFrame: () => events.push('after') },
    cameraClock: { discontinuous: false },
    follow: 0,
    target: new T.Vector3(),
    cars: [car],
    renderMs: 0,
    composer: {
      render: () => {
        count('composer');
        scene.overrideMaterial = { original: false };
        if (failDraw) throw renderError;
      },
    },
  };
  const frame = new Float32Array(HEADER + CAR_STRIDE);
  const values = {
    studio: false,
    mxPaddock: true,
    illumination: 'day',
    daylight: { cover: 0, exposure: 1 },
    b: frame,
    presented: frame,
    o: HEADER,
    car,
    followedDefinition: { drs: false, classId: 'car' },
    followedBike: null,
    formulaBody: null,
    motocrossFollow: false,
    gpFollow: false,
    gpGrid: false,
    menu: false,
    replay: false,
    pass: 'held-colour',
    dt: 1 / 60,
    cameraMode: 'pod',
    pregame: false,
    speed: 0,
    gpLook: null,
    sunSpread: 0,
    formulaGrid: false,
    start: performance.now(),
  };
  return {
    state,
    events,
    timer,
    gate,
    ledger,
    originalOverride,
    draw: () => submitFrame.call(state, values),
    recover: () => {
      failDraw = false;
    },
  };
}

describe('actual renderer frame transaction with optional timer faults', () => {
  it.each(['extension', 'begin', 'end', 'poll'] as const)(
    'keeps draws, ledger completion and frame fences after a timer %s failure',
    (fault) => {
      const f = frameFixture(fault);
      expect(() => f.draw()).not.toThrow();
      expect(
        f.events.filter((name) =>
          ['environment', 'probe', 'mirrors', 'wet', 'composer'].includes(name),
        ),
      ).toEqual(['environment', 'probe', 'mirrors', 'wet', 'composer']);
      expect(f.state.scene.overrideMaterial).toBe(f.originalOverride);
      expect(f.state.scene.matrixWorldAutoUpdate).toBe(true);
      expect(f.state.renderer.shadowMap.autoUpdate).toBe(true);
      expect(f.state.scenePresentation.restore).toHaveBeenCalledOnce();
      for (const phase of ['environment', 'probe', 'mirrors', 'wet', 'composer'] as const)
        expect(f.ledger.completed[phase]).toEqual({ calls: 1, triangles: 3 });
      expect(f.gate.diagnostics()).toMatchObject({ submitted: 1, pending: true, failure: null });
      expect(f.timer.milliseconds).toBeNull();
      expect(f.timer.sampleSequence).toBe(0);
      expect(f.gate.ready()).toBe(true);
      expect(() => f.draw()).not.toThrow();
      expect(f.gate.diagnostics()).toMatchObject({ submitted: 2, completed: 1, failure: null });
      expect(f.state.scenePresentation.restore).toHaveBeenCalledTimes(2);
      f.timer.dispose();
      f.gate.dispose();
    },
  );

  it('preserves the original render exception while timer end cleanup fails and the next frame recovers', () => {
    const failure = new Error('actual composer draw failed');
    const f = frameFixture('end', failure);
    let caught: unknown;
    try {
      f.draw();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    expect(f.state.scene.overrideMaterial).toBe(f.originalOverride);
    expect(f.state.scene.matrixWorldAutoUpdate).toBe(true);
    expect(f.state.renderer.shadowMap.autoUpdate).toBe(true);
    expect(f.state.scenePresentation.restore).toHaveBeenCalledOnce();
    expect(f.ledger.completed.composer).toEqual({ calls: 1, triangles: 3 });
    expect(f.gate.diagnostics().submitted).toBe(0);
    f.recover();
    expect(() => f.draw()).not.toThrow();
    expect(f.gate.diagnostics()).toMatchObject({ submitted: 1, pending: true, failure: null });
    expect(f.state.scenePresentation.restore).toHaveBeenCalledTimes(2);
    f.timer.dispose();
    f.gate.dispose();
  });
});
