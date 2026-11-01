import { afterEach, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import {
  FormulaGroundingPlugin,
  FormulaGroundingPoses,
} from '../src/engine/babylon/formula-grounding.ts';
import { BabylonCircuitScene } from '../src/engine/babylon/circuit-scene.ts';
import { AUREL, VELLAMAR } from '../src/simulation/circuits.ts';
import { Track } from '../src/simulation/track.ts';
import { FORMULA_APX01 } from '../src/simulation/vehicles.ts';
import { CAR_STRIDE, HEADER, H, F, W, WHEEL_BASE, carBase } from '../src/simulation/protocol.ts';
import {
  groundingOracle,
  decodeFloat32,
  decodeFloat64,
} from './fixtures/formula-grounding-oracle.ts';

const engines: NullEngine[] = [];
function setup(count = 1, circuit = AUREL) {
  const engine = new NullEngine();
  engines.push(engine);
  // CPU ownership/binding simulation only, not WebGL readiness evidence.
  Object.defineProperty(engine, 'webGLVersion', { value: 2 });
  Object.defineProperty(engine, 'supportsUniformBuffers', { value: true });
  Object.assign(engine.getCaps(), { supportSRGBBuffers: true, standardDerivatives: true });
  const view = new BabylonCircuitScene(
    engine,
    new Track('clear', false, undefined, circuit),
    count,
    {
      presentation: 'circuit',
      vehicles: Array.from({ length: count }, () => FORMULA_APX01),
    },
  );
  const draw = vi.spyOn(view.scene, 'render').mockImplementation(() => {});
  return { engine, view, draw };
}
function frame(count = 1) {
  const result = new Float32Array(HEADER + count * CAR_STRIDE);
  result[H.CARS] = count;
  for (let i = 0; i < count; i++) result[carBase(i) + F.QW] = 1;
  return result;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const engine of engines.splice(0)) engine.dispose();
});

for (const circuit of [AUREL, VELLAMAR])
  it(`installs exactly two borrowed plugins before preparation on ${circuit.id}`, () => {
    const { view } = setup(1, circuit);
    const materials = [
      ...new Set(view.scene.meshes.filter((m) => m.metadata?.surface).map((m) => m.material!)),
    ];
    expect(materials).toHaveLength(2);
    for (const material of materials) {
      expect(material._uniformBufferLayoutBuilt).toBe(false);
      expect(material.pluginManager?.getPlugin('OriginalFormulaGrounding')).toBeInstanceOf(
        FormulaGroundingPlugin,
      );
    }
    expect(view.scene.textures.filter((t) => t !== view.scene.environmentBRDFTexture)).toHaveLength(
      3,
    );
    const initial = view.surfaceDiagnostics;
    expect(initial.formulaGroundingRoadChunks).toBe(initial.roadChunks);
    expect(initial.formulaGroundingPaintChunks).toBe(initial.paintChunks);
    expect(initial.formulaGroundingMaterials).toBe(2);
    expect(initial.formulaGroundingCars).toBe(0);
    const set = vi.spyOn(FormulaGroundingPoses.prototype, 'set');
    view.render(frame());
    expect(set).toHaveBeenCalledTimes(1);
    expect(view.surfaceDiagnostics.formulaGroundingCars).toBe(1);
    const owner = set.mock.contexts[0] as FormulaGroundingPoses;
    materials[0].dispose(false, false);
    expect(owner.isValid).toBe(true);
    expect(view.surfaceDiagnostics.formulaGroundingMaterials).toBe(1);
    view.dispose();
    expect(owner.snapshot()).toEqual({ count: 0, poses: new Array(48).fill(0), valid: false });
  });

for (const name of [
  'banked-pitched-unequal-contacts',
  'nonunit-quaternion',
  'zero-contact-defaults',
  'nonfinite-contact-defaults',
  'negative-contact-values-not-sanitized',
  'twelve-slots',
  'thirteen-clamps-twelve',
  'overlapping-identical-poses',
])
  it(`transfers live presented poses against frozen original oracle: ${name}`, () => {
    const observation = groundingOracle.cases
      .find((c) => c.name === name)!
      .observations.find((o) => o.input && !o.error)!;
    const captured = decodeFloat32(observation.input!);
    // StudioFrame's legacy capture may retain extra inactive capacity. The live
    // bridge requires an exact-sized packet, with identical active scalar bytes.
    const input = captured.slice(0, HEADER + captured[H.CARS] * CAR_STRIDE);
    const before = input.slice();
    const { view, draw } = setup(input[H.CARS]);
    const set = vi.spyOn(FormulaGroundingPoses.prototype, 'set');
    view.render(input);
    const owner = set.mock.contexts[0] as FormulaGroundingPoses;
    const expected = Array.from(decodeFloat64(observation.result.poses), Math.fround);
    expect(owner.snapshot().poses).toEqual(expected);
    expect(owner.snapshot().count).toBe(Math.min(12, input[H.CARS]));
    expect(input).toEqual(before);
    expect(draw).toHaveBeenCalledTimes(1);
    const snapshot = owner.snapshot();
    view.render(input);
    expect(owner.snapshot()).toEqual(snapshot);
    expect(draw).toHaveBeenCalledTimes(2);
    view.dispose();
  });

it('commits new presented positions before drawing and rejects invalid ground heights atomically', () => {
  const { view, draw } = setup(2);
  const set = vi.spyOn(FormulaGroundingPoses.prototype, 'set');
  const input = frame(2);
  view.render(input);
  const owner = set.mock.contexts[0] as FormulaGroundingPoses;
  input[carBase(0) + F.X] = 17;
  input[carBase(0) + F.Y] = 30; // Airborne chassis: preserve original height gate input.
  input[carBase(1) + F.Z] = -19;
  draw.mockImplementation(() => {
    expect(owner.snapshot().poses[0]).toBe(17);
    expect(owner.snapshot().poses[5]).toBe(-19);
  });
  view.render(input);
  const previous = owner.snapshot();
  input[carBase(0) + F.X] = 28;
  input[carBase(1) + WHEEL_BASE + W.LENGTH] = Infinity;
  expect(() => view.render(input)).toThrow('nonfinite active GPU pose');
  expect(owner.snapshot()).toEqual(previous);
  expect(draw).toHaveBeenCalledTimes(2);
  view.dispose();
});

it('does not publish disposed, detached, disabled or replaced material bindings as active receivers', () => {
  const { view } = setup();
  const road = view.scene.meshes.filter((m) => m.metadata?.surface === 'road');
  const initial = view.surfaceDiagnostics;
  road[0].setEnabled(false);
  road[1].material = null;
  expect(view.surfaceDiagnostics.formulaGroundingRoadChunks).toBe(initial.roadChunks - 2);
  const material = road[2].material!;
  view.scene.removeMaterial(material);
  expect(view.surfaceDiagnostics.formulaGroundingRoadChunks).toBe(0);
  expect(view.surfaceDiagnostics.formulaGroundingMaterials).toBe(1);
  view.dispose();
});

it('keeps context loss sticky and requires a fresh owner after explicit scene rebuild', () => {
  const { engine, view, draw } = setup();
  const set = vi.spyOn(FormulaGroundingPoses.prototype, 'set');
  view.render(frame());
  const owner = set.mock.contexts[0] as FormulaGroundingPoses;
  engine.onContextLostObservable.notifyObservers(engine);
  engine.onContextRestoredObservable.notifyObservers(engine);
  expect(owner.snapshot()).toEqual({ count: 0, poses: new Array(48).fill(0), valid: false });
  expect(view.surfaceDiagnostics.formulaGroundingMaterials).toBe(0);
  expect(() => view.render(frame())).toThrow('invalidated pose owner');
  expect(draw).toHaveBeenCalledTimes(1);
  view.dispose();
  const rebuilt = new BabylonCircuitScene(engine, new Track('clear'), 1, {
    presentation: 'circuit',
    vehicles: [FORMULA_APX01],
  });
  vi.spyOn(rebuilt.scene, 'render').mockImplementation(() => {});
  rebuilt.render(frame());
  expect(set.mock.contexts.at(-1)).not.toBe(owner);
  expect(rebuilt.surfaceDiagnostics.formulaGroundingCars).toBe(1);
  rebuilt.dispose();
});

it('explicitly clears and detaches the pose owner when scene disposal aborts before its observer', () => {
  const { engine, view } = setup();
  const set = vi.spyOn(FormulaGroundingPoses.prototype, 'set');
  view.render(frame());
  const owner = set.mock.contexts[0] as FormulaGroundingPoses;
  const original = view.scene.dispose.bind(view.scene);
  const failure = new Error('scene cleanup failed before observers');
  vi.spyOn(view.scene, 'dispose').mockImplementationOnce(() => {
    throw failure;
  });
  const invalidate = vi.spyOn(owner, 'invalidate');
  expect(() => view.dispose()).toThrow(failure);
  expect(owner.snapshot()).toEqual({ count: 0, poses: new Array(48).fill(0), valid: false });
  invalidate.mockClear();
  engine.onContextLostObservable.notifyObservers(engine);
  expect(invalidate).not.toHaveBeenCalled();
  original();
  view.dispose();
});

it('cleans the unreachable owner when the second plugin installation fails, with no coarse fallback', () => {
  const engine = new NullEngine();
  engines.push(engine);
  Object.defineProperty(engine, 'webGLVersion', { value: 2 });
  Object.assign(engine.getCaps(), { supportSRGBBuffers: true, standardDerivatives: true });
  const installed: number[] = [];
  Object.defineProperty(engine, 'supportsUniformBuffers', {
    get: () => {
      installed.push(
        engine.scenes
          .flatMap((scene) => scene.materials)
          .filter((material) => material.pluginManager?.getPlugin('OriginalFormulaGrounding'))
          .length,
      );
      return installed.at(-1) === 0;
    },
  });
  const disposed = vi.spyOn(FormulaGroundingPoses.prototype, 'dispose');
  expect(
    () =>
      new BabylonCircuitScene(engine, new Track('clear'), 1, {
        presentation: 'circuit',
        vehicles: [FORMULA_APX01],
      }),
  ).toThrow('install once before preparation');
  // Constructors query the capability too; reject only after the first
  // grounding plugin is actually registered, not after an assumed read count.
  expect(installed.at(-1)).toBe(1);
  expect(engine.scenes).toHaveLength(0);
  expect(disposed).toHaveBeenCalled();
  expect((disposed.mock.contexts[0] as FormulaGroundingPoses).snapshot()).toEqual({
    count: 0,
    poses: new Array(48).fill(0),
    valid: false,
  });
});
