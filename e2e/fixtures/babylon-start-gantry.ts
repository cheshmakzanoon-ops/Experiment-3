import * as T from 'three';
import atlasOracle from '../../tests/fixtures/a07-atlas-pixels.json' with { type: 'json' };
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import type { WebGLPipelineContext } from '@babylonjs/core/Engines/WebGL/webGLPipelineContext.js';
import { Track, trackPoint } from '../../src/simulation/track.ts';
import { BroadcastSightlines } from '../../src/rendering/broadcast-sightlines.ts';
import { START_GANTRY, decodeStartGantry } from '../../src/rendering/start-gantry.ts';
import { loadBabylonStartGantry } from '../../src/engine/babylon/start-gantry.ts';
import { yieldPreparationTurn } from '../../src/engine/babylon/asset-preparation.ts';
import { createSurfaceProbeHarness, surfaceProbeResources } from './babylon-surface-parity.ts';

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, '0')).join('');
const context = {
  presentation: 'circuit',
  vehicles: [{ classId: 'formula', dynamicsKind: 'four-wheel' }],
} as const;
const equal = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.from(a).every((n, i) => n === b[i]);
const invariant = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};

/** Native textures and native PBR only. CPU placeholders belong exclusively to
 * the unchanged Three geometry oracle and never enter the presented scene.
 * This is structure/data evidence, NOT final PBR/environment/weather parity. */
async function probe(forceStandalone: boolean, loseContext: boolean, deadline: number) {
  const h = createSurfaceProbeHarness(1200, 800, undefined, forceStandalone);
  h.deadline = deadline;
  const totalTimer = setTimeout(
    () => h.abort.abort(new Error('A07 total case deadline exceeded')),
    Math.max(0, deadline - performance.now()),
  );
  const track = new Track(),
    station = track.at(0, trackPoint());
  const referenceRoot = new T.Group();
  referenceRoot.position.set(station.x, station.y, station.z);
  referenceRoot.rotation.y = Math.atan2(station.tx, station.tz);
  referenceRoot.updateMatrixWorld(true);
  const world = (x: number, y: number, z: number) => {
    const p = new T.Vector3(x, y, z).applyMatrix4(referenceRoot.matrixWorld);
    return new Vector3(p.x, p.y, p.z);
  };
  const camera = new UniversalCamera('A07 inspection', world(0, 8, -32), h.scene);
  camera.minZ = 0.1;
  camera.maxZ = 150;
  camera.setTarget(world(0, 3, 0));
  const sky = new HemisphericLight('isolated neutral inspection sky', Vector3.Up(), h.scene);
  sky.intensity = 1.2;
  const key = new DirectionalLight(
    'isolated neutral inspection key',
    new Vector3(-1, -2, 1),
    h.scene,
  );
  key.intensity = 2;
  // Initialize Babylon's shared default-material infrastructure before measuring
  // model-owned resources. No model asset or texture is replaced.
  const warm = new PBRMaterial('warm infrastructure', h.scene);
  warm.dispose();
  const resources = () => ({
    ...surfaceProbeResources(h.scene),
    transforms: h.scene.transformNodes.length,
  });
  const baseline = resources();
  const infrastructure = new Set<object>([
    ...h.scene.meshes,
    ...h.scene.geometries,
    ...h.scene.materials,
    ...h.scene.textures,
    ...h.scene.transformNodes,
  ]);
  const options = (signal = h.abort.signal) => ({
    scene: h.scene,
    track,
    context,
    base: location.origin + '/',
    signal,
    gpu: h.gpu,
    deadline: h.deadline,
    schedule: h.schedule,
    isCurrent: () => !signal.aborted && !h.scene.isDisposed,
  });
  const lease = <T>(label: string, work: () => Promise<T>) => {
    let result!: T;
    return h.gpu
      .prepare(label, h.deadline, async (signal) => {
        signal.throwIfAborted();
        result = await work();
        signal.throwIfAborted();
      })
      .then(() => result);
  };
  const pump = async (pending: Promise<void>) => {
    let done = false,
      failure: unknown;
    void pending.then(
      () => {
        done = true;
      },
      (error) => {
        done = true;
        failure = error;
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
      await yieldPreparationTurn(h.abort.signal, h.deadline);
    }
    if (failure) throw failure;
    await pending;
  };
  let owner: Awaited<ReturnType<typeof loadBabylonStartGantry>> | undefined;
  let oracle: Awaited<ReturnType<typeof decodeStartGantry>> | undefined;
  const rows: object[] = [];
  const images: { name: string; image: string }[] = [];
  let failure: string | null = null;
  let loss: object | null = null;
  try {
    const response = await fetch(new URL(START_GANTRY.url, location.origin), {
      signal: h.abort.signal,
    });
    invariant(response.ok, 'Original A07 oracle request failed');
    const raw = new Uint8Array(await response.arrayBuffer());
    const sourceAtlases = await lease('A07 independent embedded PNG decode', async () => {
      invariant(
        START_GANTRY.sha256 === atlasOracle.assetSha256 &&
          hex(await crypto.subtle.digest('SHA-256', raw)) === atlasOracle.assetSha256,
        'Original A07 PNG oracle asset identity mismatch',
      );
      const header = new DataView(raw.buffer),
        jsonLength = header.getUint32(12, true);
      const document = JSON.parse(new TextDecoder().decode(raw.subarray(20, 20 + jsonLength))) as {
        materials: {
          normalTexture: { index: number };
          pbrMetallicRoughness: {
            baseColorTexture: { index: number };
            metallicRoughnessTexture: { index: number };
          };
        }[];
        textures: { source: number }[];
        images: { mimeType: string; bufferView: number }[];
        bufferViews: { byteOffset?: number; byteLength: number }[];
      };
      const binary = 28 + jsonLength;
      invariant(header.getUint32(24 + jsonLength, true) === 0x004e4942, 'A07 binary chunk missing');
      const material = document.materials[0];
      const roles = [
        ['baseColor', material.pbrMetallicRoughness.baseColorTexture.index],
        ['normal', material.normalTexture.index],
        ['metallicRoughness', material.pbrMetallicRoughness.metallicRoughnessTexture.index],
      ] as const;
      const decoded = [];
      for (const [role, index] of roles) {
        h.abort.signal.throwIfAborted();
        const frozen = atlasOracle.roles[role];
        invariant(
          index === frozen.textureIndex && document.textures[index].source === frozen.imageIndex,
          `Original ${role} texture/image mapping mismatch`,
        );
        const image = document.images[document.textures[index].source];
        const view = document.bufferViews[image.bufferView];
        const start = binary + (view.byteOffset ?? 0),
          end = start + view.byteLength;
        invariant(
          image.mimeType === 'image/png' && start >= binary && end <= raw.length,
          'A07 embedded PNG bounds/type mismatch',
        );
        const png = raw.slice(start, end);
        invariant(
          equal(png.subarray(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]),
          'A07 embedded image is not PNG',
        );
        const pngSha256 = hex(await crypto.subtle.digest('SHA-256', png));
        invariant(pngSha256 === frozen.pngSha256, `Original ${role} compressed PNG hash mismatch`);
        const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }), {
          colorSpaceConversion: 'none',
          premultiplyAlpha: 'none',
          imageOrientation: 'none',
        });
        try {
          h.abort.signal.throwIfAborted();
          invariant(
            bitmap.width === 512 && bitmap.height === 512,
            'Original atlas must be 512 square',
          );
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
          invariant(ctx, 'Independent PNG 2D decoder unavailable');
          ctx!.drawImage(bitmap, 0, 0);
          const pixels = ctx!.getImageData(0, 0, bitmap.width, bitmap.height).data;
          invariant(
            pixels.every((value, i) => i % 4 !== 3 || value === 255),
            'Original A07 atlas must be opaque',
          );
          const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(pixels));
          invariant(
            pixels.byteLength === frozen.rgbaBytes && hex(digest) === frozen.rgbaSha256,
            `Browser ${role} decode differs from frozen independent PNG oracle`,
          );
          decoded.push({
            role,
            pngSha256,
            pixels,
            sha256: Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join(
              '',
            ),
          });
        } finally {
          bitmap.close();
        }
      }
      return decoded;
    });
    const cpu = new GLTFLoader().register(() => ({
      name: 'A07_independent_CPU_oracle',
      loadTexture: () =>
        Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
    }));
    oracle = await decodeStartGantry(raw, cpu);
    oracle.build(track, referenceRoot, new BroadcastSightlines());
    referenceRoot.updateMatrixWorld(true);

    // Cancellation after actual native decode must dispose its late off-scene
    // container, not publish it or poison the next installation.
    const cancelled = new AbortController();
    let decodedOnCancel = false,
      rejectedCancel = false;
    const cancelledReleases: number[] = [];
    const cancelledGeometries: { isDisposed(): boolean }[] = [];
    try {
      await loadBabylonStartGantry(options(AbortSignal.any([h.abort.signal, cancelled.signal])), {
        decode: async (bytes, scene) => {
          const container = await LoadAssetContainerAsync(bytes, scene, {
            pluginExtension: '.glb',
          });
          cancelledGeometries.push(...container.geometries);
          for (const resource of [
            ...container.meshes,
            ...container.materials,
            ...container.textures,
            ...container.transformNodes,
          ]) {
            const index = cancelledReleases.push(0) - 1;
            const observable: { add(callback: () => void): unknown } = resource.onDisposeObservable;
            observable.add(() => {
              cancelledReleases[index]++;
            });
          }
          decodedOnCancel = true;
          cancelled.abort();
          return container;
        },
      });
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'AbortError') throw error;
      rejectedCancel = true;
    }
    invariant(decodedOnCancel && rejectedCancel, 'Native decode cancellation was not exercised');
    invariant(
      cancelledReleases.length > 0 &&
        cancelledReleases.every((count) => count === 1) &&
        cancelledGeometries.every((g) => g.isDisposed()),
      'Cancelled off-scene native resources did not each dispose exactly once',
    );
    invariant(
      JSON.stringify(resources()) === JSON.stringify(baseline),
      'Cancelled native import leaked scene resources',
    );

    for (let cycle = 0; cycle < 2; cycle++) {
      owner = await loadBabylonStartGantry(options());
      const d = owner.diagnostics();
      invariant(
        JSON.stringify(resources()) === JSON.stringify(baseline),
        'Prepared A07 inserted resources before installation',
      );
      invariant(
        d.stagedParts === 4 &&
          d.activeParts === 0 &&
          d.retainedTriangles === 9520 &&
          d.retainedMeshes === 13,
        'Unexpected retained/staged A07 inventory',
      );
      const geometry = d.parts.map(({ name, mesh }) => {
        const ref = oracle!.chunks[0].levels[0].getObjectByName(name) as T.Mesh;
        invariant(ref, 'Missing original Three part');
        return {
          name,
          position: equal(
            mesh.getVerticesData('position')!,
            ref.geometry.getAttribute('position').array,
          ),
          normal: equal(mesh.getVerticesData('normal')!, ref.geometry.getAttribute('normal').array),
          uv: equal(mesh.getVerticesData('uv')!, ref.geometry.getAttribute('uv').array),
          indices: equal(mesh.getIndices()!, ref.geometry.index!.array),
          world: equal(
            mesh.computeWorldMatrix(true).asArray(),
            new Float32Array(ref.matrixWorld.elements),
          ),
        };
      });
      invariant(
        geometry.length === 4 &&
          geometry.every(
            ({ position, normal, uv, indices, world }) =>
              position && normal && uv && indices && world,
          ),
        'Original geometry/world transform mismatch',
      );
      const binds = new Map<string, number>();
      const material = d.parts[0].material;
      material.onBindObservable.add((mesh) => {
        if (mesh) binds.set(mesh.name, (binds.get(mesh.name) ?? 0) + 1);
      });
      const before = h.gpu.diagnostics().completed;
      await pump(owner.install());
      const releases: number[] = [];
      const geometries = h.scene.geometries.filter((g) => !infrastructure.has(g));
      for (const resource of [
        ...h.scene.meshes,
        ...h.scene.materials,
        ...h.scene.textures,
        ...h.scene.transformNodes,
      ]) {
        if (infrastructure.has(resource)) continue;
        const index = releases.push(0) - 1;
        const observable: { add(callback: () => void): unknown } = resource.onDisposeObservable;
        observable.add(() => {
          releases[index]++;
        });
      }
      let rejectedDuplicate = false;
      try {
        await owner.install();
      } catch {
        rejectedDuplicate = true;
      }
      const views = [];
      for (const view of [
        { name: 'front', eye: [0, 7, -32], target: [0, 3, 0] },
        { name: 'rear', eye: [0, 7, 32], target: [0, 3, 0] },
        { name: 'atlas-ladder-detail', eye: [-14, 6, 7], target: [-10.8, 3.8, 0.8] },
      ]) {
        camera.position.copyFrom(world(...(view.eye as [number, number, number])));
        camera.setTarget(world(...(view.target as [number, number, number])));
        await h.presented();
        views.push(
          await lease(`A07 ${view.name} screenshot`, async () => {
            const capture = h.capture();
            return {
              name: view.name,
              image: capture.image,
              visiblePixels: capture.pixels.filter((_n, i) => i % 4 === 3 && capture.pixels[i] > 0)
                .length,
              glError: h.gl.getError(),
            };
          }),
        );
      }
      const receipt = await lease('A07 native texture/program evidence', async () => ({
        normalScale: material.bumpTexture!.level,
        ambientAbsent: material.ambientTexture === null,
        backFaceCulling: material.backFaceCulling,
        metallic: material.metallic,
        roughness: material.roughness,
        metallicBlue: material.useMetallnessFromMetallicTextureBlue,
        roughnessGreen: material.useRoughnessFromMetallicTextureGreen,
        roughnessAlpha: material.useRoughnessFromMetallicTextureAlpha,
        textures: await (async () => {
          const textures = [];
          for (const texture of [
            material.albedoTexture!,
            material.bumpTexture!,
            material.metallicTexture!,
          ]) {
            const source: (typeof sourceAtlases)[number] = sourceAtlases[textures.length];
            // Native glTF uploads invertY=false. GL row zero therefore contains
            // source PNG row zero; readPixels returns that same row first. Compare
            // directly: no flip search, colour conversion or gamma reinterpretation.
            invariant(
              texture instanceof Texture && !texture.invertY,
              'Unexpected native glTF PNG row orientation',
            );
            const pixels = await texture.readPixels();
            invariant(pixels, 'Native PNG texture has no GPU pixels');
            const data = new Uint8Array(pixels!.buffer, pixels!.byteOffset, pixels!.byteLength);
            const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(data));
            invariant(
              hex(digest) === atlasOracle.roles[source.role].rgbaSha256,
              `GPU ${source.role} hash differs from frozen independent PNG oracle`,
            );
            invariant(
              equal(data, source.pixels),
              `Native ${source.role} GPU pixels differ from original PNG bytes`,
            );
            textures.push({
              name: texture.name,
              role: source.role,
              sourceSha256: source.sha256,
              sourcePngSha256: source.pngSha256,
              exactSourcePixels: true,
              rowOrientation: 'source-top-row-is-GL-row-zero (native invertY=false)',
              ready: texture.isReady(),
              size: texture.getSize(),
              level: texture.level,
              gammaSpace: texture.gammaSpace,
              uv: Array.from(texture.getTextureMatrix().asArray()),
              sha256: Array.from(new Uint8Array(digest), (n) =>
                n.toString(16).padStart(2, '0'),
              ).join(''),
              min: data.reduce((a, b) => Math.min(a, b), 255),
              max: data.reduce((a, b) => Math.max(a, b), 0),
            });
          }
          return textures;
        })(),
        programs: d.parts.map(({ name, mesh }) => {
          const effect = mesh.subMeshes[0]?.effect;
          const program = (effect?.getPipelineContext() as WebGLPipelineContext | null)?.program;
          return {
            name,
            binds: binds.get(name) ?? 0,
            linked:
              !!program &&
              h.gl.isProgram(program) &&
              !!h.gl.getProgramParameter(program, h.gl.LINK_STATUS),
            compilationError: effect?.getCompilationError(),
            samplers: effect?.getSamplers(),
            ubo: material._uniformBuffer.useUbo,
          };
        }),
        active: h.scene.meshes
          .filter((m) => m.getTotalVertices() > 0 && m.isEnabled())
          .map((m) => m.name),
        retained: resources(),
        glError: h.gl.getError(),
      }));
      images.push(...views.map(({ name, image }) => ({ name: `cycle-${cycle}-${name}`, image })));
      invariant(rejectedDuplicate, 'Duplicate install accepted');
      invariant(
        receipt.active.length === 4 &&
          receipt.active.every((name) => d.parts.some((p) => p.name === name)),
        'Hidden LOD meshes doubled the active geometry',
      );
      invariant(
        receipt.ambientAbsent &&
          !receipt.backFaceCulling &&
          receipt.normalScale === 0.3499999940395355 &&
          receipt.metallic === 1 &&
          receipt.roughness === 1 &&
          receipt.metallicBlue &&
          receipt.roughnessGreen &&
          !receipt.roughnessAlpha,
        'Original PBR atlas material binding mismatch',
      );
      invariant(
        receipt.programs.every(
          (p) =>
            p.binds > 0 && p.linked && !p.compilationError && p.ubo === (h.transport === 'ubo'),
        ),
        'Original A07 parts did not bind actual linked native effects',
      );
      invariant(
        receipt.textures.length === 3 &&
          new Set(receipt.textures.map((t) => t.sha256)).size === 3 &&
          receipt.textures.every(
            (t, i) =>
              t.ready &&
              t.size.width === 512 &&
              t.size.height === 512 &&
              t.min < t.max &&
              t.gammaSpace === (i === 0),
          ),
        'Native PNG GPU texture decode missing or substituted',
      );
      invariant(
        receipt.glError === 0 && views.every((v) => v.glError === 0 && v.visiblePixels > 1000),
        'Original A07 draw/readback failed',
      );
      const completedFrames = h.gpu.diagnostics().completed - before;
      if (loseContext && cycle === 1) {
        const extension = await lease('A07 loss extension', async () =>
          h.gl.getExtension('WEBGL_lose_context'),
        );
        invariant(extension, 'WEBGL_lose_context unavailable');
        const lost = new Promise<void>((resolve, reject) => {
          h.canvas.addEventListener('webglcontextlost', () => resolve(), { once: true });
          h.abort.signal.addEventListener(
            'abort',
            () => {
              queueMicrotask(() =>
                h.gpu.diagnostics().lost ? resolve() : reject(h.abort.signal.reason),
              );
            },
            { once: true },
          );
        });
        extension!.loseContext();
        await lost;
        owner.dispose();
        loss = {
          diagnostics: h.gpu.diagnostics(),
          resources: resources(),
          disposed: d.parts.every(({ mesh }) => mesh.isDisposed()),
        };
      } else {
        await lease('A07 owner disposal', async () => {
          owner!.dispose();
          owner!.dispose();
        });
      }
      invariant(completedFrames >= 8, 'Insufficient completed fenced A07 frames');
      invariant(
        releases.length > 0 &&
          releases.every((count) => count === 1) &&
          geometries.every((g) => g.isDisposed()),
        'Native A07 resources did not each dispose exactly once',
      );
      invariant(
        JSON.stringify(resources()) === JSON.stringify(baseline) &&
          d.parts.every(({ mesh }) => mesh.isDisposed()),
        'A07 disposal leaked scene resources',
      );
      rows.push({
        cycle,
        geometry,
        views,
        receipt,
        rejectedDuplicate,
        releases,
        cancelledReleases,
        completedFrames,
        state: owner.diagnostics().state,
        restored: resources(),
        disposed: d.parts.every(({ mesh }) => mesh.isDisposed()),
        triangles: d.retainedTriangles,
        retainedMeshes: d.retainedMeshes,
        sha256: d.sha256,
      });
      owner = undefined;
    }
  } catch (error) {
    failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  } finally {
    clearTimeout(totalTimer);
    oracle?.dispose();
    try {
      owner?.dispose();
    } finally {
      h.dispose();
    }
  }
  return {
    forceStandalone,
    transport: h.transport,
    baseline,
    rows,
    images,
    failure,
    loss,
    scope:
      'Original A07 native GLB/PNG, geometry, atlas binding, four LOD0 parts and lifecycle only; no banner, lamps, weather, shadows, LOD switching or final PBR/environment parity',
  };
}

/** One original 120s budget includes loss, teardown and a fresh-context restart. */
export async function babylonStartGantry(forceStandalone = false, loseContext = false) {
  const deadline = performance.now() + 120000;
  const report = await probe(forceStandalone, loseContext, deadline);
  const restart =
    loseContext && !report.failure ? await probe(forceStandalone, false, deadline) : null;
  return { ...report, restart };
}
