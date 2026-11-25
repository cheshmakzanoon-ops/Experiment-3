import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as T from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GpuFrameGate } from '../src/rendering/gpu-frame-gate.ts';
import { acquireGpuFrameGate, type GpuFrameLease } from '../src/rendering/shared-gpu-frame-gate.ts';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import { FestivalRenderer } from '../src/rendering/open-world/festival-renderer.ts';
import * as materials from '../src/rendering/materials/library.ts';
import * as preparation from '../src/rendering/preparation.ts';

const leases: GpuFrameLease[] = [];
const renderers: { dispose(): void }[] = [];
function acquire(gl: WebGL2RenderingContext) {
  const lease = acquireGpuFrameGate(gl);
  leases.push(lease);
  return lease;
}
afterEach(() => {
  for (const renderer of renderers.splice(0)) renderer.dispose();
  for (const lease of leases.splice(0)) lease.dispose();
  vi.restoreAllMocks();
});

/** A recording GL boundary, not an alternative gate algorithm. Completion is
 * controlled by which issued commands the driver has actually acknowledged. */
function gpu() {
  const events: string[] = [];
  const state = {
    issued: 0,
    completed: -1,
    lost: false,
    waitResult: null as number | null,
    allocationFails: false,
    deleteFails: false,
    fences: [] as { id: number; through: number }[],
    deleted: [] as WebGLSync[],
    waits: [] as { fence: WebGLSync; flags: number; timeout: number }[],
  };
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    TIMEOUT_EXPIRED: 2,
    ALREADY_SIGNALED: 3,
    CONDITION_SATISFIED: 4,
    WAIT_FAILED: 5,
    isContextLost: () => state.lost,
    fenceSync: () => {
      events.push('fence');
      if (state.allocationFails) return null;
      const fence = { id: state.fences.length + 1, through: state.issued };
      state.fences.push(fence);
      return fence as unknown as WebGLSync;
    },
    clientWaitSync: (fence: WebGLSync, flags: number, timeout: number) => {
      state.waits.push({ fence, flags, timeout });
      return (
        state.waitResult ??
        (state.completed >= (fence as unknown as { through: number }).through ? 4 : 2)
      );
    },
    deleteSync: (fence: WebGLSync) => {
      state.deleted.push(fence);
      if (state.deleteFails) throw new Error('driver delete failed');
    },
    flush: vi.fn(() => events.push('flush')),
    finish: vi.fn(),
  } as unknown as WebGL2RenderingContext;
  const work = (label: string) => {
    state.issued++;
    events.push(label);
  };
  const complete = () => {
    state.completed = state.issued;
  };
  const queue = (lease: GpuFrameLease, label = 'circuit') => {
    work(label);
    lease.submittedFrame();
  };
  return { gl, state, events, work, complete, queue };
}

function classSource(path: string, name: string) {
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements.find(
    (node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name,
  );
  if (!declaration) throw new Error(`Missing ${name}`);
  return { source, declaration };
}
const festivalSource = classSource(
  '../src/rendering/open-world/festival-renderer.ts',
  'FestivalRenderer',
);
const circuitSource = classSource('../src/rendering/renderer.ts', 'RacingRenderer');

/** Execute every statement in the production render transaction. Camera/world
 * posing is outside this fixture; the render passes are explicit GL boundaries.
 * Admission, preparation, diagnostics and teardown use the real prototypes. */
const draw = festivalSource.declaration.members.find(
  (node): node is ts.MethodDeclaration =>
    ts.isMethodDeclaration(node) && node.name.getText(festivalSource.source) === 'draw',
)!;
const firstSubmission = draw.body!.statements.findIndex(
  (node) => node.getText(festivalSource.source) === 'this.renderer.info.reset();',
);
if (firstSubmission < 0) throw new Error('Missing Festival rendering transaction');
const submitSource = draw
  .body!.statements.slice(firstSubmission)
  .map((node) => node.getText(festivalSource.source))
  .join('\n');
const submitJavascript = ts.transpileModule(
  `function submit() {
    const subject = null, mode = 'day', time = 0, dt = 1 / 60, cut = false,
      elapsed = 0, wet = 0, discontinuity = false, onboard = false, speed = 0,
      presented = new Float32Array(0), daylight = { cover: 0, environment: 1 },
      start = performance.now();
    ${submitSource}
  }`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
const submit = new Function('T', 'postLensFrame', `${submitJavascript}; return submit;`)(
  T,
  () => {},
) as (this: object) => boolean;

function festival(g: ReturnType<typeof gpu>) {
  const disposable = () => ({ dispose: vi.fn() });
  const owned = Object.fromEntries(
    [
      'atmosphere',
      'terrain',
      'roads',
      'streetLights',
      'practicalLights',
      'buildings',
      'dressing',
      'crops',
      'contacts',
      'vegetation',
      'water',
      'markers',
      'reflection',
      'cars',
      'trails',
      'guidance',
      'orbit',
      'environment',
      'wet',
      'shadows',
      'bloom',
      'outputPass',
      'grade',
      'fxaa',
      'imagePipeline',
      'ultra',
      'photoSky',
      'composer',
    ].map((name) => [name, disposable()]),
  );
  const backend = {
    getContext: () => g.gl,
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
    info: { reset: vi.fn(), autoReset: false, render: { calls: 7, triangles: 21 } },
  };
  const state = {
    ...owned,
    disposed: false,
    gpuFrames: acquire(g.gl),
    preparationTimeoutMs: 90000,
    renderer: backend,
    scene: new T.Scene(),
    camera: new T.PerspectiveCamera(),
    sun: new T.DirectionalLight(),
    sky: { geometry: disposable(), material: disposable() },
    details: null,
    streetDetails: null,
    photoVegetation: null,
    vehiclePaint: [],
    vehicleRoots: [],
    vehiclePaintVersion: 0,
    reflectedVehicleVersion: 0,
    reflectionVersion: 0,
    reflectionMaterials: [],
    photo: false,
    graphics: { lensEffects: false },
    target: new T.Vector3(),
    stats: { drawCalls: 0, triangles: 0, renderMs: 0 },
    effects: { group: new T.Group() },
    effectPlayback: { reset: vi.fn() },
    audioView: { update: vi.fn() },
    updateLocalReflection: vi.fn(() => g.work('reflections')),
    draw: vi.fn(function (this: object) {
      return submit.call(this);
    }),
  };
  Object.assign(owned.terrain, { shadowRevision: 7, root: new T.Group() });
  Object.assign(owned.vegetation, { root: new T.Group() });
  Object.assign(owned.reflection, { probeExclusions: [], probeDiagnostics: {}, mirrorUpdates: 0 });
  Object.assign(owned.cars, {
    paintVersion: 0,
    reflectivePaint: [],
    update: vi.fn(),
    drawWithVehicleShadows: (_renderer: unknown, _scene: unknown, draw: () => void) => {
      g.work('vehicle shadows');
      draw();
    },
  });
  Object.assign(owned.streetLights, {
    renderWithShadows: (_renderer: unknown, _time: number, _revision: number, draw: () => void) => {
      g.work('street shadows');
      draw();
    },
  });
  Object.assign(owned.shadows, { update: () => g.work('shadows') });
  Object.assign(owned.environment, { update: () => g.work('environment') });
  Object.assign(owned.ultra, {
    prepareFrame: () => g.work('ultra prepare'),
    afterFrame: () => g.work('ultra after'),
  });
  Object.assign(owned.composer, { render: vi.fn(() => g.work('composer')), readBuffer: {} });
  for (const name of ['imagePipeline', 'shadows', 'streetLights', 'photoSky', 'ultra'])
    Object.assign(owned[name], { diagnostics: () => ({ fixture: name }) });
  const renderer = Object.assign(
    Object.create(FestivalRenderer.prototype),
    state,
  ) as FestivalRenderer;
  renderers.push(renderer);
  return { renderer, state, backend, owned };
}

function circuit(g: ReturnType<typeof gpu>, backend: ReturnType<typeof festival>['backend']) {
  const disposable = () => ({ dispose: vi.fn() });
  const owned = Object.fromEntries(
    [
      'textures',
      'gridPreparation',
      'pitCrew',
      'gridPerformance',
      'reflection',
      'shadowProxies',
      'farShadow',
      'gpuTimer',
      'motionBlur',
      'exposure',
      'weatherPresentation',
      'bloom',
      'outputPass',
      'fxaa',
      'scenePass',
      'grade',
      'ultra',
      'environment',
      'photoSky',
      'composer',
    ].map((name) => [name, disposable()]),
  );
  const state = {
    ...owned,
    disposed: false,
    gpuFrames: acquire(g.gl),
    renderer: backend,
    scene: new T.Scene(),
    sun: new T.DirectionalLight(),
    cars: [],
    bikeShells: { disposeAll: vi.fn() },
    releaseCarTemplates: disposable,
    circuit: {
      disposePlanting: vi.fn(),
      secondaryStands: disposable(),
      wetReflection: disposable(),
      stateTexture: disposable(),
      disposalMaterials: () => new Set<T.Material>(),
    },
  };
  const renderer = Object.assign(Object.create(RacingRenderer.prototype), state) as RacingRenderer;
  renderers.push(renderer);
  return { renderer, state };
}

/** Inert scene-building boundaries allow the complete production constructors
 * to run, including a failure immediately before their final acquisition. No
 * authored assets, actual scene constructors, workers or WebGL backend run. */
function inert(): object {
  const fields = new Map<PropertyKey, unknown>();
  const value: object = new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === Symbol.iterator) return function* () {};
      if (key === 'then') return undefined;
      if (!fields.has(key)) fields.set(key, inert());
      return fields.get(key);
    },
    set(_target, key, next) {
      fields.set(key, next);
      return true;
    },
    apply() {
      return value;
    },
    construct() {
      return inert();
    },
  });
  return value;
}

function construction(kind: 'festival' | 'circuit', g: ReturnType<typeof gpu>, fail: boolean) {
  const { source, declaration } = kind === 'festival' ? festivalSource : circuitSource;
  const ctor = declaration.members.find(ts.isConstructorDeclaration)!;
  const dependencies: Record<string, unknown> = {};
  for (const node of source.statements) {
    if (ts.isImportDeclaration(node)) {
      const bindings = node.importClause?.namedBindings;
      if (node.importClause?.name) dependencies[node.importClause.name.text] = inert();
      if (bindings && ts.isNamespaceImport(bindings)) dependencies[bindings.name.text] = inert();
      else if (bindings)
        for (const binding of bindings.elements) dependencies[binding.name.text] = inert();
    } else if (ts.isVariableStatement(node)) {
      for (const binding of node.declarationList.declarations)
        if (ts.isIdentifier(binding.name)) dependencies[binding.name.text] = inert();
    }
  }
  const error = new Error('final scene construction failed');
  const lastStage = vi.fn(() => {
    if (fail) throw error;
  });
  const backend = Object.assign(inert(), { getContext: () => g.gl });
  const acquisition = vi.fn((gl: WebGL2RenderingContext) => acquire(gl));
  Object.assign(dependencies, {
    T,
    acquireGpuFrameGate: acquisition,
    createWebGLRenderer: () => ({ renderer: backend, context: g.gl }),
    prewarmSky: kind === 'festival' ? lastStage : () => {},
  });
  const base = Object.assign(inert(), { resize: kind === 'circuit' ? lastStage : () => {} });
  const javascript = ts.transpileModule(`class Owner { ${ctor.getText(source)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const Constructor = new Function(
    ...Object.keys(dependencies),
    'base',
    `${javascript}; Object.setPrototypeOf(Owner.prototype, base); return Owner;`,
  )(...Object.values(dependencies), base) as new (...args: unknown[]) => {
    gpuFrames: GpuFrameLease;
  };
  const create = () =>
    kind === 'festival'
      ? new Constructor(
          backend,
          {},
          { region: { id: 'fixture' }, network: {}, field: { region: { seaLevel: 0 } } },
          [],
          [],
          {},
        )
      : new Constructor({}, { circuit: { id: 'fixture' }, length: 0 }, true);
  return { create, acquisition, lastStage, error };
}

describe('one actual GPU gate per live context', () => {
  it('shares pending work and completion across two leases without consuming readiness', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const g = gpu(),
      first = acquire(g.gl),
      second = acquire(g.gl);
    expect(first.ready()).toBe(true);
    g.queue(first);
    expect(second.ready()).toBe(false);
    expect(second.diagnostics()).toEqual(first.diagnostics());
    second.dispose();
    second.dispose();
    expect(g.state.deleted).toEqual([]);
    expect(first.diagnostics()).toMatchObject({ pending: true, submitted: 1, completed: 0 });
    expect(second.ready()).toBe(false);
    expect(() => second.submittedFrame()).toThrow('lease is disposed');
    const replacement = acquire(g.gl);
    expect(replacement.ready()).toBe(false);
    g.complete();
    expect(replacement.ready()).toBe(true);
    expect(first.ready()).toBe(true);
    expect(first.diagnostics()).toMatchObject({ pending: false, submitted: 1, completed: 1 });
    expect(g.state.deleted).toHaveLength(1);
    expect(g.state.waits.every(({ flags, timeout }) => flags === 0 && timeout === 0)).toBe(true);
    expect(g.gl.finish).not.toHaveBeenCalled();
  });

  it('isolates different contexts and releases each final fence once', () => {
    const a = gpu(),
      b = gpu(),
      first = acquire(a.gl),
      same = acquire(a.gl),
      other = acquire(b.gl);
    const dispose = vi.spyOn(GpuFrameGate.prototype, 'dispose');
    a.queue(first);
    expect(other.ready()).toBe(true);
    b.queue(other);
    first.dispose();
    expect(dispose).not.toHaveBeenCalled();
    same.dispose();
    same.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(a.state.deleted).toHaveLength(1);
    expect(other.ready()).toBe(false);
    other.dispose();
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(b.state.deleted).toHaveLength(1);
    const replacement = acquire(a.gl);
    expect(replacement.ready()).toBe(true);
    expect(replacement.diagnostics().submitted).toBe(0);
  });

  it('revokes the final lease even when driver cleanup throws', () => {
    const g = gpu(),
      lease = acquire(g.gl);
    g.queue(lease);
    g.state.deleteFails = true;
    expect(() => lease.dispose()).toThrow('driver delete failed');
    expect(() => lease.dispose()).not.toThrow();
    expect(g.state.deleted).toHaveLength(1);
    g.state.deleteFails = false;
    const replacement = acquire(g.gl);
    expect(replacement.ready()).toBe(true);
    g.queue(replacement);
    replacement.dispose();
    expect(g.state.deleted).toHaveLength(2);
  });

  it.each(['festival', 'circuit'] as const)(
    '%s acquires only after its full constructor succeeds',
    (kind) => {
      const g = gpu(),
        failed = construction(kind, g, true);
      expect(failed.create).toThrow(failed.error);
      expect(failed.lastStage).toHaveBeenCalledOnce();
      expect(failed.acquisition).not.toHaveBeenCalled();
      const successful = construction(kind, g, false);
      const owner = successful.create();
      expect(successful.lastStage).toHaveBeenCalledOnce();
      expect(successful.acquisition).toHaveBeenCalledExactlyOnceWith(g.gl);
      g.queue(owner.gpuFrames);
      owner.gpuFrames.dispose();
      expect(g.state.deleted).toHaveLength(1);
    },
  );
});

describe('Festival submission and mode handoff', () => {
  it('blocks the full draw before posing, then preserves Festival work through owned teardown', () => {
    const g = gpu(),
      f = festival(g),
      c = circuit(g, f.backend);
    g.queue(c.state.gpuFrames);
    expect(f.renderer.canSubmitFrame()).toBe(false);
    expect(
      FestivalRenderer.prototype.draw.call(
        f.renderer,
        new Float32Array(),
        new Float32Array(),
        1,
        1 / 60,
      ),
    ).toBe(false);
    expect(f.backend.info.reset).not.toHaveBeenCalled();
    g.complete();
    expect(f.renderer.canSubmitFrame()).toBe(true);
    expect(submit.call(f.renderer)).toBe(true);
    expect(g.events.slice(-2)).toEqual(['fence', 'flush']);
    expect(g.state.fences.at(-1)?.through).toBe(g.state.issued);
    expect(f.renderer.diagnostics().gpuFrameQueue).toMatchObject({
      pending: true,
      submitted: 2,
      completed: 1,
    });
    expect(f.renderer.stats).toMatchObject({ drawCalls: 7, triangles: 21 });
    f.renderer.dispose();
    f.renderer.dispose();
    expect(f.backend.dispose).not.toHaveBeenCalled();
    expect(f.backend.forceContextLoss).not.toHaveBeenCalled();
    expect(g.state.deleted).toHaveLength(1);
    expect(c.renderer.canSubmitFrame()).toBe(false);
    g.complete();
    expect(c.renderer.canSubmitFrame()).toBe(true);
    expect(c.state.gpuFrames.diagnostics().completed).toBe(2);
    c.renderer.dispose();
    c.renderer.dispose();
    expect(f.backend.dispose).toHaveBeenCalledOnce();
    for (const owner of Object.values(f.owned)) expect(owner.dispose).toHaveBeenCalledOnce();
    expect(
      FestivalRenderer.prototype.draw.call(
        f.renderer,
        new Float32Array(),
        new Float32Array(),
        1,
        1 / 60,
      ),
    ).toBe(false);
  });

  it('retains pending work when a render pass fails and when independent teardown also fails', () => {
    const g = gpu(),
      f = festival(g),
      circuitLease = acquire(g.gl);
    const failure = new Error('composer failed');
    vi.spyOn(f.renderer['composer'], 'render').mockImplementation(() => {
      g.work('partial composer');
      throw failure;
    });
    expect(() => submit.call(f.renderer)).toThrow(failure);
    expect(circuitLease.ready()).toBe(false);
    expect(g.events.slice(-3)).toEqual(['partial composer', 'fence', 'flush']);
    f.owned.atmosphere.dispose.mockImplementation(() => {
      throw new Error('owner release failed');
    });
    expect(() => f.renderer.dispose()).toThrow('owner release failed');
    expect(circuitLease.ready()).toBe(false);
    expect(g.state.deleted).toEqual([]);
    for (const owner of Object.values(f.owned)) expect(owner.dispose).toHaveBeenCalledOnce();
    circuitLease.dispose();
    expect(g.state.deleted).toHaveLength(1);
  });

  it.each([new Error('first draw failure'), undefined, 0])(
    'preserves the first draw failure when fencing also fails (%s)',
    (failure) => {
      const g = gpu(),
        f = festival(g),
        circuitLease = acquire(g.gl);
      vi.spyOn(f.renderer['composer'], 'render').mockImplementation(() => {
        throw failure;
      });
      g.state.allocationFails = true;
      let caught = false;
      try {
        submit.call(f.renderer);
      } catch (error) {
        caught = true;
        expect(error).toBe(failure);
      }
      expect(caught).toBe(true);
      expect(circuitLease.diagnostics().failure).toBe('Unable to allocate GPU frame fence');
      expect(() => f.renderer.canSubmitFrame()).toThrow('Unable to allocate GPU frame fence');
      expect(g.gl.finish).not.toHaveBeenCalled();
    },
  );

  it('reports fence allocation failure when the rendering transaction succeeded', () => {
    const g = gpu(),
      f = festival(g);
    g.state.allocationFails = true;
    expect(() => submit.call(f.renderer)).toThrow('Unable to allocate GPU frame fence');
    expect(f.renderer.stats.drawCalls).toBe(0);
  });

  it('cannot report a successful submission when the context is lost during rendering', () => {
    const g = gpu(),
      f = festival(g),
      circuitLease = acquire(g.gl);
    vi.spyOn(f.renderer['composer'], 'render').mockImplementation(() => {
      g.work('composer before context loss');
      g.state.lost = true;
    });
    expect(() => submit.call(f.renderer)).toThrow('GPU context lost');
    expect(f.renderer.stats.drawCalls).toBe(0);
    expect(circuitLease.diagnostics()).toMatchObject({
      pending: false,
      submitted: 0,
      completed: 0,
    });
    expect(circuitLease.ready()).toBe(false);
    expect(g.state.fences).toHaveLength(0);
    expect(g.state.deleted).toHaveLength(0);
  });

  it('shares failed waits and context loss with replacement borrowers without inventing completion', () => {
    for (const fault of ['wait', 'context'] as const) {
      const g = gpu(),
        f = festival(g),
        circuitLease = acquire(g.gl);
      g.queue(circuitLease);
      if (fault === 'wait') g.state.waitResult = g.gl.WAIT_FAILED;
      else g.state.lost = true;
      expect(() => f.renderer.canSubmitFrame()).toThrow(
        fault === 'wait' ? 'Unable to check' : 'GPU context lost',
      );
      expect(circuitLease.ready()).toBe(false);
      expect(circuitLease.diagnostics().completed).toBe(0);
      f.renderer.dispose();
      g.state.lost = false;
      const next = festival(g);
      expect(() => next.renderer.canSubmitFrame()).toThrow(
        fault === 'wait' ? 'Unable to check' : 'GPU context lost',
      );
      expect(g.state.deleted).toHaveLength(fault === 'wait' ? 1 : 0);
      expect(g.gl.finish).not.toHaveBeenCalled();
    }
  });

  it('retains the existing zero-time stall contract across alternating owners', () => {
    const g = gpu(),
      first = acquire(g.gl),
      second = acquire(g.gl);
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    g.queue(first);
    for (now = 16; now < 120000; now += 16) expect((now % 32 ? first : second).ready()).toBe(false);
    expect(() => second.ready()).toThrow('GPU frame completion stalled');
    expect(first.ready()).toBe(false);
    expect(first.diagnostics()).toMatchObject({ completed: 0, submitted: 1 });
    expect(g.state.fences).toHaveLength(1);
    expect(g.state.waits.every(({ flags, timeout }) => flags === 0 && timeout === 0)).toBe(true);
    expect(g.gl.finish).not.toHaveBeenCalled();
  });
});

function prepareFixture() {
  const g = gpu(),
    f = festival(g),
    circuitLease = acquire(g.gl);
  const bake = vi.spyOn(materials, 'prepareMaterials').mockImplementation(() => {
    g.work('materials');
    return 1;
  });
  const compile = vi.spyOn(preparation, 'compileSceneTarget').mockImplementation(async () => {
    g.work('compile');
    return new T.Scene();
  });
  let cancelled = false;
  const progress = vi.fn();
  const run = (yieldFrame: () => Promise<void>) =>
    f.renderer.prepareGpu(new Float32Array(), progress, () => cancelled, yieldFrame);
  return {
    g,
    f,
    circuitLease,
    bake,
    compile,
    progress,
    run,
    cancel: () => {
      cancelled = true;
    },
  };
}

describe('Festival preparation observes real shared completion', () => {
  it('waits for handoff, material work, compilation and both actual warm-up draws', async () => {
    const h = prepareFixture();
    h.g.queue(h.circuitLease);
    let yields = 0,
      finalWaits = 0,
      completed = false;
    const result = await h
      .run(async () => {
        yields++;
        if (h.g.state.fences.length === 5) finalWaits++;
        expect(completed).toBe(false);
        if (yields % 3 === 0) h.g.complete();
      })
      .then((value) => {
        completed = true;
        return value;
      });
    expect(result).toBe(true);
    expect(h.bake).toHaveBeenCalledOnce();
    expect(h.compile).toHaveBeenCalledOnce();
    expect(h.f.state.draw).toHaveBeenCalledTimes(2);
    expect(finalWaits).toBeGreaterThan(0);
    expect(h.f.renderer.diagnostics().gpuFrameQueue).toMatchObject({
      pending: false,
      submitted: 5,
      completed: 5,
    });
    expect(h.g.state.fences.map((fence) => fence.through)).toEqual([1, 2, 3, 11, 19]);
    expect(h.g.state.waits.every(({ flags, timeout }) => flags === 0 && timeout === 0)).toBe(true);
    expect(h.g.gl.finish).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2, 3, 4])(
    'cancels with %s completed preparation stages without consuming pending work',
    async (stage) => {
      const h = prepareFixture();
      h.g.queue(h.circuitLease);
      const result = await h.run(async () => {
        if (h.g.state.fences.length === stage + 1) h.cancel();
        else h.g.complete();
      });
      expect(result).toBe(false);
      expect(h.f.state.draw).toHaveBeenCalledTimes(Math.max(0, stage - 2));
      h.f.renderer.dispose();
      expect(h.circuitLease.ready()).toBe(false);
      expect(h.circuitLease.diagnostics()).toMatchObject({ pending: true, completed: stage });
      expect(h.g.state.deleted).toHaveLength(stage);
      expect(h.g.gl.finish).not.toHaveBeenCalled();
    },
  );

  it('returns false without progress, yield or work when already cancelled', async () => {
    const h = prepareFixture(),
      yieldFrame = vi.fn(async () => {});
    h.cancel();
    expect(await h.run(yieldFrame)).toBe(false);
    expect(h.progress).not.toHaveBeenCalled();
    expect(yieldFrame).not.toHaveBeenCalled();
    expect(h.g.state.fences).toHaveLength(0);
  });

  it('fences synchronous compile work before cancellation disposes its owner during the await', async () => {
    const h = prepareFixture();
    let resolve!: (scene: T.Object3D) => void;
    h.compile.mockImplementation(() => {
      h.g.work('compile');
      return new Promise<T.Object3D>((done) => {
        resolve = done;
      });
    });
    const pending = h.run(async () => h.g.complete());
    for (let i = 0; i < 20 && !resolve; i++) await Promise.resolve();
    expect(resolve).toBeTypeOf('function');
    expect(h.circuitLease.diagnostics()).toMatchObject({
      pending: true,
      submitted: 2,
      completed: 1,
    });
    h.cancel();
    h.f.renderer.dispose();
    expect(h.compile.mock.calls[0][5]?.cancelled()).toBe(true);
    resolve(new T.Scene());
    expect(await pending).toBe(false);
    expect(h.circuitLease.ready()).toBe(false);
    expect(h.f.state.draw).not.toHaveBeenCalled();
    expect(h.g.state.deleted).toHaveLength(1);
  });

  it.each(['fence', 'context'] as const)(
    'observes a late compile rejection after preparation promptly fails on %s submission',
    async (fault) => {
      const h = prepareFixture();
      let reject!: (error: unknown) => void;
      const compiling = new Promise<T.Object3D>((_resolve, fail) => {
        reject = fail;
      });
      h.compile.mockImplementation(() => {
        h.g.work('compile');
        if (fault === 'fence') h.g.state.allocationFails = true;
        else h.g.state.lost = true;
        return compiling;
      });
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        let rejected = false;
        let failure: unknown;
        const preparing = h
          .run(async () => h.g.complete())
          .catch((error) => {
            rejected = true;
            failure = error;
          });
        for (let i = 0; i < 20 && !rejected; i++) await Promise.resolve();
        // No compile settlement is needed to report the synchronous GPU failure.
        expect(rejected).toBe(true);
        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toContain(
          fault === 'fence' ? 'Unable to allocate GPU frame fence' : 'GPU context lost',
        );
        expect(h.compile).toHaveBeenCalledOnce();
        expect(h.f.state.draw).not.toHaveBeenCalled();
        h.cancel();
        h.f.renderer.dispose();
        expect(h.compile.mock.calls[0][5]?.cancelled()).toBe(true);
        reject(new Error('late compile rejection'));
        await new Promise<void>((resolve) => setImmediate(resolve));
        await preparing;
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.removeListener('unhandledRejection', unhandled);
      }
    },
  );

  it('still propagates a compile rejection when its synchronous fence succeeds', async () => {
    const h = prepareFixture(),
      failure = new Error('compile rejected');
    h.compile.mockRejectedValue(failure);
    await expect(h.run(async () => h.g.complete())).rejects.toBe(failure);
    expect(h.f.state.draw).not.toHaveBeenCalled();
    expect(h.circuitLease.diagnostics().failure).toBeNull();
  });

  describe.each(['materials', 'compile'] as const)('first synchronous %s failure', (stage) => {
    it.each([new Error('first preparation failure'), undefined, 0])(
      'preserves the stage error when fencing separately fails (%s)',
      async (failure) => {
        const h = prepareFixture();
        const work = () => {
          h.g.work(`partial ${stage}`);
          h.g.state.allocationFails = true;
          throw failure;
        };
        if (stage === 'materials') h.bake.mockImplementation(work);
        else h.compile.mockImplementation(work);
        await expect(h.run(async () => h.g.complete())).rejects.toBe(failure);
        expect(h.circuitLease.diagnostics().failure).toBe('Unable to allocate GPU frame fence');
        expect(h.f.state.draw).not.toHaveBeenCalled();
      },
    );
  });

  it('expires the preparation deadline while leaving the real pending fence to its other owner', async () => {
    const h = prepareFixture();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    h.f.renderer.preparationTimeoutMs = 32;
    h.g.queue(h.circuitLease);
    await expect(
      h.run(async () => {
        now += 16;
      }),
    ).rejects.toThrow('GPU preparation did not complete within 32ms');
    expect(h.bake).not.toHaveBeenCalled();
    h.f.renderer.dispose();
    expect(h.circuitLease.diagnostics()).toMatchObject({
      pending: true,
      submitted: 1,
      completed: 0,
      failure: null,
    });
    expect(h.g.state.deleted).toEqual([]);
    h.g.complete();
    expect(h.circuitLease.ready()).toBe(true);
  });

  it.each(['wait', 'context'] as const)(
    'rejects preparation promptly on %s failure',
    async (fault) => {
      const h = prepareFixture();
      h.g.queue(h.circuitLease);
      await expect(
        h.run(async () => {
          if (fault === 'wait') h.g.state.waitResult = h.g.gl.WAIT_FAILED;
          else h.g.state.lost = true;
        }),
      ).rejects.toThrow(fault === 'wait' ? 'Unable to check GPU frame' : 'GPU context lost');
      expect(h.bake).not.toHaveBeenCalled();
      expect(h.f.state.draw).not.toHaveBeenCalled();
      expect(h.circuitLease.diagnostics().completed).toBe(0);
    },
  );
});
