import { EnvironmentPreparation } from '../src/engine/babylon/environment-preparation.ts';
import { waitForPresentation } from '../src/engine/babylon/presentation-ready.ts';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import type { BabylonStartGantryOptions } from '../src/engine/babylon/start-gantry.ts';
import gantryManifest from '../src/rendering/start-gantry.manifest.json' with { type: 'json' };
import { PausedStartupPublication } from '../src/engine/babylon/paused-startup-publication.ts';
import { GridPreparation, gridPreparationValid } from '../src/engine/babylon/grid-preparation.ts';
import { createBabylonGridPaint } from '../src/engine/babylon/grid-paint.ts';
import { FORMULA_APX01 } from '../src/simulation/vehicles.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { BabylonCircuitScene } from '../src/engine/babylon/circuit-scene.ts';
import { SimulationComponent } from '../src/engine/simulation-component.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { controls } from '../src/simulation/config.ts';
import { F, carBase } from '../src/simulation/protocol.ts';
import {
  RestartPresentation,
  RestartSceneReuse,
} from '../src/engine/babylon/restart-scene-reuse.ts';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
import type {
  BabylonPresentationGpu,
  PresentationReceipt,
} from '../src/engine/babylon/presentation-gpu.ts';
import {
  captureStartupVisualState,
  captureRestartStaticState,
} from '../src/engine/babylon/startup-visual-state.ts';
import { RestartOwnership } from '../src/engine/babylon/restart-ownership.ts';
import { readFileSync } from 'node:fs';
import { transpileModule } from 'typescript';
import { runInNewContext } from 'node:vm';
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((fn) => fn());
  vi.restoreAllMocks();
});
const fresh = () => new SimulationComponent({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
function setup() {
  const engine = new NullEngine();
  const component = fresh();
  const view = new BabylonCircuitScene(engine, component.simulation.track, 1);
  view.render(component.frame);
  cleanup.push(() => {
    view.dispose();
    engine.dispose();
  });
  return { view, component };
}
const graphics = () =>
  ({
    phase: 'idle',
    settled: true,
    lost: false,
    disposed: false,
    losses: 0,
    submitted: 6,
    completed: 6,
    lastCompletedSequence: 6,
    queue: { pending: false, failure: null },
    preparation: { active: false, failure: null },
  }) as ReturnType<BabylonPresentationGpu['diagnostics']>;
function receipts() {
  let submitted = 6;
  const listeners = new Set<(r: PresentationReceipt) => void>();
  return {
    gpu: {
      subscribe(fn: (r: PresentationReceipt) => void) {
        const baseline = submitted;
        const future = (r: PresentationReceipt) => {
          if (r.kind !== 'completed' || r.sequence > baseline) fn(r);
        };
        listeners.add(future);
        return () => {
          listeners.delete(future);
        };
      },
    } as BabylonPresentationGpu,
    emit(owner: object, ready = true, sequence = ++submitted) {
      for (const fn of [...listeners]) fn({ kind: 'completed', owner, ready, sequence });
    },
    lost() {
      for (const fn of [...listeners]) fn({ kind: 'lost' });
    },
    count: () => listeners.size,
  };
}
describe('narrow retained scene restart', () => {
  it('retains exact proxy assets but resets a fresh component/Track and actual proxy/camera pose', () => {
    const { view, component } = setup();
    const reference = component.frame.slice(),
      image = captureStartupVisualState(view);
    const assets = [...view.scene.meshes, ...view.scene.materials, ...view.scene.textures];
    component.setInput({ ...controls(), throttle: 1 });
    for (let i = 0; i < 40; i++) component.advance(0.1);
    view.render(component.frame);
    expect(component.simulation.tick).toBeGreaterThan(0);
    const proof = RestartSceneReuse.capture(view, component.simulation.track, graphics(), true);
    expect(proof).not.toBeNull();
    const next = fresh();
    expect(next.simulation.track).not.toBe(component.simulation.track);
    expect(next.frame).toEqual(reference);
    expect(proof!.valid(view, next.simulation.track, graphics(), true)).toBe(true);
    view.render(next.frame);
    expect(captureStartupVisualState(view)).toBe(image);
    expect([...view.scene.meshes, ...view.scene.materials, ...view.scene.textures]).toEqual(assets);
  });
  it('permits only render-owned pose changes while protecting static bindings and parameters', () => {
    const { view, component } = setup();
    const state = captureRestartStaticState(view);
    component.setInput({ ...controls(), throttle: 1 });
    component.advance(0.1);
    view.render(component.frame);
    expect(captureRestartStaticState(view)).toBe(state);
    const proof = RestartSceneReuse.capture(view, component.simulation.track, graphics(), true)!;
    view.scene.getMeshByName('migration-proxy-0')!.position.y += 1;
    expect(proof.valid(view, fresh().simulation.track, graphics(), true)).toBe(false);
  });
  it.each(['geometry', 'material', 'world', 'track', 'scene', 'enabled'] as const)(
    'rejects changed %s',
    (kind) => {
      const { view, component } = setup();
      const proof = RestartSceneReuse.capture(view, component.simulation.track, graphics(), true)!;
      expect(proof).not.toBeNull();
      const next = fresh();
      let checked = view;
      if (kind === 'geometry') new Mesh('extra', view.scene);
      if (kind === 'material') view.scene.materials[0].alpha = 0.5;
      if (kind === 'world') view.scene.meshes[0].freezeWorldMatrix(Matrix.Translation(5, 0, 0));
      if (kind === 'track') next.simulation.track.points[0].x += 1;
      if (kind === 'scene') checked = setup().view;
      if (kind === 'enabled') view.scene.meshes[0].setEnabled(false);
      expect(proof.valid(checked, next.simulation.track, graphics(), true)).toBe(false);
    },
  );
  it.each([null, '', undefined] as const)(
    'requires explicitly healthy queue/compiler failure fields (%s)',
    (failure) => {
      const { view, component } = setup();
      const g = graphics();
      g.queue.failure = failure as string | null;
      expect(!!RestartSceneReuse.capture(view, component.simulation.track, g, true)).toBe(
        failure === null,
      );
      g.queue.failure = null;
      g.preparation.failure = failure as string | null;
      expect(!!RestartSceneReuse.capture(view, component.simulation.track, g, true)).toBe(
        failure === null,
      );
    },
  );
  it('waits for old GPU drain and rejects loss, incomplete/model eligibility and unknown health', () => {
    const { view, component } = setup();
    const g = graphics();
    g.phase = 'waiting';
    g.settled = false;
    g.queue.pending = true;
    const proof = RestartSceneReuse.capture(view, component.simulation.track, g, true)!;
    expect(proof).not.toBeNull();
    expect(proof.valid(view, fresh().simulation.track, g, true)).toBe(false);
    expect(
      RestartSceneReuse.capture(view, component.simulation.track, graphics(), false),
    ).toBeNull();
    for (const patch of [
      { lost: true },
      { disposed: true },
      { losses: 1 },
      { phase: 'failed' as const },
    ])
      expect(proof.valid(view, fresh().simulation.track, { ...graphics(), ...patch }, true)).toBe(
        false,
      );
  });
  it('requires two NEW ready same-scene receipts, keeps demand alive, and rejects old/nonready receipts', async () => {
    const { view } = setup(),
      events = receipts(),
      schedule = new PresentationSchedule(),
      owner = new AbortController();
    const reset = new RestartPresentation(
      view,
      events.gpu,
      schedule,
      owner.signal,
      performance.now() + 120000,
    );
    events.emit(view.scene, true, 6);
    events.emit({}, true, 7);
    await Promise.resolve();
    expect(reset.completed).toBe(false);
    events.emit(view.scene, true, 8);
    events.emit(view.scene, false, 9);
    events.emit(view.scene, true, 10);
    await Promise.resolve();
    expect(reset.completed).toBe(false);
    expect(schedule.shouldRender(true)).toBe(true);
    events.emit(view.scene, true, 11);
    await reset.completion;
    expect(reset.completed).toBe(true);
    expect(schedule.diagnostics().preparationCount).toBe(0);
    expect(events.count()).toBe(0);
  });
  it.each(['restart', 'loss', 'abort'] as const)(
    'cancels reset completion on %s without consuming replacement demand',
    async (kind) => {
      const { view } = setup(),
        events = receipts(),
        schedule = new PresentationSchedule(),
        owner = new AbortController();
      const reset = new RestartPresentation(
        view,
        events.gpu,
        schedule,
        owner.signal,
        performance.now() + 120000,
      );
      events.emit(view.scene);
      if (kind === 'restart') reset.dispose();
      else if (kind === 'loss') {
        events.lost();
        reset.dispose();
      } else owner.abort(null);
      await expect(reset.completion).rejects.toBeDefined();
      expect(reset.completed).toBe(false);
      expect(schedule.diagnostics().preparationCount).toBe(0);
      expect(events.count()).toBe(0);
    },
  );
  it.each(['entrant', 'proxy'] as const)(
    'rejects already-frozen snapshot-owned %s before selecting reuse',
    (kind) => {
      const { view, component } = setup();
      const node =
        kind === 'entrant' ? view.entrants[0] : view.scene.getMeshByName('migration-proxy-0')!;
      node.freezeWorldMatrix();
      expect(
        RestartSceneReuse.capture(view, component.simulation.track, graphics(), true),
      ).toBeNull();
    },
  );
  it('a loss receipt alone resets consecutive readiness, while actual main loss disposes the wait', async () => {
    const { view } = setup(),
      events = receipts(),
      schedule = new PresentationSchedule();
    const reset = new RestartPresentation(
      view,
      events.gpu,
      schedule,
      new AbortController().signal,
      performance.now() + 120000,
    );
    events.emit(view.scene);
    events.lost();
    events.emit(view.scene);
    await Promise.resolve();
    expect(reset.completed).toBe(false);
    events.emit(view.scene);
    await reset.completion;
    expect(reset.completed).toBe(true);
  });
  it('checks absolute deadline even when timeout callback has not run', async () => {
    const { view } = setup(),
      events = receipts(),
      schedule = new PresentationSchedule();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const reset = new RestartPresentation(
      view,
      events.gpu,
      schedule,
      new AbortController().signal,
      100,
    );
    events.emit(view.scene);
    now = 101;
    events.emit(view.scene);
    await expect(reset.completion).rejects.toThrow('original readiness budget');
    expect(reset.completed).toBe(false);
    expect(
      () => new RestartPresentation(view, events.gpu, schedule, new AbortController().signal, 100),
    ).toThrow('original readiness budget');
  });
  it('actual RestartOwnership immediately replaces authority while GPU drain is held', () => {
    let owner = fresh(),
      abort = 0;
    const old = owner;
    const restart = new RestartOwnership(
      () => abort++,
      () => (owner = fresh()),
    );
    restart.request();
    expect(owner).not.toBe(old);
    expect(owner.simulation.track).not.toBe(old.simulation.track);
    expect(owner.frame[carBase(0) + F.THROTTLE]).toBe(0);
    const rebuild = vi.fn();
    expect(restart.drain(false, rebuild)).toBe(false);
    expect(rebuild).not.toHaveBeenCalled();
    const latest = owner;
    expect(restart.drain(true, rebuild)).toBe(true);
    expect(rebuild).toHaveBeenCalledWith(latest);
    expect(abort).toBe(1);
  });
});

describe('production restart selection before invalidation', () => {
  function requestHarness() {
    const { view, component } = setup();
    const abort = new AbortController();
    const complete = {
      completed: true,
      eligible: true,
      receipt: () => ({}),
      captureRetainedProof() {
        return {
          valid: () => {
            try {
              this.receipt();
              return this.completed && this.eligible;
            } catch {
              return false;
            }
          },
        };
      },
    };
    const context: Record<string, unknown> = {
      RestartOwnership,
      RestartSceneReuse,
      gridPreparationValid,
      SimulationComponent,
      DEFAULT_OPTIONS,
      settings: { setup: DEFAULT_OPTIONS.setup },
      gpu: { diagnostics: graphics },
      scene: view,
      sceneTrack: component.simulation.track,
      component,
      componentEpoch: 1,
      modelAttempted: false,
      playerWheels: undefined,
      playerSteering: undefined,
      stopped: false,
      graphicsRecovery: { restartRequired: false },
      resizePending: false,
      restartPresentation: undefined,
      assetLoad: abort,
      surfacePreparation: complete,
      environmentPreparation: {
        ...complete,
        gantry: complete,
        lamps: complete,
        banner: complete,
        grid: complete,
      },
      stripePreparation: complete,
      reuseCandidate: null,
      startupPublication: undefined,
      restartSceneDecision: null,
      readSurfaceDiagnostics: () => ({}),
      clearSurfaceDiagnostics: vi.fn(),
      loadAsset: { disabled: false },
      assetStatus: { textContent: '' },
    };
    const source = readFileSync('src/engine/babylon/main.ts', 'utf8');
    const declaration = source
      .slice(
        source.indexOf('const restartOwnership = new RestartOwnership'),
        source.indexOf('let renderedFrames = 0;'),
      )
      .replace('const restartOwnership =', 'globalThis.testOwnership =');
    runInNewContext(
      transpileModule(
        'function setPaused(value) { component.setPaused(value); }\n' + declaration,
        {},
      ).outputText,
      context,
    );
    context.restartOwnership = context.testOwnership;
    return {
      context,
      abort,
      request: () => (context.testOwnership as RestartOwnership<SimulationComponent>).request(),
    };
  }
  it.each([
    'retained',
    'changed-scene',
    'changed-component',
    'aborted',
    'environment-aborted',
    'replaced-grid',
    'missing-proof',
    'mutated-grid',
    'repeat',
  ] as const)(
    'actual pending RestartOwnership drain with real grid: %s (retention still requires a fresh reset pair)',
    async (mode) => {
      const h = requestHarness(),
        events = receipts(),
        schedule = new PresentationSchedule();
      const view = h.context.scene as BabylonCircuitScene;
      const controller = h.context.restartOwnership as RestartOwnership<SimulationComponent>;
      h.context.currentScene = view;
      const main = readFileSync('src/engine/babylon/main.ts', 'utf8');
      const environmentSource = main.slice(
        main.indexOf('const environment = new EnvironmentPreparation('),
      );
      const currentSource = environmentSource.match(/isCurrent: (\(\) => [^\n]+),/)!;
      expect(currentSource).not.toBeNull();
      const isCurrent = runInNewContext(`(${currentSource[1]})`, h.context) as () => boolean;
      const gpu = {
        ...events.gpu,
        diagnostics: graphics,
        prepare: async (
          _label: string,
          _deadline: number,
          work: (signal: AbortSignal) => Promise<void>,
        ) => work(h.abort.signal),
      } as BabylonPresentationGpu;
      h.context.gpu = gpu;
      // Sibling meshes/materials are synthetic CPU fixtures, not art/parity proof.
      // The actual cohort, all four wrappers, grid adapter and receipt subscriptions
      // are production code, including the cohort's combined cancellation signal.
      const forwarded: AbortSignal[] = [];
      const sibling = async (
        kind: 'gantry' | 'lamps' | 'banner',
        options: Pick<BabylonStartGantryOptions, 'scene' | 'signal'>,
      ) => {
        forwarded.push(options.signal);
        const scene = options.scene,
          count = kind === 'gantry' ? 4 : kind === 'lamps' ? 5 : 1;
        const materials = Array.from({ length: kind === 'lamps' ? 5 : 1 }, (_, i) => {
          const material = new PBRMaterial(`${kind}-${i}`, scene);
          material.emissiveIntensity = 0;
          scene.removeMaterial(material);
          return material;
        });
        const meshes = Array.from({ length: count }, (_, i) => {
          const mesh = CreatePlane(`${kind}-${i}`, {}, scene);
          mesh.setIndices(
            Array.from(
              { length: kind === 'gantry' ? 7140 : kind === 'lamps' ? 240 : 6 },
              (_, j) => j % 3,
            ),
          );
          mesh.material = materials[kind === 'lamps' ? i : 0];
          mesh.computeWorldMatrix(true);
          scene.removeMesh(mesh);
          return mesh;
        });
        const texture =
          kind === 'banner'
            ? RawTexture.CreateRGBATexture(new Uint8Array(512 * 128 * 4), 512, 128, scene)
            : undefined;
        if (texture) {
          materials[0].albedoTexture = texture;
          scene.removeTexture(texture);
        }
        let state = 'prepared';
        const abort = new AbortController();
        return {
          apply: () => {},
          diagnostics: () => ({
            state,
            parts: meshes.map((mesh) => ({ mesh, material: mesh.material })),
            activeParts: meshes.filter((mesh) => scene.meshes.includes(mesh)).length,
            activeMaterials: materials.filter((m) => scene.materials.includes(m)).length,
            activeTextures:
              kind === 'gantry' ? 3 : texture && scene.textures.includes(texture) ? 1 : 0,
            sha256: gantryManifest.sha256,
            mesh: meshes[0],
            material: materials[0],
            texture,
            hardwareSrgb: true,
          }),
          async install() {
            state = 'installing';
            meshes.forEach((mesh) => scene.addMesh(mesh));
            materials.forEach((m) => scene.addMaterial(m));
            if (texture) scene.addTexture(texture);
            await waitForPresentation(scene, AbortSignal.any([options.signal, abort.signal]), gpu);
            state = 'ready';
          },
          dispose() {
            abort.abort();
            state = 'disposed';
            meshes.forEach((m) => m.dispose());
            materials.forEach((m) => m.dispose());
            texture?.dispose();
          },
        };
      };
      type Dependencies = NonNullable<ConstructorParameters<typeof EnvironmentPreparation>[2]>;
      const environment = new EnvironmentPreparation(
        {
          scene: view.scene,
          track: (h.context.component as SimulationComponent).simulation.track,
          context: { presentation: 'circuit', vehicles: [FORMULA_APX01] },
          base: 'https://example.invalid/',
          signal: h.abort.signal,
          gpu,
          schedule,
          deadline: performance.now() + 120000,
          isCurrent,
        },
        () => (h.context.component as SimulationComponent).frame,
        {
          gantry: ((o: Pick<BabylonStartGantryOptions, 'scene' | 'signal'>) =>
            sibling('gantry', o)) as unknown as Dependencies['gantry'],
          lamps: ((o: Pick<BabylonStartGantryOptions, 'scene' | 'signal'>) =>
            sibling('lamps', o)) as unknown as Dependencies['lamps'],
          banner: ((o: Pick<BabylonStartGantryOptions, 'scene' | 'signal'>) =>
            sibling('banner', o)) as unknown as Dependencies['banner'],
          grid: (options) => {
            forwarded.push(options.signal);
            return createBabylonGridPaint(options, { prepare: async () => {} });
          },
        },
      );
      cleanup.push(() => {
        environment.grid = grid;
        environment.dispose();
      });
      for (let turn = 0; turn < 100; turn++) await Promise.resolve();
      expect(environment.canDraw).toBe(true);
      expect(forwarded).toHaveLength(4);
      expect(new Set(forwarded).size).toBe(1);
      expect(forwarded[0]).not.toBe(h.abort.signal);
      events.emit(view.scene);
      events.emit(view.scene);
      await environment.completion;
      const grid = environment.grid!;
      h.context.environmentPreparation = environment;
      Object.assign(h.context, {
        PausedStartupPublication,
        RestartPresentation,
        presentation: schedule,
        paused: true,
        captureStartupVisualState,
        graphicsRecovery: { restartRequired: false, rebuilt: vi.fn() },
        publishSurfaceDiagnostics: vi.fn(),
        publishEnvironmentDiagnostics: vi.fn(),
        requestPresentation: vi.fn(),
        status: { dataset: {} },
        stop: vi.fn(),
      });
      h.request();
      expect(h.context.reuseCandidate).not.toBeNull();
      expect(h.abort.signal.aborted).toBe(false);
      expect(controller.pending).toBe(true);
      expect(grid.completed).toBe(false);
      expect(() => grid.receipt()).toThrow();
      expect(grid.captureRetainedProof()).toBeNull();
      const helper = main.slice(
        main.indexOf('function tryReuseScene('),
        main.indexOf('function rebuildScene('),
      );
      const reuse = runInNewContext(transpileModule(`(${helper})`, {}).outputText, h.context) as (
        owner: SimulationComponent,
        deadline: number,
        candidate: unknown,
      ) => boolean;
      let accepted = false;
      if (mode === 'changed-scene') h.context.scene = setup().view;
      if (mode === 'changed-component') h.context.component = fresh();
      if (mode === 'aborted') h.abort.abort();
      if (mode === 'environment-aborted') {
        environment.dispose();
        expect(h.abort.signal.aborted).toBe(false);
      }
      if (mode === 'replaced-grid')
        (h.context.environmentPreparation as { grid: unknown }).grid = {};
      if (mode === 'missing-proof')
        (h.context.reuseCandidate as { gridProof: unknown }).gridProof = null;
      if (mode === 'mutated-grid') {
        const material = view.scene.materials.find((m) =>
          m.name.startsWith('Original Aurel Formula grid paint'),
        )!;
        material.alpha = 0.5;
      }
      if (mode === 'repeat') h.request();
      try {
        expect(
          controller.drain(false, () => {
            throw new Error('undrained GPU handoff');
          }),
        ).toBe(false);
        expect(
          controller.drain(true, (owner) => {
            expect(controller.pending).toBe(true);
            expect(gridPreparationValid(grid)).toBe(false);
            accepted = reuse(owner, performance.now() + 120000, h.context.reuseCandidate);
          }),
        ).toBe(true);
        if (mode !== 'retained') {
          expect(accepted).toBe(false);
          expect(h.context.restartPresentation).toBeUndefined();
          return;
        }
        expect(accepted).toBe(true);
        expect(grid.completed).toBe(true);
        const reset = h.context.restartPresentation as RestartPresentation;
        expect(reset).toBeInstanceOf(RestartPresentation);
        expect(reset.completed).toBe(false);
        events.emit(view.scene);
        await Promise.resolve();
        expect(reset.completed).toBe(false);
        events.emit(view.scene);
        await reset.completion;
        expect(reset.completed).toBe(true);
        expect(h.context.stop).not.toHaveBeenCalled();
      } finally {
        h.context.stopped = true;
        (h.context.restartPresentation as RestartPresentation | undefined)?.dispose();
        (h.context.startupPublication as PausedStartupPublication | undefined)?.dispose();
      }
    },
  );
  it('retains completed scene ownership before invalidation and freshens physics immediately (old unconditional rebuild regresses)', () => {
    const h = requestHarness(),
      old = h.context.component as SimulationComponent;
    h.request();
    expect(h.context.reuseCandidate).not.toBeNull();
    expect(h.abort.signal.aborted).toBe(false);
    expect(h.context.component).not.toBe(old);
    expect((h.context.component as SimulationComponent).simulation.track).not.toBe(
      old.simulation.track,
    );
    expect(h.context.componentEpoch).toBe(2);
    expect(h.context.clearSurfaceDiagnostics).toHaveBeenCalledOnce();
  });
  it.each(['modelAttempted', 'playerWheels', 'resizePending', 'stopped'] as const)(
    'keeps full abort/rebuild fallback for %s',
    (field) => {
      const h = requestHarness();
      h.context[field] = true;
      h.request();
      expect(h.context.reuseCandidate).toBeNull();
      expect(h.abort.signal.aborted).toBe(true);
    },
  );
  it('rejects incomplete owners and repeated pending restart without delaying authority', () => {
    const h = requestHarness();
    h.request();
    const first = h.context.component;
    h.request();
    expect(h.context.reuseCandidate).toBeNull();
    expect(h.abort.signal.aborted).toBe(true);
    expect(h.context.component).not.toBe(first);
    const incomplete = requestHarness();
    (incomplete.context.surfacePreparation as { completed: boolean }).completed = false;
    incomplete.request();
    expect(incomplete.context.reuseCandidate).toBeNull();
    expect(incomplete.abort.signal.aborted).toBe(true);
  });
  it.each(['missing', 'incomplete', 'ineligible', 'mutated'] as const)(
    'never selects retained reuse with %s grid evidence',
    (kind) => {
      const h = requestHarness();
      const environment = h.context.environmentPreparation as { grid: unknown };
      environment.grid =
        kind === 'missing'
          ? undefined
          : {
              completed: kind !== 'incomplete',
              eligible: kind !== 'ineligible',
              receipt() {
                if (kind === 'mutated') throw undefined;
                return {};
              },
            };
      h.request();
      expect(h.context.reuseCandidate).toBeNull();
      expect(h.abort.signal.aborted).toBe(true);
    },
  );
  it.each(['missing', 'missing-captured', 'replaced', 'mutated'] as const)(
    'revalidates %s grid at drained handoff, not only the first Restart click',
    (kind) => {
      const h = requestHarness();
      h.request();
      const candidate = h.context.reuseCandidate;
      expect(candidate).not.toBeNull();
      if (kind === 'missing-captured') (candidate as { grid?: unknown }).grid = undefined;
      const environment = h.context.environmentPreparation as {
        grid: { completed: boolean; eligible: boolean; receipt(): unknown };
      };
      if (kind === 'missing') environment.grid = undefined as unknown as typeof environment.grid;
      if (kind === 'replaced')
        environment.grid = { completed: true, eligible: true, receipt: () => ({}) };
      if (kind === 'mutated')
        environment.grid.receipt = () => {
          throw null;
        };
      const source = readFileSync('src/engine/babylon/main.ts', 'utf8');
      const helper = source.slice(
        source.indexOf('function tryReuseScene('),
        source.indexOf('function rebuildScene('),
      );
      const reuse = runInNewContext(transpileModule(`(${helper})`, {}).outputText, h.context) as (
        owner: SimulationComponent,
        deadline: number,
        candidate: unknown,
      ) => boolean;
      expect(
        reuse(h.context.component as SimulationComponent, performance.now() + 120000, candidate),
      ).toBe(false);
      expect(h.context.restartPresentation).toBeUndefined();
    },
  );
  it('keeps eligible rebuilt and retained readiness copy identical for the unmasked reset image proof', () => {
    const main = readFileSync('src/engine/babylon/main.ts', 'utf8');
    const reuse = main.slice(
      main.indexOf('function tryReuseScene('),
      main.indexOf('function rebuildScene('),
    );
    const startup = main.slice(main.indexOf('function rebuildScene('));
    const message = (source: string, eligible: boolean) => {
      const enable = source.indexOf(
        'loadAsset.disabled = !gridPreparationValid(environmentPreparation?.grid);',
      );
      expect(enable).toBeGreaterThanOrEqual(0);
      const expression = source.slice(enable).match(/assetStatus\.textContent\s*=\s*([\s\S]*?);\n/);
      expect(expression).not.toBeNull();
      const value: unknown = runInNewContext(
        transpileModule(`(${expression![1]})`, {}).outputText,
        {
          environmentPreparation: { gantry: { eligible: true }, grid: { eligible } },
        },
      );
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
      return value;
    };
    expect(message(reuse, true)).toBe(message(startup, true));
    expect(message(startup, false)).toContain('ineligible');
    // A changed success message must not silently satisfy the screenshot parity contract.
    expect(
      message(reuse.replace('Original car is optional.', 'Changed retained message.'), true),
    ).not.toBe(message(startup, true));
  });
  it('gates all public readiness while reset receipts are pending, without gating drawability', () => {
    const main = readFileSync('src/engine/babylon/main.ts', 'utf8');
    expect(main).toContain('if (!stripePreparation?.completed || restartPresentation) return;');
    expect(main).toMatch(/stripePreparation\?\.completed &&\s*!restartPresentation/);
    expect(main).toContain('restartOwnership.drain(true, rebuildScene)');
    expect(main).toContain('new RestartPresentation(');
    const publication = main.slice(
      main.indexOf('status.dataset.sceneReady = String('),
      main.indexOf('const visualInspection ='),
    );
    const settled = main.slice(
      main.indexOf('status.dataset.presentationSettled = String('),
      main.indexOf('if (now - lastStatus > 250)'),
    );
    const model = main.slice(
      main.indexOf('loadAsset.addEventListener('),
      main.indexOf("document.addEventListener(\n    'visibilitychange'"),
    );
    expect(publication).toContain('gridPreparationValid(environmentPreparation?.grid)');
    expect(settled).toContain('gridPreparationValid(environmentPreparation?.grid)');
    expect(model).toContain('if (!gridPreparationValid(environmentPreparation?.grid)) return;');
    expect(main).toContain('candidate.gridProof.valid(scene.scene)');
    expect(main).toContain('gridPreparationValid(environment.grid)');
    expect(
      main.match(/loadAsset\.disabled = !gridPreparationValid\(environmentPreparation\?\.grid\);/g),
    ).toHaveLength(3);

    const drawGate = main.slice(
      main.indexOf('if (polled.ready)'),
      main.indexOf('gpu!.frame(presentation'),
    );
    expect(drawGate).not.toContain('!restartPresentation');
  });
});

it('retains actual original grid buffers on reset but rejects removed or mutated grid resources', async () => {
  const { view, component } = setup(),
    events = receipts(),
    schedule = new PresentationSchedule(),
    abort = new AbortController();
  const gpu = {
    ...events.gpu,
    prepare: async (
      _label: string,
      _deadline: number,
      work: (signal: AbortSignal) => Promise<void>,
    ) => work(abort.signal),
  } as BabylonPresentationGpu;
  const grid = new GridPreparation(
    {
      scene: view.scene,
      track: component.simulation.track,
      context: { presentation: 'circuit', vehicles: [FORMULA_APX01] },
      signal: abort.signal,
      gpu,
      schedule,
      deadline: performance.now() + 120000,
      isCurrent: () => true,
    },
    (options) => createBabylonGridPaint(options, { prepare: async () => {} }),
  );
  cleanup.push(() => grid.dispose());
  await grid.prepared;
  events.emit(view.scene);
  events.emit(view.scene);
  await grid.completion;
  expect(gridPreparationValid(grid)).toBe(true);
  const actual = view.scene.meshes.filter(
    (mesh) => mesh.name === 'Original Aurel Formula grid paint batch',
  );
  expect(actual).toHaveLength(2);
  expect(grid.receipt()).toMatchObject({
    parts: 2,
    materials: 1,
    textures: 0,
    slots: 12,
    boxes: 36,
    triangles: 432,
  });
  const proof = RestartSceneReuse.capture(view, component.simulation.track, graphics(), true);
  expect(proof).not.toBeNull();
  const next = fresh();
  view.render(next.frame);
  expect(proof!.valid(view, next.simulation.track, graphics(), gridPreparationValid(grid))).toBe(
    true,
  );
  const positions = actual[0].getVerticesData('position')!;
  const changed = Array.from(positions);
  changed[0] += 0.001;
  actual[0].setVerticesData('position', changed);
  expect(gridPreparationValid(grid)).toBe(false);
  expect(proof!.valid(view, next.simulation.track, graphics(), gridPreparationValid(grid))).toBe(
    false,
  );
  expect(gridPreparationValid(undefined)).toBe(false);
  expect(gridPreparationValid(grid, {} as GridPreparation)).toBe(false);
});
