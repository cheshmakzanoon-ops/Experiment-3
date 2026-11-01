import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { LampPreparation } from '../src/engine/babylon/lamp-preparation.ts';
import {
  createBabylonStartLamps,
  type BabylonStartLampsOptions,
} from '../src/engine/babylon/start-lamps.ts';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
import { RestartOwnership } from '../src/engine/babylon/restart-ownership.ts';
import { Track } from '../src/simulation/track.ts';
import { VELLAMAR } from '../src/simulation/circuits.ts';
import { FORMULA_APX01 } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { H, HEADER } from '../src/simulation/protocol.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  cleanups.splice(0).forEach((cleanup) => cleanup());
});
function harness() {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    abort = new AbortController();
  scene.useRightHandedSystem = true;
  const stage = deferred(),
    presented = deferred();
  let current = true;
  let frame: Float32Array = new Float32Array(HEADER);
  const options: BabylonStartLampsOptions = {
    scene,
    track: new Track(),
    context: { presentation: 'circuit', vehicles: [FORMULA_APX01] },
    signal: abort.signal,
    deadline: performance.now() + 120000,
    schedule: new PresentationSchedule(),
    isCurrent: () => current,
    gpu: {
      prepare: async (
        _label: string,
        deadline: number,
        work: (signal: AbortSignal) => Promise<unknown>,
      ) => {
        expect(deadline).toBe(options.deadline);
        return work(new AbortController().signal);
      },
    } as unknown as BabylonStartLampsOptions['gpu'],
  };
  let owner: Awaited<ReturnType<typeof createBabylonStartLamps>> | undefined;
  const load = vi.fn(async (opts: BabylonStartLampsOptions) => {
    expect(opts).toBe(options);
    owner = await createBabylonStartLamps(opts, {
      prepare: async (_container, gpu, signal, deadline) => {
        expect(gpu).toBe(options.gpu);
        expect(signal).toBe(abort.signal);
        expect(deadline).toBe(options.deadline);
        await stage.promise;
      },
      present: async (_scene, signal) => {
        await presented.promise;
        signal.throwIfAborted();
      },
    });
    return owner;
  });
  cleanups.push(() => {
    abort.abort();
    owner?.dispose();
    scene.dispose();
    engine.dispose();
  });
  return {
    options,
    scene,
    abort,
    stage,
    presented,
    load,
    owner: () => owner!,
    frame: () => frame,
    setFrame: (next: Float32Array) => {
      frame = next;
    },
    stale: () => {
      current = false;
    },
  };
}
it('stages separately, blocks inter-variant draws and awaits install presentation without deadlock', async () => {
  const h = harness(),
    lamps = new LampPreparation(h.options, h.frame, h.load);
  await flush();
  expect(lamps.canDraw).toBe(false);
  expect(lamps.completed).toBe(false);
  expect(h.scene.meshes).toHaveLength(0);
  expect(() => lamps.receipt()).toThrow('not ready');
  h.stage.resolve();
  await flush();
  expect(lamps.canDraw).toBe(true);
  expect(lamps.completed).toBe(false);
  expect(h.scene.meshes).toHaveLength(5);
  h.presented.resolve();
  await lamps.completion;
  expect(lamps.receipt()).toEqual({
    state: 'ready',
    parts: 5,
    materials: 5,
    triangles: 400,
    lights: 0,
  });
  expect(h.scene.lights).toHaveLength(0);
  expect(h.scene.environmentTexture).toBeNull();
});
it('uses latest authoritative snapshots during installation and after receipts without writing frame bytes', async () => {
  const h = harness(),
    lamps = new LampPreparation(h.options, h.frame, h.load);
  h.stage.resolve();
  await flush();
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', opponents: 0 });
  for (let i = 0; i < 4 * 120; i++) sim.step(1 / 120);
  const frame = sim.makeFrame(),
    before = frame.slice();
  expect(frame[H.LIGHTS]).toBeGreaterThan(0);
  h.setFrame(frame);
  lamps.apply(frame);
  expect(
    h
      .owner()
      .diagnostics()
      .parts.map(({ material }) => material.emissiveIntensity),
  ).toEqual(Array.from({ length: 5 }, (_, i) => (i < frame[H.LIGHTS] ? 25 : 0)));
  expect(frame).toEqual(before);
  const practice = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    opponents: 0,
  }).makeFrame();
  h.setFrame(practice);
  h.presented.resolve();
  await lamps.completion;
  expect(lamps.receipt().lights).toBe(0);
  lamps.apply(frame);
  expect(lamps.receipt().lights).toBe(frame[H.LIGHTS]);
  lamps.apply(frame);
  lamps.apply(practice);
  expect(lamps.receipt().lights).toBe(0);
  expect(frame).toEqual(before);
});
it.each(['abort', 'stale', 'dispose'] as const)(
  'drains staged resources after %s without publishing',
  async (reason) => {
    const h = harness(),
      lamps = new LampPreparation(h.options, h.frame, h.load);
    const failed = expect(lamps.completion).rejects.toThrow();
    await flush();
    if (reason === 'abort') h.abort.abort();
    else if (reason === 'stale') h.stale();
    else lamps.dispose();
    h.stage.resolve();
    await failed;
    expect(lamps.completed).toBe(false);
    expect(lamps.canDraw).toBe(false);
    expect(h.scene.meshes).toHaveLength(0);
    expect(h.scene.materials).toHaveLength(0);
  },
);
it.each(['abort', 'stale'] as const)(
  'cannot publish an installing owner after %s',
  async (reason) => {
    const h = harness(),
      lamps = new LampPreparation(h.options, h.frame, h.load);
    const failed = expect(lamps.completion).rejects.toThrow();
    h.stage.resolve();
    await flush();
    if (reason === 'abort') h.abort.abort();
    else h.stale();
    h.presented.resolve();
    await failed;
    expect(lamps.completed).toBe(false);
    expect(h.scene.meshes).toHaveLength(0);
  },
);
it('does not allocate lamps in ineligible contexts', async () => {
  const h = harness();
  h.options.track = new Track('clear', false, undefined, VELLAMAR);
  const lamps = new LampPreparation(h.options, h.frame, h.load);
  await lamps.completion;
  expect(h.load).not.toHaveBeenCalled();
  expect(lamps.completed).toBe(true);
  expect(lamps.receipt()).toEqual({
    state: 'ineligible',
    parts: 0,
    materials: 0,
    triangles: 0,
    lights: 0,
  });
});
it('preserves immediate repeated restart authority while scene replacement waits for GPU drain', async () => {
  const h = harness(),
    lamps = new LampPreparation(h.options, h.frame, h.load);
  const failed = expect(lamps.completion).rejects.toThrow();
  const reset = vi.fn(() => ({})),
    restart = new RestartOwnership(() => h.abort.abort(), reset);
  await flush();
  restart.request();
  restart.request();
  const rebuild = vi.fn(() => lamps.dispose());
  expect(restart.drain(false, rebuild)).toBe(false);
  expect(h.abort.signal.aborted).toBe(true);
  h.stage.resolve();
  await failed;
  expect(restart.drain(true, rebuild)).toBe(true);
  expect(rebuild).toHaveBeenCalledWith(reset.mock.results[1].value);
  expect(reset).toHaveBeenCalledTimes(2);
  expect(lamps.completed).toBe(false);
});
it('explicitly drains independent lamp ownership after skipped scene callbacks and falsy cleanup failure', async () => {
  const h = harness(),
    lamps = new LampPreparation(h.options, h.frame, h.load);
  h.stage.resolve();
  h.presented.resolve();
  await lamps.completion;
  const parts = h.owner().diagnostics().parts;
  h.scene.onDisposeObservable.add((_scene, event) => {
    event.skipNextObservers = true;
  });
  h.scene.onDisposeObservable.add(() => {
    throw new Error('must be skipped');
  });
  h.scene.dispose();
  expect(lamps.completed).toBe(false);
  lamps.dispose();
  expect(parts.every(({ mesh }) => mesh.isDisposed())).toBe(true);
  expect(() => lamps.receipt()).toThrow();
});
it('retains fail-closed readiness if explicit owner cleanup throws, and does not skip independent resources', async () => {
  const h = harness(),
    lamps = new LampPreparation(h.options, h.frame, h.load);
  h.stage.resolve();
  h.presented.resolve();
  await lamps.completion;
  const parts = h.owner().diagnostics().parts;
  vi.spyOn(parts[0].material, 'dispose').mockImplementation(() => {
    throw undefined;
  });
  let threw = false;
  try {
    lamps.dispose();
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
  expect(lamps.completed).toBe(false);
  expect(h.scene.meshes).toHaveLength(0);
  expect(parts.every(({ mesh }) => mesh.isDisposed())).toBe(true);
});
it('rejects retained or replaced resources and counts actual emission rather than snapshot metadata', async () => {
  const h = harness(),
    lamps = new LampPreparation(h.options, h.frame, h.load);
  h.stage.resolve();
  h.presented.resolve();
  await lamps.completion;
  const part = h.owner().diagnostics().parts[0];
  part.material.emissiveIntensity = 25;
  expect(lamps.receipt().lights).toBe(1);
  part.material.emissiveIntensity = 3;
  expect(() => lamps.receipt()).toThrow('activation incomplete');
  part.material.emissiveIntensity = 0;
  h.scene.removeMaterial(part.material);
  expect(() => lamps.receipt()).toThrow('activation incomplete');
});
it('wires lamps after structural readiness under the existing deadline and keeps GPU receipts independent', () => {
  const source = readFileSync('src/engine/babylon/main.ts', 'utf8');
  const batch = readFileSync('src/engine/babylon/environment-preparation.ts', 'utf8');
  const startup = source.slice(
    source.indexOf('function rebuildScene'),
    source.indexOf("window.addEventListener('pagehide'"),
  );
  expect(startup.match(/performance.now\(\) \+ 120000/g)).toHaveLength(1);
  expect(batch.indexOf('new LampPreparation')).toBeGreaterThan(
    batch.indexOf('await this.gantry.prepared'),
  );
  expect(batch).toContain('await this.lamps.prepared');
  expect(startup.indexOf('loadAsset.disabled = false')).toBeGreaterThan(
    startup.indexOf('await environment.completion'),
  );
  expect(startup.slice(startup.indexOf('await environment.completion'))).toContain(
    'requestPresentation()',
  );
  expect(source).toContain("mode: 'practice'");
  expect(source).toContain('!environmentPreparation?.lamps?.completed');
  expect(source).toContain('(!environmentPreparation || environmentPreparation.canDraw)');
  expect(source).toContain('environmentPreparation?.lamps?.apply(component.frame)');
  expect(source).toContain('return readyBefore && readyAfter;');
  expect(source.match(/\(\) => environmentPreparation\?\.dispose\(\)/g)).toHaveLength(2);
  expect(batch).toContain('() => this.lamps?.dispose()');
  for (const field of ['lampState', 'lampParts', 'lampMaterials', 'lampTriangles', 'lampLights'])
    expect(
      source.slice(
        source.indexOf('function clearSurfaceDiagnostics'),
        source.indexOf('function publishLampDiagnostics'),
      ),
    ).toContain(`'${field}'`);
});
