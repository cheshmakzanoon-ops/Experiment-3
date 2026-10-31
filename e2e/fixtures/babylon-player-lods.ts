import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { Color4, Vector3 } from '@babylonjs/core/Maths/math.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import {
  loadExistingPlayer,
  existingPlayerPrimitiveBindings,
} from '../../src/engine/babylon/existing-player.ts';
import { ExistingPlayerSteering } from '../../src/engine/babylon/existing-player-steering.ts';
import { ExistingPlayerLods } from '../../src/engine/babylon/existing-player-lods.ts';
import { loadPlayerLods } from '../../src/engine/assets/player-lod-data.ts';
import { BabylonPresentationGpu } from '../../src/engine/babylon/presentation-gpu.ts';
import { PresentationSchedule } from '../../src/engine/babylon/presentation-schedule.ts';
import { waitForPresentation } from '../../src/engine/babylon/presentation-ready.ts';
import {
  prepareOriginalMaterials,
  yieldPreparationTurn,
} from '../../src/engine/babylon/asset-preparation.ts';

/** Isolated real-WebGL acceptance, never imported by the game. Full authored
 * GLB/textures/shaders and existing preparation/presentation owners. Readback
 * and driver handles exist ONLY here; no production graphics hooks are added.
 * Reduced-tier captures are evidence to inspect, NOT a claimed visual match. */
export async function babylonPlayerLods() {
  const canvas = document.createElement('canvas');
  canvas.width = 1440;
  canvas.height = 900;
  document.body.append(canvas);
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('Index-tier acceptance requires real WebGL2');
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0.1, 0.15, 0.2, 1);
  const camera = new UniversalCamera('fixed-original-model', new Vector3(0, 3, -8), scene);
  camera.minZ = 0.05;
  camera.maxZ = 10000;
  camera.fov = Math.PI / 3;
  const sky = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
  sky.intensity = 0.7;
  const sun = new DirectionalLight('sun', new Vector3(-0.3, -1, 0.4), scene);
  sun.intensity = 1.5;
  const gpu = new BabylonPresentationGpu(gl),
    schedule = new PresentationSchedule();
  const abort = new AbortController(),
    deadline = performance.now() + 120000;
  const timer = setTimeout(
    () => abort.abort(new Error('Original model probe exceeded its 120000ms total budget')),
    120000,
  );
  canvas.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault();
      gpu.contextLost();
      abort.abort(new Error('Original model probe lost WebGL context'));
    },
    { signal: abort.signal },
  );
  let container: AssetContainer | undefined,
    steering: ExistingPlayerSteering | undefined,
    lods: ExistingPlayerLods | undefined;
  try {
    container = await loadExistingPlayer(scene, document.baseURI, abort.signal);
    const data = await loadPlayerLods(
      new URL('models/supplied-player-lods.bin.gz', document.baseURI).href,
      abort.signal,
    );
    // Existing steering adapter owns the neutral authored sample. No simulation
    // solver, model clone, material replacement or animation clock is introduced.
    steering = new ExistingPlayerSteering(container.animationGroups);
    const bindings = existingPlayerPrimitiveBindings(container);
    let low = new Vector3(Infinity, Infinity, Infinity),
      high = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const { mesh } of bindings) {
      mesh.computeWorldMatrix(true);
      low = Vector3.Minimize(low, mesh.getBoundingInfo().boundingBox.minimumWorld);
      high = Vector3.Maximize(high, mesh.getBoundingInfo().boundingBox.maximumWorld);
    }
    const center = low.add(high).scale(0.5),
      span = high.subtract(low).length();
    camera.position.copyFrom(center.add(new Vector3(span * 0.8, span * 0.45, -span * 0.85)));
    camera.setTarget(center);
    let compiled = 0;
    await prepareOriginalMaterials(container, gpu, abort.signal, deadline, (done) => {
      compiled = done;
    });
    container.addAllToScene();
    lods = new ExistingPlayerLods(bindings, data, gpu);
    const originalIndices = bindings.map(({ mesh }) => mesh.getIndices()!);
    const originalOwners = bindings.map(({ mesh }) => ({
      geometry: mesh.geometry!,
      submesh: mesh.subMeshes[0],
      bounds: mesh.getBoundingInfo(),
      material: mesh.material,
      skeleton: mesh.skeleton,
      parent: mesh.parent,
      buffers: mesh.getVerticesDataKinds().map((kind) => mesh.getVertexBuffer(kind)),
      arrays: mesh.getVerticesDataKinds().map((kind) => mesh.getVertexBuffer(kind)!.getData()),
    }));
    const bones = container.skeletons.flatMap((skeleton) => skeleton.bones);
    const snapshotBones = () => bones.map((bone) => [...bone.getLocalMatrix().asArray()]);
    const snapshotPose = () =>
      container!.transformNodes.map((node) => ({
        node,
        position: node.position.clone(),
        scaling: node.scaling.clone(),
        rotation: node.rotation.clone(),
        quaternion: node.rotationQuaternion?.clone(),
      }));
    let boneMatrices: ReturnType<typeof snapshotBones> | undefined;
    let pose: ReturnType<typeof snapshotPose> | undefined;
    const resourceCounts = () => ({
      meshes: container!.meshes.length,
      geometries: container!.geometries.length,
      materials: container!.materials.length,
      textures: container!.textures.length,
      bones: bones.length,
      animations: container!.animationGroups.length,
    });
    const retained = resourceCounts();
    const originalBuffers = () =>
      bindings.map(
        ({ mesh }) => mesh.geometry!.getIndexBuffer()!.underlyingResource as WebGLBuffer,
      );
    const capture = () => {
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return { pixels, image: canvas.toDataURL('image/png') };
    };
    const presented = async () => {
      let done = false;
      const completed = waitForPresentation(scene, abort.signal, gpu).then(() => {
        done = true;
      });
      // Handle rejection immediately while driving, then propagate the same failure.
      let failure: unknown;
      void completed.catch((error) => {
        failure = error;
      });
      while (!done) {
        abort.signal.throwIfAborted();
        if (failure) throw failure;
        gpu.ready();
        await Promise.resolve();
        if (done) break;
        gpu.frame(schedule, false, scene, () => {
          const before = scene.isReady();
          engine.beginFrame();
          scene.render();
          engine.endFrame();
          const after = scene.isReady();
          schedule.rendered(before, after);
          return before && after;
        });
        await yieldPreparationTurn(abort.signal, deadline);
      }
      await completed;
    };
    const rows = [];
    let baseline: Uint8Array | undefined;
    for (const tier of [0, 1, 2, 3, 0]) {
      abort.signal.throwIfAborted();
      const before = originalBuffers(),
        receiptBefore = gpu.diagnostics().completed;
      await lods.setTier(tier, { signal: abort.signal, deadline });
      await presented();
      // First real draw synchronizes Babylon's linked bone matrices. Freeze the
      // comparison receipt after that baseline, not before its normal first use.
      boneMatrices ??= snapshotBones();
      pose ??= snapshotPose();
      const baselineBones = boneMatrices;
      const after = originalBuffers();
      let matchingIndices = true,
        matchingResources = true,
        releasedReplacements = true,
        indexCount = 0;
      const previousCopyRead = gl.getParameter(gl.COPY_READ_BUFFER_BINDING) as WebGLBuffer | null;
      try {
        bindings.forEach(({ mesh, source }, index) => {
          const old = originalOwners[index],
            cpu = mesh.getIndices()!;
          const level = tier ? data.rows.get(source.key)!.levels[tier - 1] : null;
          const expected =
            !level || level.offset === -1
              ? originalIndices[index]
              : data.indices.subarray(level.offset, level.offset + level.count);
          const buffer = mesh.geometry!.getIndexBuffer()!;
          const gpuIndices = buffer.is32Bits
            ? new Uint32Array(cpu.length)
            : new Uint16Array(cpu.length);
          gl.bindBuffer(gl.COPY_READ_BUFFER, after[index]);
          matchingIndices &&=
            gl.getBufferParameter(gl.COPY_READ_BUFFER, gl.BUFFER_SIZE) === gpuIndices.byteLength;
          gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, gpuIndices);
          matchingIndices &&=
            cpu.length === expected.length &&
            gpuIndices.every(
              (value, i) => value === expected[i] && cpu[i] === value && value < source.vertices,
            );
          indexCount += cpu.length;
          matchingResources &&=
            mesh.geometry === old.geometry &&
            mesh.subMeshes.length === 1 &&
            mesh.subMeshes[0] === old.submesh &&
            old.submesh.IsGlobal &&
            mesh.getBoundingInfo() === old.bounds &&
            old.submesh.getBoundingInfo() === old.bounds &&
            mesh.material === old.material &&
            mesh.skeleton === old.skeleton &&
            mesh.parent === old.parent &&
            mesh
              .getVerticesDataKinds()
              .every(
                (kind, i) =>
                  mesh.getVertexBuffer(kind) === old.buffers[i] &&
                  mesh.getVertexBuffer(kind)!.getData() === old.arrays[i],
              );
          if (before[index] !== after[index]) releasedReplacements &&= !gl.isBuffer(before[index]);
        });
      } finally {
        gl.bindBuffer(gl.COPY_READ_BUFFER, previousCopyRead);
      }
      const shot = capture();
      baseline ??= shot.pixels;
      let differentChannels = 0,
        visiblePixels = 0;
      for (let index = 0; index < shot.pixels.length; index++)
        if (shot.pixels[index] !== baseline[index]) differentChannels++;
      for (let index = 0; index < shot.pixels.length; index += 4)
        if (
          shot.pixels[index] !== shot.pixels[0] ||
          shot.pixels[index + 1] !== shot.pixels[1] ||
          shot.pixels[index + 2] !== shot.pixels[2]
        )
          visiblePixels++;
      const unchangedPose =
        pose.every(
          ({ node, position, scaling, rotation, quaternion }) =>
            node.position.equals(position) &&
            node.scaling.equals(scaling) &&
            node.rotation.equals(rotation) &&
            (quaternion ? !!node.rotationQuaternion?.equals(quaternion) : !node.rotationQuaternion),
        ) &&
        bones.every((bone, i) =>
          bone
            .getLocalMatrix()
            .asArray()
            .every((value, j) => value === baselineBones[i][j]),
        );
      rows.push({
        tier,
        triangles: indexCount / 3,
        matchingIndices,
        matchingResources,
        releasedReplacements,
        unchangedPose,
        originalIndexIdentity:
          tier !== 0 || bindings.every(({ mesh }, i) => mesh.getIndices() === originalIndices[i]),
        completedFrames: gpu.diagnostics().completed - receiptBefore,
        activeIndices: scene.getActiveIndices(),
        differentChannels,
        visiblePixels,
        image: shot.image,
        resources: resourceCounts(),
        glError: gl.getError(),
      });
    }
    await lods.dispose(deadline);
    const finalBuffers = originalBuffers();
    steering.dispose();
    container.dispose();
    const disposedIndexBuffers = finalBuffers.every((buffer) => !gl.isBuffer(buffer));
    return {
      compiled,
      retained,
      rows,
      disposedIndexBuffers,
      adapter: lods.diagnostics(),
      graphics: gpu.diagnostics(),
      glError: gl.getError(),
    };
  } finally {
    clearTimeout(timer);
    abort.abort();
    gpu.dispose();
    steering?.dispose();
    container?.dispose();
    // On fatal loss the model owner tears down; metadata abandonment must not
    // issue another restoration write or mask the original exception.
    try {
      await lods?.dispose(deadline);
    } catch {
      /* Original probe failure wins. */
    }
    scene.dispose();
    engine.dispose();
    canvas.remove();
  }
}
