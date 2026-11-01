import * as T from 'three';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import type { Effect } from '@babylonjs/core/Materials/effect.js';
import type { WebGLPipelineContext } from '@babylonjs/core/Engines/WebGL/webGLPipelineContext.js';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H } from '../../src/simulation/protocol.ts';
import { trackPoint } from '../../src/simulation/track.ts';
import { loadBabylonStartGantry } from '../../src/engine/babylon/start-gantry.ts';
import { cleanupPresentation } from '../../src/engine/babylon/presentation-gpu.ts';
import { createBabylonStartLamps } from '../../src/engine/babylon/start-lamps.ts';
import {
  prepareOriginalMaterials,
  yieldPreparationTurn,
} from '../../src/engine/babylon/asset-preparation.ts';
import { createSurfaceProbeHarness, surfaceProbeResources } from './babylon-surface-parity.ts';

const requireValue = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
const equal = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.from(a).every((n, i) => n === b[i]);
const close = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.from(a).every((n, i) => Math.abs(n - b[i]) < 1e-6);

export const originalLampSourceSha256 =
  'd11fbbbb5dd7efc427dc230da026dfe8e33f0f6aad191f282de5704248f948bc';
// The spec pins original circuit.ts bytes; CPU source-slice tests independently
// execute that construction/update. This explicit reconstruction is a GPU buffer
// oracle tied to that immutable source, not a claim of unrelated renderer parity.
/** Isolated native lamp component, not a race-mode change or bloom/PBR parity claim. */
async function probe(forceStandalone: boolean, loseContext: boolean, deadline: number) {
  const width = 960,
    height = 480;
  const h = createSurfaceProbeHarness(width, height, undefined, forceStandalone);
  h.deadline = deadline;
  const totalTimer = setTimeout(
    () => h.abort.abort(new Error('Lamp case exceeded total 120s budget')),
    Math.max(0, deadline - performance.now()),
  );
  const race = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', opponents: 0, seed: 1887 });
  const practice = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    opponents: 0,
    seed: 1887,
  });
  const track = race.track,
    station = track.at(0, trackPoint());
  const originalRoot = new T.Group();
  originalRoot.position.set(station.x, station.y, station.z);
  originalRoot.rotation.y = Math.atan2(station.tx, station.tz);
  const originals = Array.from({ length: 5 }, (_, index) => {
    const mesh = new T.Mesh(
      new T.CylinderGeometry(0.16, 0.16, 0.08, 20),
      new T.MeshStandardMaterial({ color: 0x1a0e0c, emissive: 0xff210c, emissiveIntensity: 0 }),
    );
    mesh.position.set((index - 2) * 0.45, 4.95, -0.3);
    mesh.rotation.x = Math.PI / 2;
    originalRoot.add(mesh);
    return mesh;
  });
  originalRoot.updateMatrixWorld(true);
  const world = (x: number, y: number, z: number) => {
    const p = new T.Vector3(x, y, z).applyMatrix4(originalRoot.matrixWorld);
    return new Vector3(p.x, p.y, p.z);
  };
  const camera = new UniversalCamera('isolated original start lamps', world(0, 4.95, -8), h.scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.orthoLeft = -1.4;
  camera.orthoRight = 1.4;
  camera.orthoTop = 0.7;
  camera.orthoBottom = -0.7;
  camera.minZ = 0.1;
  camera.maxZ = 100;
  camera.setTarget(world(0, 4.95, -0.3));
  const sky = new HemisphericLight('fixed inspection sky (not lamp-owned)', Vector3.Up(), h.scene);
  sky.intensity = 0.7;
  const warm = new PBRMaterial('shared PBR infrastructure', h.scene);
  warm.dispose();
  const resources = () => ({
    ...surfaceProbeResources(h.scene),
    transforms: h.scene.transformNodes.length,
    lights: h.scene.lights.length,
  });
  const baseline = resources(),
    initialLights = [...h.scene.lights];
  const options = (signal = h.abort.signal) => ({
    scene: h.scene,
    track,
    context: { presentation: 'circuit', vehicles: race.cars.map((car) => car.definition) } as const,
    signal,
    gpu: h.gpu,
    deadline,
    schedule: h.schedule,
    isCurrent: () => !signal.aborted && !h.scene.isDisposed,
  });
  const lease = async <R>(label: string, work: () => Promise<R>) => {
    let result!: R;
    await h.gpu.prepare(label, deadline, async (signal) => {
      signal.throwIfAborted();
      result = await work();
      signal.throwIfAborted();
    });
    return result;
  };
  const pump = async (pending: Promise<void>) => {
    let done = false,
      failure: unknown;
    void pending.then(
      () => {
        done = true;
      },
      (e) => {
        failure = e;
        done = true;
      },
    );
    while (!done) {
      h.abort.signal.throwIfAborted();
      h.gpu.ready();
      await Promise.resolve();
      if (done) break;
      h.gpu.frame(h.schedule, false, h.scene, () => {
        const before = h.scene.isReady();
        h.engine.beginFrame();
        h.scene.render();
        h.engine.endFrame();
        const after = h.scene.isReady();
        h.schedule.rendered(before, after);
        return before && after;
      });
      await yieldPreparationTurn(h.abort.signal, deadline);
    }
    if (failure) throw failure;
    await pending;
  };
  // Forward native compiler calls unchanged. These observers never query/draw.
  let compileCalls = 0,
    linkCalls = 0;
  const compile = h.gl.compileShader,
    link = h.gl.linkProgram;
  h.gl.compileShader = function (shader) {
    compileCalls++;
    return compile.call(this, shader);
  };
  h.gl.linkProgram = function (program) {
    linkCalls++;
    return link.call(this, program);
  };
  const shaderCache = () =>
    Object.entries(
      (h.engine as unknown as { _compiledEffects: Record<string, Effect> })._compiledEffects,
    );
  const receipts: object[] = [],
    rows: object[] = [],
    images: { name: string; image: string }[] = [];
  let owner: Awaited<ReturnType<typeof createBabylonStartLamps>> | undefined;
  let structure: Awaited<ReturnType<typeof loadBabylonStartGantry>> | undefined;
  let failure: string | null = null,
    loss: object | null = null;
  try {
    const frames: Float32Array[] = [];
    let last = -1;
    for (let i = 0; i < 7 * 120; i++) {
      race.step(1 / 120);
      practice.step(1 / 120);
      const frame = race.makeFrame();
      if (frame[H.LIGHTS] !== last) {
        last = frame[H.LIGHTS];
        frames.push(frame.slice());
      }
    }
    requireValue(
      equal(
        frames.map((f) => f[H.LIGHTS]),
        [0, 1, 2, 3, 4, 5, 0],
      ),
      'Original Simulation race sequence differs',
    );
    const practiceFrame = practice.makeFrame(),
      resetFrame = new Simulation({
        ...DEFAULT_OPTIONS,
        mode: 'race',
        opponents: 0,
        seed: 1887,
      }).makeFrame();
    requireValue(
      practiceFrame[H.LIGHTS] === 0 && practice.options.mode === 'practice',
      'Current live practice must remain dark',
    );
    const sequence = [
      ...frames.map((frame, index) => ({ name: `race-${index}`, frame })),
      { name: 'held-five', frame: frames[5] },
      { name: 'held-five-again', frame: frames[5] },
      { name: 'rewind-two', frame: frames[2] },
      { name: 'reset', frame: resetFrame },
      { name: 'practice', frame: practiceFrame },
    ];
    // Cancel only after the actual native material compiler has drained; this
    // does not invent a fake compiler/presentation or poison GPU ownership.
    const cancelled = new AbortController();
    let cancelRejected = false;
    const cancelledMeshes: { isDisposed(): boolean }[] = [];
    try {
      await createBabylonStartLamps(options(AbortSignal.any([h.abort.signal, cancelled.signal])), {
        prepare: async (...args) => {
          cancelledMeshes.push(...args[0].meshes);
          await prepareOriginalMaterials(...args);
          cancelled.abort();
        },
      });
    } catch (e) {
      if (!(e instanceof DOMException) || e.name !== 'AbortError') throw e;
      cancelRejected = true;
    }
    const cancellation = {
      rejected: cancelRejected,
      disposed: cancelledMeshes.length === 5 && cancelledMeshes.every((m) => m.isDisposed()),
      resources: resources(),
    };
    receipts.push({ cancellation });
    requireValue(
      cancelRejected &&
        cancellation.disposed &&
        JSON.stringify(resources()) === JSON.stringify(baseline),
      'Cancelled native lamps leaked or installed',
    );

    for (let cycle = 0; cycle < 2; cycle++) {
      if (cycle === 1) {
        structure = await loadBabylonStartGantry({ ...options(), base: location.origin + '/' });
        await pump(structure.install());
      }
      const cycleBaseline = resources();
      const baselineObjects = [
        ...h.scene.meshes,
        ...h.scene.materials,
        ...h.scene.geometries,
        ...h.scene.textures,
        ...h.scene.transformNodes,
      ];
      const structureSnapshot = structure?.diagnostics().parts.map(({ mesh, material }) => ({
        mesh,
        material,
        geometry: mesh.geometry,
        indices: Array.from(mesh.getIndices()!),
        kinds: mesh
          .getVerticesDataKinds()
          .map((kind) => ({ kind, values: Array.from(mesh.getVerticesData(kind)!) })),
        world: Array.from(mesh.getWorldMatrix().asArray()),
      }));
      owner = await createBabylonStartLamps(options());
      const parts = owner.diagnostics().parts;
      const geometry = parts.map(({ index, mesh, material }) => ({
        index,
        positions: equal(
          mesh.getVerticesData('position')!,
          originals[index].geometry.attributes.position.array,
        ),
        normals: equal(
          mesh.getVerticesData('normal')!,
          originals[index].geometry.attributes.normal.array,
        ),
        uv: equal(mesh.getVerticesData('uv')!, originals[index].geometry.attributes.uv.array),
        indices: equal(mesh.getIndices()!, originals[index].geometry.index!.array),
        world: equal(
          mesh.computeWorldMatrix(true).asArray(),
          new Float32Array(originals[index].matrixWorld.elements),
        ),
        albedo: equal(material.albedoColor.asArray(), originals[index].material.color.toArray()),
        emission: equal(
          material.emissiveColor.asArray(),
          originals[index].material.emissive.toArray(),
        ),
        roughness: material.roughness,
        metallic: material.metallic,
        textures: material.getActiveTextures().length,
      }));
      receipts.push({
        cycle,
        stage: 'prepared',
        geometry,
        resources: resources(),
        staged: owner.diagnostics().stagedParts,
      });
      requireValue(
        parts.length === 5 && parts.reduce((n, p) => n + p.mesh.getTotalIndices() / 3, 0) === 400,
        'Original five-lamp/400-triangle inventory differs',
      );
      requireValue(
        geometry.every(
          (g) =>
            g.positions &&
            g.normals &&
            g.uv &&
            g.indices &&
            g.world &&
            g.albedo &&
            g.emission &&
            g.roughness === 1 &&
            g.metallic === 0 &&
            g.textures === 0,
        ),
        'Original lamp geometry/linear-material mismatch',
      );
      requireValue(
        JSON.stringify(resources()) === JSON.stringify(cycleBaseline),
        'Staged lamps inserted scene resources',
      );
      const binds = [0, 0, 0, 0, 0];
      let effectEvents = 0;
      for (const part of parts) {
        part.material.onBindObservable.add((mesh) => {
          if (mesh === part.mesh) {
            binds[part.index]++;
          }
        });
        part.material.onEffectCreatedObservable.add(() => {
          effectEvents++;
        });
      }
      await pump(owner.install());
      const stableEffects = parts.map((p) => p.mesh.subMeshes[0].effect),
        cache = shaderCache();
      const stablePrograms = stableEffects.map(
        (effect) => (effect?.getPipelineContext() as WebGLPipelineContext | null)?.program,
      );
      const stableResources = resources(),
        stableObjects = [
          ...h.scene.meshes,
          ...h.scene.materials,
          ...h.scene.geometries,
          ...h.scene.textures,
        ];
      const compiled = compileCalls,
        linked = linkCalls;
      let ownedDraw = false;
      const standaloneDraws = new Map<
        number,
        { intensity: number[]; emission: number[]; currentProgram: boolean; draws: number }
      >();
      if (h.transport === 'standalone')
        await lease('Original lamp standalone uniform locations', async () => {
          for (const part of parts) {
            const program = (
              part.mesh.subMeshes[0].effect!.getPipelineContext() as WebGLPipelineContext
            ).program!;
            const lighting = h.gl.getUniformLocation(program, 'vLightingIntensity');
            const emission = h.gl.getUniformLocation(program, 'vEmissiveColor');
            requireValue(lighting && emission, `Lamp ${part.index} standalone uniforms absent`);
            // Pinned Mesh.render: _processRendering -> material.unbind ->
            // onAfterRenderObservable, before the next mesh. Queries are explicitly
            // guarded by this fixture's existing GPU-owned frame, never a timer.
            part.mesh.onAfterRenderObservable.add(() => {
              requireValue(ownedDraw, 'Lamp native uniform callback outside GPU-owned draw');
              const currentProgram = h.gl.getParameter(h.gl.CURRENT_PROGRAM) === program;
              requireValue(
                currentProgram,
                `Lamp ${part.index} drawn with an unexpected native program`,
              );
              standaloneDraws.set(part.index, {
                intensity: Array.from(h.gl.getUniform(program, lighting!) as Float32Array),
                emission: Array.from(h.gl.getUniform(program, emission!) as Float32Array),
                currentProgram,
                draws: (standaloneDraws.get(part.index)?.draws ?? 0) + 1,
              });
            });
          }
        });

      const releases = Array.from({ length: 10 }, () => 0),
        geometries = parts.map((p) => p.mesh.geometry!);
      parts.forEach((p) => {
        p.mesh.onDisposeObservable.add(() => {
          releases[p.index]++;
        });
        p.material.onDisposeObservable.add(() => {
          releases[5 + p.index]++;
        });
      });
      let duplicateRejected = false;
      try {
        await owner.install();
      } catch {
        duplicateRejected = true;
      }
      requireValue(duplicateRejected, 'Duplicate lamp install accepted');
      for (const view of ['front', 'grid'] as const) {
        camera.position.copyFrom(view === 'front' ? world(0, 4.95, -8) : world(0, 1.2, -14));
        camera.setTarget(world(0, 4.95, -0.3));
        let dark: number[] | undefined;
        for (const step of sequence) {
          const before = new Uint8Array(step.frame.buffer.slice(0)),
            completed = h.gpu.diagnostics().completed;
          const row = {
            cycle,
            view,
            state: step.name,
            lights: step.frame[H.LIGHTS],
            uniforms: [] as object[],
            pixels: [] as number[],
            glError: -1,
            snapshotUnchanged: false,
            completedFrames: 0,
            binds: [...binds],
            effectEvents,
            compileCalls: compileCalls - compiled,
            linkCalls: linkCalls - linked,
          };
          receipts.push(row);
          const priorDraws = parts.map((p) => standaloneDraws.get(p.index)?.draws ?? 0);
          owner.apply(step.frame);
          row.snapshotUnchanged = equal(before, new Uint8Array(step.frame.buffer));
          requireValue(row.snapshotUnchanged, `Snapshot mutated at ${step.name}`);
          await h.presented(() => {
            ownedDraw = true;
            try {
              h.scene.render();
            } finally {
              ownedDraw = false;
            }
          });
          Object.assign(row, {
            completedFrames: h.gpu.diagnostics().completed - completed,
            binds: [...binds],
            effectEvents,
            compileCalls: compileCalls - compiled,
            linkCalls: linkCalls - linked,
          });
          await lease('Original lamp native uniforms and pixels', async () => {
            const gl = h.gl;
            for (const part of parts) {
              const effect = part.mesh.subMeshes[0]?.effect;
              const program = (effect?.getPipelineContext() as WebGLPipelineContext | null)
                ?.program;
              const uniform: {
                index: number;
                transport: string;
                linked: boolean;
                intensity?: number[];
                emission?: number[];
                error?: string;
              } = {
                index: part.index,
                transport: h.transport,
                linked:
                  !!program &&
                  gl.isProgram(program) &&
                  !!gl.getProgramParameter(program, gl.LINK_STATUS),
              };
              row.uniforms.push(uniform);
              requireValue(
                program && uniform.linked && effect,
                `Lamp ${part.index} has no linked drawn program`,
              );
              if (h.transport === 'standalone') {
                const drawn = standaloneDraws.get(part.index);
                requireValue(
                  drawn && drawn.draws > priorDraws[part.index] && drawn.currentProgram,
                  `Lamp ${part.index} lacks fresh standalone post-draw evidence`,
                );
                uniform.intensity = drawn!.intensity;
                uniform.emission = drawn!.emission;
              } else {
                const block = gl.getUniformBlockIndex(program!, 'Material');
                requireValue(block !== gl.INVALID_INDEX, 'Native lamp Material block absent');
                const indices = Array.from(
                  gl.getActiveUniformBlockParameter(
                    program!,
                    block,
                    gl.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES,
                  ) as Uint32Array,
                );
                const find = (name: string) => {
                  const index = indices.find((i) => {
                    const n = gl.getActiveUniform(program!, i)?.name;
                    return n === name || n?.endsWith('.' + name);
                  });
                  requireValue(index !== undefined, `Native lamp uniform ${name} absent`);
                  return index!;
                };
                const offsets = gl.getActiveUniforms(
                  program!,
                  [find('vLightingIntensity'), find('vEmissiveColor')],
                  gl.UNIFORM_OFFSET,
                ) as number[];
                const bytes = gl.getActiveUniformBlockParameter(
                  program!,
                  block,
                  gl.UNIFORM_BLOCK_DATA_SIZE,
                ) as number;
                const buffer = part.material._uniformBuffer.getBuffer();
                requireValue(
                  buffer && gl.isBuffer(buffer.underlyingResource),
                  'Native lamp UBO absent',
                );
                const previous = gl.getParameter(gl.UNIFORM_BUFFER_BINDING) as WebGLBuffer | null;
                try {
                  gl.bindBuffer(gl.UNIFORM_BUFFER, buffer!.underlyingResource);
                  const data = new ArrayBuffer(bytes);
                  gl.getBufferSubData(gl.UNIFORM_BUFFER, 0, new Uint8Array(data));
                  uniform.intensity = Array.from(new Float32Array(data, offsets[0], 4));
                  uniform.emission = Array.from(new Float32Array(data, offsets[1], 3));
                } finally {
                  gl.bindBuffer(gl.UNIFORM_BUFFER, previous);
                }
              }
              requireValue(
                uniform.intensity![1] === (part.index < step.frame[H.LIGHTS] ? 25 : 0),
                `Native lamp ${part.index} emissive-intensity slot differs`,
              );
              requireValue(
                close(uniform.emission!, originals[part.index].material.emissive.toArray()),
                `Native lamp ${part.index} linear emissive color differs`,
              );
            }
            const capture = h.capture();
            for (const part of parts) {
              const projected = Vector3.Project(
                Vector3.Zero(),
                part.mesh.getWorldMatrix(),
                h.scene.getTransformMatrix(),
                camera.viewport.toGlobal(width, height),
              );
              const x = Math.round(projected.x),
                y = height - 1 - Math.round(projected.y);
              requireValue(
                x >= 2 && y >= 2 && x < width - 2 && y < height - 2,
                'Lamp sample outside image',
              );
              let sum = 0;
              for (let dy = -2; dy <= 2; dy++)
                for (let dx = -2; dx <= 2; dx++) {
                  const i = ((y + dy) * width + x + dx) * 4;
                  sum += capture.pixels[i] + capture.pixels[i + 1] + capture.pixels[i + 2];
                }
              row.pixels.push(sum / 75);
            }
            if (cycle === 0 && ['race-0', 'race-1', 'race-5'].includes(step.name))
              images.push({ name: `${view}-${step.name}`, image: capture.image });
            row.glError = gl.getError();
          });
          if (!dark) dark = row.pixels;
          requireValue(
            row.pixels.every((value, i) =>
              i < row.lights ? value > dark![i] + 20 : Math.abs(value - dark![i]) <= 1,
            ),
            `Per-lamp visible emission disagrees at ${view}/${step.name}`,
          );
          const nowCache = shaderCache(),
            nowObjects = [
              ...h.scene.meshes,
              ...h.scene.materials,
              ...h.scene.geometries,
              ...h.scene.textures,
            ];
          requireValue(
            compileCalls === compiled &&
              linkCalls === linked &&
              parts.every(
                (p, i) =>
                  p.mesh.subMeshes[0].effect === stableEffects[i] &&
                  (p.mesh.subMeshes[0].effect?.getPipelineContext() as WebGLPipelineContext | null)
                    ?.program === stablePrograms[i],
              ) &&
              cache.length === nowCache.length &&
              cache.every(([k, v], i) => nowCache[i][0] === k && nowCache[i][1] === v),
            `Runtime lamp shader/effect changed at ${step.name}`,
          );
          requireValue(
            JSON.stringify(resources()) === JSON.stringify(stableResources) &&
              nowObjects.length === stableObjects.length &&
              nowObjects.every((o, i) => o === stableObjects[i]),
            'State update changed resource ownership',
          );
          requireValue(
            initialLights.length === h.scene.lights.length &&
              initialLights.every((l, i) => l === h.scene.lights[i]) &&
              row.glError === 0 &&
              row.completedFrames >= 2 &&
              binds.every((n) => n > 0),
            'Lamp presentation/light isolation failure',
          );
        }
      }
      if (loseContext && cycle === 1) {
        const ext = await lease('Lamp context loss extension', async () =>
          h.gl.getExtension('WEBGL_lose_context'),
        );
        requireValue(ext, 'Context-loss extension unavailable');
        const lost = new Promise<void>((resolve, reject) => {
          h.canvas.addEventListener('webglcontextlost', () => resolve(), { once: true });
          h.abort.signal.addEventListener(
            'abort',
            () =>
              queueMicrotask(() =>
                h.gpu.diagnostics().lost ? resolve() : reject(h.abort.signal.reason),
              ),
            { once: true },
          );
        });
        ext!.loseContext();
        await lost;
        owner.dispose();
        loss = h.gpu.diagnostics();
      } else
        await lease('Original lamp owner disposal', async () => {
          owner!.dispose();
          owner!.dispose();
        });
      const disposed = {
        cycle,
        releases,
        geometries: geometries.every((g) => g.isDisposed()),
        restored: resources(),
        state: owner.diagnostics().state,
      };
      rows.push(disposed);
      requireValue(
        releases.every((n) => n === 1) &&
          disposed.geometries &&
          JSON.stringify(resources()) === JSON.stringify(cycleBaseline),
        'Lamp owner did not restore baseline exactly once',
      );
      owner = undefined;
      if (structure) {
        const now = [
          ...h.scene.meshes,
          ...h.scene.materials,
          ...h.scene.geometries,
          ...h.scene.textures,
          ...h.scene.transformNodes,
        ];
        const preserved =
          structure.diagnostics().state === 'ready' &&
          baselineObjects.length === now.length &&
          baselineObjects.every((object, i) => object === now[i]) &&
          structureSnapshot!.every(
            ({ mesh, material, geometry, indices, kinds, world }) =>
              !mesh.isDisposed() &&
              mesh.material === material &&
              mesh.geometry === geometry &&
              equal(mesh.getIndices()!, indices) &&
              kinds.every(({ kind, values }) => equal(mesh.getVerticesData(kind)!, values)) &&
              equal(mesh.getWorldMatrix().asArray(), world),
          );
        receipts.push({
          cycle,
          structurePreserved: preserved,
          structuralParts: structureSnapshot!.length,
          resources: resources(),
        });
        requireValue(preserved, 'Lamp disposal altered the independent original A07 structure');
        if (h.gpu.diagnostics().lost) structure.dispose();
        else
          await lease('Independent A07 structure disposal', async () => {
            structure!.dispose();
          });
        structure = undefined;
        requireValue(
          JSON.stringify(resources()) === JSON.stringify(baseline),
          'Structure cleanup did not restore pre-component baseline',
        );
      }
    }
  } catch (e) {
    failure = e instanceof Error ? (e.stack ?? e.message) : String(e);
  } finally {
    clearTimeout(totalTimer);
    const cleanupErrors = cleanupPresentation([
      ...originals.flatMap((m) => [() => m.geometry.dispose(), () => m.material.dispose()]),
      () => owner?.dispose(),
      () => structure?.dispose(),
      () => {
        h.gl.compileShader = compile;
        h.gl.linkProgram = link;
      },
      () => h.dispose(),
    ]);
    if (cleanupErrors.length) {
      const error = cleanupErrors[0];
      failure ??= error instanceof Error ? (error.stack ?? error.message) : String(error);
    }
  }
  return {
    sourceSha256: originalLampSourceSha256,
    transport: h.transport,
    forceStandalone,
    baseline,
    rows,
    receipts,
    images,
    failure,
    loss,
    scope:
      'Original five cylinder lamps, native emission, authoritative snapshots and independent A07 structural co-presence; no banner, bloom, shadow or final PBR/environment parity',
  };
}
export async function babylonStartLamps(forceStandalone = false, loseContext = false) {
  const deadline = performance.now() + 120000;
  const report = await probe(forceStandalone, loseContext, deadline);
  const restart =
    loseContext && !report.failure ? await probe(forceStandalone, false, deadline) : null;
  return { ...report, restart };
}
