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
    const complete = { completed: true, eligible: true, receipt: () => ({}) };
    const context: Record<string, unknown> = {
      RestartOwnership,
      RestartSceneReuse,
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
      environmentPreparation: { ...complete, gantry: complete, lamps: complete, banner: complete },
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
  it('gates all public readiness while reset receipts are pending, without gating drawability', () => {
    const main = readFileSync('src/engine/babylon/main.ts', 'utf8');
    expect(main).toContain('if (!stripePreparation?.completed || restartPresentation) return;');
    expect(main).toMatch(/stripePreparation\?\.completed &&\s*!restartPresentation/);
    expect(main).toContain('restartOwnership.drain(true, rebuildScene)');
    expect(main).toContain('new RestartPresentation(');
    const drawGate = main.slice(
      main.indexOf('if (polled.ready)'),
      main.indexOf('gpu!.frame(presentation'),
    );
    expect(drawGate).not.toContain('!restartPresentation');
  });
});
