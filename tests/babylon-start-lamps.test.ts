import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
import { createBabylonStartLamps } from '../src/engine/babylon/start-lamps.ts';
import { CircuitScene } from '../src/rendering/circuit.ts';
import { mesh as originalMesh } from '../src/rendering/geometry.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { AUREL, VELLAMAR } from '../src/simulation/circuits.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { H, HEADER } from '../src/simulation/protocol.ts';

const context = {
  presentation: 'circuit',
  vehicles: [{ classId: 'formula', dynamicsKind: 'four-wheel' }],
} as const;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
/** Execute the actual unchanged production construction, not a copy of its
 * constants. Only the unrelated banner/structure setup is excluded; this runs
 * the original placement, mesh helper and five-lamp loop, pinned below by SHA. */
function original(track: Track) {
  const source = readFileSync('src/rendering/circuit.ts', 'utf8');
  const slice = (start: string, end: string) => {
    const first = source.indexOf(start),
      last = source.indexOf(end);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBe(source.lastIndexOf(start));
    expect(last).toBeGreaterThan(first);
    expect(last).toBe(source.lastIndexOf(end));
    const body = source.slice(first, last);
    expect(body.trim().length).toBeGreaterThan(0);
    return body;
  };
  const placement = slice(
    '      const p = this.track.at(0, trackPoint()),\n        gantry = new T.Group();',
    '      if (this.startGantry) this.startGantry.build(this.track, gantry, this.sightlines);',
  );
  const construction = slice(
    '      for (let i = 0; i < 5; i++) {',
    '      if (this.venueKit) return;\n      const tower = new T.Group();',
  );
  const safetyPanel = new T.MeshStandardMaterial();
  const context = {
    track,
    props: new T.Group(),
    startLamps: [] as T.MeshStandardMaterial[],
    at: CircuitScene.prototype.at,
    safetyPanel,
  };
  const construct = new Function(
    'T',
    'trackPoint',
    'mesh',
    `${placement}\n${construction}\nreturn gantry;`,
  );
  const root = construct.call(context, T, trackPoint, originalMesh) as T.Group;
  root.updateMatrixWorld(true);
  const lamps = root.children as T.Mesh<T.CylinderGeometry, T.MeshStandardMaterial>[];
  expect(lamps).toHaveLength(5);
  expect(lamps.map((lamp) => lamp.material)).toEqual(context.startLamps);
  return {
    root,
    lamps,
    apply: (frame: Float32Array) =>
      CircuitScene.prototype.update.call(context as unknown as CircuitScene, frame),
    dispose: () => {
      lamps.forEach((lamp) => {
        lamp.geometry.dispose();
        lamp.material.dispose();
      });
      safetyPanel.dispose();
    },
  };
}
function snapshot(lights: number) {
  const frame = new Float32Array(HEADER);
  frame[H.LIGHTS] = lights;
  return frame;
}

describe('A07 original start lamps (NullEngine CPU contracts, not GPU/pixel parity)', () => {
  const scenes: Scene[] = [],
    engines: NullEngine[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    scenes.splice(0).forEach((scene) => {
      if (!scene.isDisposed) scene.dispose();
    });
    engines.splice(0).forEach((engine) => engine.dispose());
  });
  function setup() {
    const engine = new NullEngine(),
      scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    engines.push(engine);
    scenes.push(scene);
    return scene;
  }
  function options(scene = setup(), controller = new AbortController()) {
    return {
      scene,
      track: new Track(),
      context,
      signal: controller.signal,
      deadline: performance.now() + 120000,
      isCurrent: () => true,
      schedule: new PresentationSchedule(),
      gpu: {
        prepare: async (
          _label: string,
          _deadline: number,
          work: (invalidated: AbortSignal) => Promise<unknown>,
        ) => work(new AbortController().signal),
      } as unknown as Parameters<typeof createBabylonStartLamps>[0]['gpu'],
    };
  }
  const prepared = { prepare: vi.fn(async () => {}), present: vi.fn(async () => {}) };
  it('pins the unchanged original construction and update source', () => {
    expect(
      createHash('sha256').update(readFileSync('src/rendering/circuit.ts')).digest('hex'),
    ).toBe('d11fbbbb5dd7efc427dc230da026dfe8e33f0f6aad191f282de5704248f948bc');
  });
  it('preserves original geometry, linear colors, material settings and exact Float32 world matrices', async () => {
    const opts = options(),
      ref = original(opts.track),
      owner = await createBabylonStartLamps(opts, prepared);
    try {
      const d = owner.diagnostics();
      expect(d.parts).toHaveLength(5);
      for (const { index, mesh, material } of d.parts) {
        const source = ref.lamps[index];
        for (const [native, legacy] of [
          ['position', 'position'],
          ['normal', 'normal'],
          ['uv', 'uv'],
        ] as const)
          expect(Array.from(mesh.getVerticesData(native)!)).toEqual(
            Array.from(source.geometry.getAttribute(legacy).array),
          );
        expect(Array.from(mesh.getIndices()!)).toEqual(Array.from(source.geometry.index!.array));
        expect(Array.from(mesh.computeWorldMatrix(true).asArray())).toEqual(
          Array.from(new Float32Array(source.matrixWorld.elements)),
        );
        expect(material).toBeInstanceOf(PBRMaterial);
        expect(material.albedoColor.asArray()).toEqual(source.material.color.toArray());
        expect(material.emissiveColor.asArray()).toEqual(source.material.emissive.toArray());
        expect(material.emissiveIntensity).toBe(0);
        expect(material.getActiveTextures()).toHaveLength(0);
        expect(material.roughness).toBe(source.material.roughness);
        expect(material.metallic).toBe(source.material.metalness);
        expect(opts.scene.meshes).not.toContain(mesh);
      }
      expect(new Set(d.parts.map((p) => p.material)).size).toBe(5);
      expect(opts.scene.lights).toHaveLength(0);
      expect(opts.scene.environmentTexture).toBeNull();
    } finally {
      owner.dispose();
      ref.dispose();
    }
  });

  it('preserves original outward cap winding through native effective orientation and pre-bind culling', async () => {
    const opts = options(),
      ref = original(opts.track),
      owner = await createBabylonStartLamps(opts, prepared);
    const state = vi.spyOn(opts.scene.getEngine(), 'setState');
    try {
      for (const { index, mesh, material } of owner.diagnostics().parts) {
        const source = ref.lamps[index];
        expect(source.material.side).toBe(T.FrontSide);
        expect(source.matrixWorld.determinant()).toBeCloseTo(1, 10);
        // Positive rigid placement needs no determinant-induced orientation flip.
        expect(mesh.computeWorldMatrix(true).determinant()).toBeGreaterThan(0);
        const positions = source.geometry.getAttribute('position');
        const normals = source.geometry.getAttribute('normal');
        const indices = source.geometry.index!;
        const caps = { near: 0, far: 0 };
        for (let triangle = 0; triangle < indices.count; triangle += 3) {
          const ids = [0, 1, 2].map((corner) => indices.getX(triangle + corner));
          const vertices = ids.map((id) => new T.Vector3().fromBufferAttribute(positions, id));
          const normal = new T.Vector3().fromBufferAttribute(normals, ids[0]);
          const cross = vertices[1]
            .clone()
            .sub(vertices[0])
            .cross(vertices[2].clone().sub(vertices[0]));
          // The unchanged index order is CCW when viewed from the authored normal.
          expect(cross.dot(normal)).toBeGreaterThan(0);
          if (Math.abs(normal.y) !== 1) continue;
          const near = normal.y === -1;
          caps[near ? 'near' : 'far']++;
          for (const vertex of vertices) {
            expect(vertex.y).toBeCloseTo(near ? -0.04 : 0.04, 7);
            expect(vertex.clone().applyMatrix4(source.matrix).z).toBeCloseTo(
              near ? -0.34 : -0.26,
              7,
            );
          }
          const localNormal = normal.clone().transformDirection(source.matrix);
          expect(localNormal.z).toBeCloseTo(near ? -1 : 1, 10);
          const worldVertices = vertices.map((vertex) =>
            vertex.clone().applyMatrix4(source.matrixWorld),
          );
          const worldCross = worldVertices[1]
            .clone()
            .sub(worldVertices[0])
            .cross(worldVertices[2].clone().sub(worldVertices[0]));
          expect(
            worldCross.dot(normal.clone().transformDirection(source.matrixWorld)),
          ).toBeGreaterThan(0);
        }
        expect(caps).toEqual({ near: 20, far: 20 });
        expect(material.backFaceCulling).toBe(true);
        expect(material.cullBackFaces).toBe(true);
        expect(material.sideOrientation).toBeNull();
        const orientation = material._getEffectiveOrientation(mesh);
        state.mockClear();
        const reverse = material._preBind(undefined, orientation);
        // Exercise the native binding path, not just the configured mesh property.
        expect(reverse).toBe(false);
        expect(state).toHaveBeenCalledWith(
          true,
          material.zOffset,
          false,
          false,
          true,
          material.stencil,
          material.zOffsetUnits,
        );
        expect(orientation).toBe(Material.CounterClockWiseSideOrientation);
      }
    } finally {
      owner.dispose();
      ref.dispose();
    }
  });

  it('prepares off and on variants off-scene under GPU-owned construction, restoring dark before publication', async () => {
    const opts = options();
    let lane = false;
    const values: number[][] = [];
    opts.gpu = {
      prepare: async (
        _label: string,
        _deadline: number,
        work: (signal: AbortSignal) => Promise<unknown>,
      ) => {
        lane = true;
        try {
          return await work(new AbortController().signal);
        } finally {
          lane = false;
        }
      },
    } as unknown as typeof opts.gpu;
    const apply = VertexData.prototype.applyToMesh;
    const uploads = vi.spyOn(VertexData.prototype, 'applyToMesh').mockImplementation(function (
      this: VertexData,
      ...args
    ) {
      expect(lane).toBe(true);
      return apply.apply(this, args);
    });
    const owner = await createBabylonStartLamps(opts, {
      ...prepared,
      prepare: async (container) => {
        expect(container.meshes).toHaveLength(5);
        expect(container.meshes.every((mesh) => !opts.scene.meshes.includes(mesh))).toBe(true);
        values.push(
          container.meshes.map((mesh) => (mesh.material as PBRMaterial).emissiveIntensity),
        );
      },
    });
    expect(uploads).toHaveBeenCalledTimes(5);
    expect(values).toEqual([Array(5).fill(0), Array(5).fill(25)]);
    expect(owner.diagnostics().parts.map((p) => p.material.emissiveIntensity)).toEqual(
      Array(5).fill(0),
    );
    owner.dispose();
  });
  it('follows real race snapshots exactly including held frames, rewind, lights-out and fresh reset without changing simulation bytes', async () => {
    const opts = options(),
      owner = await createBabylonStartLamps(opts, prepared),
      ref = original(opts.track);
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', opponents: 0, seed: 1887 }),
      frames: Float32Array[] = [];
    let last = -1;
    for (let i = 0; i < 7 * 120; i++) {
      sim.step(1 / 120);
      const frame = sim.makeFrame();
      if (frame[H.LIGHTS] !== last) {
        last = frame[H.LIGHTS];
        frames.push(frame.slice());
      }
    }
    expect(frames.map((frame) => frame[H.LIGHTS])).toEqual([0, 1, 2, 3, 4, 5, 0]);
    await owner.install();
    const verify = (frame: Float32Array) => {
      const before = new Uint8Array(frame.buffer.slice(0));
      owner.apply(frame);
      ref.apply(frame);
      expect(owner.diagnostics().parts.map((p) => p.material.emissiveIntensity)).toEqual(
        ref.lamps.map((m) => m.material.emissiveIntensity),
      );
      expect(new Uint8Array(frame.buffer)).toEqual(before);
    };
    try {
      for (const frame of frames) verify(frame);
      const timer = vi.spyOn(globalThis, 'setTimeout');
      for (let i = 0; i < 6; i++) verify(frames[5]);
      verify(frames[2]);
      verify(frames[6]);
      verify(
        new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', opponents: 0, seed: 1887 }).makeFrame(),
      );
      expect(timer).not.toHaveBeenCalled();
    } finally {
      owner.dispose();
      ref.dispose();
    }
  });
  it('keeps real practice frames dark and does not add a phase condition or floor fractional light counts', async () => {
    const opts = options(),
      owner = await createBabylonStartLamps(opts, prepared),
      sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
    try {
      owner.apply(snapshot(5));
      owner.apply(sim.makeFrame());
      expect(owner.diagnostics().parts.map((p) => p.material.emissiveIntensity)).toEqual(
        Array(5).fill(0),
      );
      sim.step(1 / 120);
      owner.apply(sim.makeFrame());
      expect(owner.diagnostics().parts.map((p) => p.material.emissiveIntensity)).toEqual(
        Array(5).fill(0),
      );
      const fractional = snapshot(2.5);
      fractional[H.PHASE] = 999;
      owner.apply(fractional);
      expect(owner.diagnostics().parts.map((p) => p.material.emissiveIntensity)).toEqual([
        25, 25, 25, 0, 0,
      ]);
    } finally {
      owner.dispose();
    }
  });
  it('rejects malformed frames atomically and does not expire ongoing snapshot application with preparation deadline', async () => {
    const opts = options(),
      owner = await createBabylonStartLamps(opts, prepared);
    await owner.install();
    owner.apply(snapshot(3));
    try {
      for (const frame of [
        new Float32Array(),
        snapshot(NaN),
        snapshot(Infinity),
        snapshot(-1),
        snapshot(6),
      ]) {
        expect(() => owner.apply(frame)).toThrow();
        expect(owner.diagnostics().parts.map((p) => p.material.emissiveIntensity)).toEqual([
          25, 25, 25, 0, 0,
        ]);
      }
      vi.spyOn(performance, 'now').mockReturnValue(opts.deadline + 1);
      owner.apply(snapshot(1));
      expect(owner.diagnostics().parts.map((p) => p.material.emissiveIntensity)).toEqual([
        25, 0, 0, 0, 0,
      ]);
    } finally {
      owner.dispose();
    }
    expect(() => owner.apply(snapshot(1))).toThrow();
  });
  it('rejects noncanonical tracks, non-Formula context, stale/disposed/wrong-handed scenes before preparation', async () => {
    const opts = options(),
      prepare = vi.fn(async () => {});
    for (const track of [
      new Track('clear', false, undefined, VELLAMAR),
      new Track('clear', false, undefined, { ...AUREL }),
    ])
      await expect(
        createBabylonStartLamps({ ...opts, track }, { ...prepared, prepare }),
      ).rejects.toThrow();
    await expect(
      createBabylonStartLamps(
        { ...opts, context: { ...context, vehicles: [] } },
        { ...prepared, prepare },
      ),
    ).rejects.toThrow();
    await expect(
      createBabylonStartLamps({ ...opts, isCurrent: () => false }, { ...prepared, prepare }),
    ).rejects.toThrow();
    opts.scene.useRightHandedSystem = false;
    await expect(createBabylonStartLamps(opts, { ...prepared, prepare })).rejects.toThrow();
    opts.scene.dispose();
    await expect(createBabylonStartLamps(opts, { ...prepared, prepare })).rejects.toThrow();
    expect(prepare).not.toHaveBeenCalled();
  });
  it('reports only actual staged/installed membership and rejects duplicate install', async () => {
    const opts = options(),
      owner = await createBabylonStartLamps(opts, prepared);
    const counts = () => {
      const d = owner.diagnostics();
      return { staged: d.stagedParts, active: d.activeParts, materials: d.activeMaterials };
    };
    expect(counts()).toEqual({ staged: 5, active: 0, materials: 0 });
    expect(owner.diagnostics().lampCount).toBe(5);
    await owner.install();
    expect(counts()).toEqual({ staged: 0, active: 5, materials: 5 });
    await expect(owner.install()).rejects.toThrow();
    owner.diagnostics().parts.forEach((p) => opts.scene.removeMesh(p.mesh));
    expect(counts().active).toBe(0);
    expect(counts().materials).toBe(0);
    owner.dispose();
    owner.dispose();
    expect(counts()).toEqual({ staged: 0, active: 0, materials: 0 });
  });
  it('cancels before construction and drains active preparation before rejecting owner cancellation', async () => {
    const pre = new AbortController();
    pre.abort();
    const before = options(setup(), pre);
    await expect(createBabylonStartLamps(before, prepared)).rejects.toMatchObject({
      name: 'AbortError',
    });
    const controller = new AbortController(),
      opts = options(setup(), controller),
      entered = deferred(),
      drain = deferred();
    let meshes: AbstractMesh[] = [];
    const pending = createBabylonStartLamps(opts, {
        ...prepared,
        prepare: async (container) => {
          meshes = [...container.meshes];
          entered.resolve();
          await drain.promise;
        },
      }),
      failed = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await entered.promise;
    controller.abort();
    expect(meshes.every((mesh) => !mesh.isDisposed())).toBe(true);
    expect(opts.scene.meshes).toHaveLength(0);
    drain.resolve();
    await failed;
    expect(meshes.every((mesh) => mesh.isDisposed())).toBe(true);
  });
  it('cannot insert after cancellation or stale ownership and auto-drains staged resources', async () => {
    const controller = new AbortController(),
      opts = options(setup(), controller);
    let current = true;
    const owner = await createBabylonStartLamps({ ...opts, isCurrent: () => current }, prepared),
      parts = owner.diagnostics().parts;
    current = false;
    await expect(owner.install()).rejects.toThrow();
    expect(parts.every((p) => p.mesh.isDisposed())).toBe(true);
    const cancelled = await createBabylonStartLamps(opts, prepared),
      cancelledParts = cancelled.diagnostics().parts;
    controller.abort();
    await expect(cancelled.install()).rejects.toThrow();
    expect(cancelledParts.every((p) => p.mesh.isDisposed())).toBe(true);
  });
  it('keeps installation pending until presentation and rejects duplicate in-flight calls without destroying valid resources', async () => {
    const opts = options(),
      entered = deferred(),
      drain = deferred(),
      owner = await createBabylonStartLamps(opts, {
        ...prepared,
        present: async () => {
          entered.resolve();
          await drain.promise;
        },
      });
    const pending = owner.install();
    await entered.promise;
    expect(owner.diagnostics().state).toBe('installing');
    await expect(owner.install()).rejects.toThrow();
    expect(owner.diagnostics().parts.every((p) => !p.mesh.isDisposed())).toBe(true);
    drain.resolve();
    await pending;
    expect(owner.diagnostics().state).toBe('ready');
    owner.dispose();
  });
  it('drains off-scene lamp resources even when scene disposal skips later callbacks', async () => {
    const opts = options();
    opts.scene.onDisposeObservable.add((_scene, event) => {
      event.skipNextObservers = true;
    });
    const owner = await createBabylonStartLamps(opts, prepared),
      parts = owner.diagnostics().parts,
      spies = parts.map((p) => vi.spyOn(p.material, 'dispose'));
    opts.scene.dispose();
    owner.dispose();
    expect(parts.every((p) => p.mesh.isDisposed())).toBe(true);
    expect(spies.every((spy) => spy.mock.calls.length > 0)).toBe(true);
    expect(owner.diagnostics().activeParts).toBe(0);
  });
  it.each([undefined, null])(
    'preserves falsy material cleanup failure %s and drains other independent resources',
    async (failure) => {
      const opts = options(),
        owner = await createBabylonStartLamps(opts, prepared);
      await owner.install();
      const parts = owner.diagnostics().parts;
      const other = parts.slice(1).map((p) => vi.spyOn(p.material, 'dispose'));
      vi.spyOn(parts[0].material, 'dispose').mockImplementation(() => {
        throw failure;
      });
      let threw = false,
        caught: unknown = Symbol('none');
      try {
        owner.dispose();
      } catch (error) {
        threw = true;
        caught = error;
      }
      expect(threw).toBe(true);
      expect(caught).toBe(failure);
      expect(parts.every((p) => p.mesh.isDisposed())).toBe(true);
      expect(other.every((spy) => spy.mock.calls.length > 0)).toBe(true);
      expect(owner.diagnostics().activeParts).toBe(0);
    },
  );
  it('retains the original preparation error while draining independently after cleanup failure', async () => {
    const opts = options(),
      primary = new Error('lamp preparation sentinel');
    let meshes: AbstractMesh[] = [];
    const disposed: ReturnType<typeof vi.spyOn>[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      createBabylonStartLamps(opts, {
        ...prepared,
        prepare: async (container) => {
          meshes = [...container.meshes];
          disposed.push(...meshes.slice(1).map((mesh) => vi.spyOn(mesh.material!, 'dispose')));
          vi.spyOn(meshes[0].material!, 'dispose').mockImplementation(() => {
            throw undefined;
          });
          throw primary;
        },
      }),
    ).rejects.toBe(primary);
    expect(meshes).toHaveLength(5);
    expect(meshes.every((mesh) => mesh.isDisposed())).toBe(true);
    expect(disposed.every((spy) => spy.mock.calls.length > 0)).toBe(true);
  });

  it('drains every partially allocated object after the third geometry upload fails', async () => {
    const opts = options(),
      meshes: AbstractMesh[] = [],
      materials: PBRMaterial[] = [],
      failure = new Error('third lamp upload sentinel');
    const materialDisposals: ReturnType<typeof vi.spyOn>[] = [];
    const geometries: import('@babylonjs/core/Meshes/geometry.js').Geometry[] = [];
    const apply = VertexData.prototype.applyToMesh;
    let uploads = 0;
    vi.spyOn(VertexData.prototype, 'applyToMesh').mockImplementation(function (
      this: VertexData,
      ...args
    ) {
      const mesh = args[0];
      meshes.push(mesh);
      materials.push(mesh.material as PBRMaterial);
      materialDisposals.push(vi.spyOn(mesh.material!, 'dispose'));
      const result = apply.apply(this, args);
      geometries.push(mesh.geometry!);
      if (++uploads === 3) throw failure;
      return result;
    });
    const prepare = vi.fn(async () => {});
    await expect(createBabylonStartLamps(opts, { ...prepared, prepare })).rejects.toBe(failure);
    expect(meshes).toHaveLength(3);
    expect(materials).toHaveLength(3);
    expect(materialDisposals.every((spy) => spy.mock.calls.length > 0)).toBe(true);
    expect(geometries).toHaveLength(3);
    expect(geometries.every((geometry) => geometry.isDisposed())).toBe(true);
    expect(meshes.every((mesh) => mesh.isDisposed())).toBe(true);
    expect(opts.scene.meshes).toHaveLength(0);
    expect(opts.scene.materials.filter((m) => materials.includes(m as PBRMaterial))).toHaveLength(
      0,
    );
    expect(prepare).not.toHaveBeenCalled();
  });
  it('does not poison a queued GPU lane for ordinary owner cancellation', async () => {
    const controller = new AbortController(),
      opts = options(setup(), controller),
      entered = deferred(),
      run = deferred();
    let rejectedInLane = false;
    opts.gpu = {
      prepare: async (
        _label: string,
        _deadline: number,
        work: (signal: AbortSignal) => Promise<unknown>,
      ) => {
        entered.resolve();
        await run.promise;
        try {
          return await work(new AbortController().signal);
        } catch (error) {
          rejectedInLane = true;
          throw error;
        }
      },
    } as unknown as typeof opts.gpu;
    const prepare = vi.fn(async () => {}),
      pending = createBabylonStartLamps(opts, { ...prepared, prepare }),
      failed = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await entered.promise;
    controller.abort();
    run.resolve();
    await failed;
    expect(rejectedInLane).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
    expect(opts.scene.meshes).toHaveLength(0);
    expect(opts.scene.materials).toHaveLength(0);
  });
  it('retains presentation failure, drains the installed lamps and releases preparation demand', async () => {
    const opts = options(),
      failure = new Error('presentation sentinel'),
      owner = await createBabylonStartLamps(opts, {
        ...prepared,
        present: async () => {
          throw failure;
        },
      }),
      parts = owner.diagnostics().parts;
    await expect(owner.install()).rejects.toBe(failure);
    expect(parts.every((p) => p.mesh.isDisposed())).toBe(true);
    expect(owner.diagnostics().state).toBe('disposed');
    opts.schedule.shouldRender(true);
    expect(opts.schedule.pending).toBe(false);
    expect(owner.diagnostics().activeParts).toBe(0);
  });
});
