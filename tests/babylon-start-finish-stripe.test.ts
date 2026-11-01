import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
import {
  createBabylonStartFinishStripe,
  reverseOpaqueStripeRows,
} from '../src/engine/babylon/start-finish-stripe.ts';
import { CircuitScene } from '../src/rendering/circuit.ts';
import { mesh, canvasTexture, batchScene } from '../src/rendering/geometry.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { AUREL, VELLAMAR } from '../src/simulation/circuits.ts';

const context = {
  presentation: 'circuit',
  vehicles: [{ classId: 'formula', dynamicsKind: 'four-wheel' }],
} as const;
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
/** Exact integer fillRect raster fixture: original opaque checker rectangles
 * have no text, scaling, antialiasing or color blending. Not a GPU pixel test. */
interface CanvasRecord {
  canvas: HTMLCanvasElement;
  commands: unknown[][];
  reads: unknown[][];
}
function canvasDocument() {
  const records: CanvasRecord[] = [];
  const createElement = vi.fn((tag: string) => {
    if (tag !== 'canvas') throw new Error('Unexpected element');
    const commands: unknown[][] = [],
      reads: unknown[][] = [];
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
    let raster: Uint8ClampedArray | undefined;
    const target = {
      fillStyle: '#000000',
      fillRect: (x: number, y: number, width: number, height: number) => {
        commands.push(['fillRect', x, y, width, height]);
        if (!raster) raster = new Uint8ClampedArray(canvas.width * canvas.height * 4);
        expect([x, y, width, height].every(Number.isInteger)).toBe(true);
        expect(target.fillStyle).toMatch(/^#[0-9a-f]{6}$/);
        const value = parseInt(target.fillStyle.slice(1), 16);
        const rgba = [value >> 16, (value >> 8) & 255, value & 255, 255];
        for (let row = y; row < y + height; row++)
          for (let col = x; col < x + width; col++)
            raster.set(rgba, (row * canvas.width + col) * 4);
      },
      getImageData: (...args: unknown[]) => {
        reads.push(args);
        return { data: raster!.slice(), width: canvas.width, height: canvas.height };
      },
    };
    const drawing = new Proxy(target, {
      set(object, key, value) {
        commands.push([String(key), value]);
        Reflect.set(object, key, value);
        return true;
      },
    });
    canvas.getContext = vi.fn(() => drawing) as unknown as HTMLCanvasElement['getContext'];
    records.push({ canvas, commands, reads });
    return canvas;
  });
  vi.stubGlobal('document', {
    createElement,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  return { records, createElement };
}
/** Execute the unchanged original finish drawing and mesh construction, then
 * its actual production static-batching boundary. No migration helper involved. */
function original(track: Track) {
  const source = readFileSync('src/rendering/circuit.ts', 'utf8');
  const start = '    const finish = canvasTexture(128, 32, (c) => {';
  const end = '    line.rotation.set(-Math.PI / 2, 0, -Math.atan2(p.tx, p.tz));';
  const a = source.indexOf(start),
    b = source.indexOf(end);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(a).toBe(source.lastIndexOf(start));
  expect(b).toBeGreaterThan(a);
  expect(b).toBe(source.lastIndexOf(end));
  const body = source.slice(a, b + end.length);
  expect(body.length).toBeGreaterThan(0);
  const construct = new Function('T', 'trackPoint', 'mesh', 'canvasTexture', body);
  const bound = { track, props: new T.Group(), at: CircuitScene.prototype.at };
  construct.call(bound, T, trackPoint, mesh, canvasTexture);
  expect(bound.props.children).toHaveLength(1);
  batchScene(bound.props, new Set());
  expect(bound.props.children).toHaveLength(1);
  bound.props.updateMatrixWorld(true);
  const result = bound.props.children[0] as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
  return {
    mesh: result,
    dispose: () => {
      result.geometry.dispose();
      result.material.map?.dispose();
      result.material.dispose();
    },
  };
}
/** NullEngine cannot qualify hardware sRGB. This explicit seam supplies ONLY
 * the native metadata contract so unit tests can exercise ownership/mapping. */
function allocateTexture(data: Uint8Array, width: number, height: number, scene: Scene) {
  const texture = new RawTexture(
    data,
    width,
    height,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
    0,
    true,
  );
  texture.getInternalTexture()!._useSRGBBuffer = true;
  texture.gammaSpace = false;
  return texture;
}

describe('Original start-finish stripe (NullEngine CPU contracts, not GPU parity)', () => {
  const engines: NullEngine[] = [],
    scenes: Scene[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    scenes.splice(0).forEach((scene) => {
      if (!scene.isDisposed) scene.dispose();
    });
    engines.splice(0).forEach((engine) => engine.dispose());
    vi.unstubAllGlobals();
  });
  function options(controller = new AbortController()) {
    const engine = new NullEngine(),
      scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    engine.getCaps().supportSRGBBuffers = true;
    engines.push(engine);
    scenes.push(scene);
    canvasDocument();
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
          work: (signal: AbortSignal) => Promise<unknown>,
        ) => work(new AbortController().signal),
      } as unknown as Parameters<typeof createBabylonStartFinishStripe>[0]['gpu'],
    };
  }
  const dependencies = {
    allocateTexture,
    prepare: vi.fn(async () => {}),
    present: vi.fn(async () => {}),
  };
  it('pins unchanged original construction, drawing and batching source', () => {
    expect(hash(readFileSync('src/rendering/circuit.ts'))).toBe(
      'd11fbbbb5dd7efc427dc230da026dfe8e33f0f6aad191f282de5704248f948bc',
    );
    expect(hash(readFileSync('src/rendering/geometry.ts'))).toBe(
      'c120aa6b3b8ad80f6a600d77fc3717c4638f89c3ab4bc36fea520345ebfacd26',
    );
  });
  it('reverses opaque rows byte-for-byte without mutating input or reversing columns', () => {
    const data = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]),
      before = data.slice();
    expect(reverseOpaqueStripeRows(data, 2, 2)).toEqual(
      new Uint8Array([7, 8, 9, 255, 10, 11, 12, 255, 1, 2, 3, 255, 4, 5, 6, 255]),
    );
    expect(data).toEqual(before);
    const clamped = new Uint8ClampedArray(data);
    expect(reverseOpaqueStripeRows(clamped, 2, 2)).toEqual(reverseOpaqueStripeRows(data, 2, 2));
    for (const [w, h] of [
      [0, 2],
      [-1, 2],
      [2.5, 2],
      [2, NaN],
      [Infinity, 2],
      [1e10, 1e10],
    ])
      expect(() => reverseOpaqueStripeRows(data, w, h)).toThrow();
    expect(() => reverseOpaqueStripeRows(data.slice(1), 2, 2)).toThrow();
    const transparent = data.slice();
    transparent[3] = 254;
    expect(() => reverseOpaqueStripeRows(transparent, 2, 2)).toThrow();
  });
  it('uses actual original checker commands, geometry, material and Float32 world placement with exact opaque row mapping', async () => {
    const opts = options(),
      canvas = canvasDocument(),
      reference = original(opts.track);
    let uploaded: Uint8Array | undefined;
    const owner = await createBabylonStartFinishStripe(opts, {
      ...dependencies,
      allocateTexture: (data, w, h, scene) => {
        uploaded = data.slice();
        return allocateTexture(data, w, h, scene);
      },
    });
    try {
      const d = owner.diagnostics(),
        source = reference.mesh;
      expect(canvas.records).toHaveLength(2);
      expect(canvas.records[1].commands).toEqual(canvas.records[0].commands);
      expect(
        canvas.records[0].commands.filter((command) => command[0] === 'fillRect'),
      ).toHaveLength(32);
      expect(canvas.records[1].canvas.width).toBe(128);
      expect(canvas.records[1].canvas.height).toBe(32);
      expect(canvas.records[1].reads).toContainEqual([0, 0, 128, 32]);
      const input = canvas.records[0].canvas.getContext('2d')!.getImageData(0, 0, 128, 32).data;
      const expected = new Uint8Array(128 * 32 * 4);
      for (let y = 0; y < 32; y++)
        expected.set(input.subarray(y * 512, (y + 1) * 512), (31 - y) * 512);
      // Independent expected pixels: the actual original integer checker cells.
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 128; x++) {
          const color =
            (Math.floor(x / 8) + Math.floor(y / 16)) % 2 ? [232, 229, 218, 255] : [36, 43, 41, 255];
          expect(Array.from(input.subarray((y * 128 + x) * 4, (y * 128 + x) * 4 + 4))).toEqual(
            color,
          );
        }
      expect(uploaded).toBeDefined();
      expect(hash(uploaded!)).toBe(hash(expected));
      for (const [native, legacy] of [
        ['position', 'position'],
        ['normal', 'normal'],
        ['uv', 'uv'],
      ] as const)
        expect(Array.from(d.mesh.getVerticesData(native)!)).toEqual(
          Array.from(source.geometry.getAttribute(legacy).array),
        );
      expect(Array.from(d.mesh.getIndices()!)).toEqual(Array.from(source.geometry.index!.array));
      expect(Array.from(d.mesh.computeWorldMatrix(true).asArray())).toEqual(
        Array.from(new Float32Array(source.matrixWorld.elements)),
      );
      expect(d.mesh.computeWorldMatrix(true).isIdentity()).toBe(true);
      const expectedY = Math.fround(opts.track.at(0, trackPoint()).y + 0.015);
      const nativePositions = d.mesh.getVerticesData('position')!;
      for (let index = 1; index < nativePositions.length; index += 3)
        expect(nativePositions[index]).toBe(expectedY);
      expect(source.material.polygonOffset).toBe(false);
      expect(d.material.zOffset).toBe(0);
      expect(d.material.zOffsetUnits).toBe(0);
      const sourceMap = source.material.map!;
      expect(sourceMap.wrapS).toBe(T.ClampToEdgeWrapping);
      expect(sourceMap.wrapT).toBe(T.ClampToEdgeWrapping);
      expect(sourceMap.minFilter).toBe(T.LinearMipmapLinearFilter);
      expect(sourceMap.magFilter).toBe(T.LinearFilter);
      expect(sourceMap.generateMipmaps).toBe(true);
      expect(sourceMap.anisotropy).toBe(8);
      expect(sourceMap.colorSpace).toBe(T.SRGBColorSpace);
      expect(d.texture.wrapU).toBe(Texture.CLAMP_ADDRESSMODE);
      expect(d.texture.wrapV).toBe(Texture.CLAMP_ADDRESSMODE);
      expect(d.texture.samplingMode).toBe(Texture.TRILINEAR_SAMPLINGMODE);
      expect(d.texture.anisotropicFilteringLevel).toBe(sourceMap.anisotropy);
      expect(d.texture.getInternalTexture()!.generateMipMaps).toBe(true);
      expect(d.material.albedoColor.asArray()).toEqual(source.material.color.toArray());
      expect(d.material.roughness).toBe(source.material.roughness);
      expect(d.material.metallic).toBe(source.material.metalness);
      expect(d.material.backFaceCulling).toBe(true);
      expect(d.material.albedoTexture).toBe(d.texture);
      expect(d.texture.gammaSpace).toBe(false);
      expect(d.texture.getInternalTexture()!._useSRGBBuffer).toBe(true);
      expect(opts.scene.meshes).not.toContain(d.mesh);
      expect(opts.scene.lights).toHaveLength(0);
      expect(opts.scene.environmentTexture).toBeNull();
    } finally {
      owner.dispose();
      reference.dispose();
    }
  });
  it('preserves the original CCW front-face convention through actual native material prebind', async () => {
    const opts = options(),
      reference = original(opts.track);
    const owner = await createBabylonStartFinishStripe(opts, dependencies);
    try {
      const source = reference.mesh,
        { mesh: target, material } = owner.diagnostics();
      // Original post-batch triangles point upward; above/below signed facing
      // and native prebind are CPU contracts, not raster/pixel proof.
      const position = source.geometry.getAttribute('position');
      const indices = source.geometry.index!;
      for (let i = 0; i < indices.count; i += 3) {
        const a = new T.Vector3().fromBufferAttribute(position, indices.getX(i));
        const b = new T.Vector3().fromBufferAttribute(position, indices.getX(i + 1));
        const c = new T.Vector3().fromBufferAttribute(position, indices.getX(i + 2));
        const normal = b.clone().sub(a).cross(c.clone().sub(a));
        expect(normal.y).toBeGreaterThan(0);
        const center = a
          .clone()
          .add(b)
          .add(c)
          .multiplyScalar(1 / 3);
        expect(
          normal.dot(
            center
              .clone()
              .add(new T.Vector3(0, 1, 0))
              .sub(center),
          ),
        ).toBeGreaterThan(0);
        expect(
          normal.dot(
            center
              .clone()
              .add(new T.Vector3(0, -1, 0))
              .sub(center),
          ),
        ).toBeLessThan(0);
      }
      expect(source.matrixWorld.determinant()).toBeGreaterThan(0);
      expect(source.material.side).toBe(T.FrontSide);
      const threeRenderer = readFileSync(
        'node_modules/three/src/renderers/WebGLRenderer.js',
        'utf8',
      );
      const threeState = readFileSync(
        'node_modules/three/src/renderers/webgl/WebGLState.js',
        'utf8',
      );
      expect(threeRenderer).toContain('object.matrixWorld.determinant() < 0');
      expect(threeState).toContain('let flipSided = ( material.side === BackSide );');
      expect(threeState).toContain('if ( frontFaceCW ) flipSided = ! flipSided;');
      expect(threeState).toContain('gl.frontFace( gl.CCW );');
      const nativeState = readFileSync(
        'node_modules/@babylonjs/core/Engines/thinEngine.pure.js',
        'utf8',
      );
      expect(nativeState).toContain('const frontFace = reverseSide ? this._gl.CW : this._gl.CCW;');
      const engine = opts.scene.getEngine();
      vi.spyOn(engine, 'enableEffect').mockImplementation(() => {});
      const state = vi.spyOn(engine, 'setState');
      // Execute native effective-orientation and prebind, not a reimplementation.
      const reversed = material._preBind(undefined, material._getEffectiveOrientation(target));
      expect(reversed).toBe(false);
      expect(state.mock.calls.at(-1)?.[3]).toBe(false);
      expect(target.sideOrientation).toBe(Material.CounterClockWiseSideOrientation);
      expect(material.backFaceCulling).toBe(true);
      expect(material.twoSidedLighting).toBe(false);
      expect(state.mock.calls.at(-1)?.[0]).toBe(true);
      expect(state.mock.calls.at(-1)?.[4]).toBe(true);
    } finally {
      owner.dispose();
      reference.dispose();
    }
  });
  it('owns native texture and geometry uploads inside the GPU lane and prepares only off-scene', async () => {
    const opts = options();
    let inLane = false;
    opts.gpu = {
      prepare: async (
        _label: string,
        _deadline: number,
        work: (signal: AbortSignal) => Promise<unknown>,
      ) => {
        inLane = true;
        try {
          return await work(new AbortController().signal);
        } finally {
          inLane = false;
        }
      },
    } as unknown as typeof opts.gpu;
    const apply = VertexData.prototype.applyToMesh;
    const upload = vi.spyOn(VertexData.prototype, 'applyToMesh').mockImplementation(function (
      this: VertexData,
      ...args
    ) {
      expect(inLane).toBe(true);
      return apply.apply(this, args);
    });
    const prepare = vi.fn(
      async (
        container: Parameters<
          NonNullable<NonNullable<Parameters<typeof createBabylonStartFinishStripe>[1]>['prepare']>
        >[0],
      ) => {
        expect(container.meshes).toHaveLength(1);
        expect(opts.scene.meshes).not.toContain(container.meshes[0]);
      },
    );
    const owner = await createBabylonStartFinishStripe(opts, {
      ...dependencies,
      allocateTexture: (...args) => {
        expect(inLane).toBe(true);
        return allocateTexture(...args);
      },
      prepare,
    });
    expect(upload).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledOnce();
    owner.dispose();
  });
  it('rejects unsupported sRGB capability or falsely advertised allocations without silently falling back', async () => {
    const opts = options(),
      allocate = vi.fn(allocateTexture);
    opts.scene.getEngine().getCaps().supportSRGBBuffers = false;
    await expect(
      createBabylonStartFinishStripe(opts, { ...dependencies, allocateTexture: allocate }),
    ).rejects.toThrow('sRGB');
    expect(allocate).not.toHaveBeenCalled();
    opts.scene.getEngine().getCaps().supportSRGBBuffers = true;
    let disposed = false;
    await expect(
      createBabylonStartFinishStripe(opts, {
        ...dependencies,
        allocateTexture: (...args) => {
          const texture = allocateTexture(...args);
          texture.getInternalTexture()!._useSRGBBuffer = false;
          texture.onDisposeObservable.add(() => {
            disposed = true;
          });
          return texture;
        },
      }),
    ).rejects.toThrow();
    expect(disposed).toBe(true);
    expect(opts.scene.meshes).toHaveLength(0);
  });
  it('fails exact-byte opaque validation before any native allocation', async () => {
    const opts = options();
    const canvas = canvasDocument(),
      allocate = vi.fn(allocateTexture);
    const create = canvas.createElement.getMockImplementation()!;
    canvas.createElement.mockImplementation((tag: string) => {
      const result = create(tag);
      const ctx = result.getContext('2d')!;
      vi.spyOn(ctx, 'getImageData').mockImplementation(() => ({
        data: new Uint8ClampedArray(128 * 32 * 4),
        width: 128,
        height: 32,
        colorSpace: 'srgb',
      }));
      return result;
    });
    await expect(
      createBabylonStartFinishStripe(opts, { ...dependencies, allocateTexture: allocate }),
    ).rejects.toThrow('opaque');
    expect(allocate).not.toHaveBeenCalled();
  });
  it('restricts canonical Aurel Formula and current right-handed scene ownership', async () => {
    const opts = options(),
      allocate = vi.fn(allocateTexture);
    for (const track of [
      new Track('clear', false, undefined, VELLAMAR),
      new Track('clear', false, undefined, { ...AUREL }),
    ])
      await expect(
        createBabylonStartFinishStripe(
          { ...opts, track },
          { ...dependencies, allocateTexture: allocate },
        ),
      ).rejects.toThrow();
    await expect(
      createBabylonStartFinishStripe(
        { ...opts, context: { ...context, vehicles: [] } },
        { ...dependencies, allocateTexture: allocate },
      ),
    ).rejects.toThrow();
    await expect(
      createBabylonStartFinishStripe(
        { ...opts, isCurrent: () => false },
        { ...dependencies, allocateTexture: allocate },
      ),
    ).rejects.toThrow();
    opts.scene.useRightHandedSystem = false;
    await expect(
      createBabylonStartFinishStripe(opts, { ...dependencies, allocateTexture: allocate }),
    ).rejects.toThrow();
    opts.scene.dispose();
    await expect(
      createBabylonStartFinishStripe(opts, { ...dependencies, allocateTexture: allocate }),
    ).rejects.toThrow();
    expect(allocate).not.toHaveBeenCalled();
  });
  it('reports actual staged/installed membership and removes the stripe without touching unrelated resources', async () => {
    const opts = options(),
      owner = await createBabylonStartFinishStripe(opts, dependencies),
      d = owner.diagnostics();
    const unrelatedMesh = new Mesh('unrelated existing environment', opts.scene);
    const unrelatedMaterial = new PBRMaterial('unrelated existing material', opts.scene);
    unrelatedMesh.material = unrelatedMaterial;
    const unrelatedDisposal = vi.spyOn(unrelatedMaterial, 'dispose');
    const counts = () => {
      const a = owner.diagnostics();
      return [a.stagedParts, a.activeParts, a.activeMaterials, a.activeTextures];
    };
    expect(counts()).toEqual([1, 0, 0, 0]);
    await owner.install();
    expect(counts()).toEqual([0, 1, 1, 1]);
    await expect(owner.install()).rejects.toThrow();
    opts.scene.removeMesh(d.mesh);
    expect(counts()).toEqual([0, 0, 0, 0]);
    const release = vi.spyOn(d.texture, 'dispose');
    owner.dispose();
    owner.dispose();
    expect(release).toHaveBeenCalledOnce();
    expect(d.mesh.isDisposed()).toBe(true);
    expect(unrelatedMesh.isDisposed()).toBe(false);
    expect(unrelatedDisposal).not.toHaveBeenCalled();
    expect(opts.scene.meshes).toContain(unrelatedMesh);
    expect(owner.diagnostics().sourceCanvas).toBeUndefined();
    expect(d.sourceCanvas?.width).toBe(128);
    expect(d.sourceCanvas?.height).toBe(32);
    expect(counts()).toEqual([0, 0, 0, 0]);
  });
  it('does not publish before GPU preparation drains on cancellation', async () => {
    const controller = new AbortController(),
      opts = options(controller),
      entered = deferred(),
      drain = deferred();
    let captured:
      | Parameters<
          NonNullable<NonNullable<Parameters<typeof createBabylonStartFinishStripe>[1]>['prepare']>
        >[0]
      | undefined;
    const pending = createBabylonStartFinishStripe(opts, {
        ...dependencies,
        prepare: async (container) => {
          captured = container;
          entered.resolve();
          await drain.promise;
        },
      }),
      failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await entered.promise;
    const mesh = captured!.meshes[0],
      texture = (
        mesh.material as import('@babylonjs/core/Materials/PBR/pbrMaterial.js').PBRMaterial
      ).albedoTexture!,
      dispose = vi.spyOn(texture, 'dispose');
    controller.abort();
    expect(mesh.isDisposed()).toBe(false);
    expect(dispose).not.toHaveBeenCalled();
    expect(opts.scene.meshes).toHaveLength(0);
    drain.resolve();
    await failure;
    expect(mesh.isDisposed()).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
  });
  it('rejects cancellation before allocation and stale/cancelled installation with automatic cleanup', async () => {
    const controller = new AbortController(),
      opts = options(controller);
    controller.abort();
    const allocate = vi.fn(allocateTexture);
    await expect(
      createBabylonStartFinishStripe(opts, { ...dependencies, allocateTexture: allocate }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(allocate).not.toHaveBeenCalled();
    const next = new AbortController(),
      activeOpts = options(next);
    let current = true;
    const owner = await createBabylonStartFinishStripe(
        { ...activeOpts, isCurrent: () => current },
        dependencies,
      ),
      d = owner.diagnostics();
    current = false;
    await expect(owner.install()).rejects.toThrow();
    expect(d.mesh.isDisposed()).toBe(true);
    const cancelled = await createBabylonStartFinishStripe(activeOpts, dependencies),
      other = cancelled.diagnostics();
    next.abort();
    await expect(cancelled.install()).rejects.toThrow();
    expect(other.mesh.isDisposed()).toBe(true);
  });
  it('keeps installation pending through presentation and rejects duplicate calls without destroying ownership', async () => {
    const opts = options(),
      entered = deferred(),
      drain = deferred(),
      owner = await createBabylonStartFinishStripe(opts, {
        ...dependencies,
        present: async () => {
          entered.resolve();
          await drain.promise;
        },
      });
    const pending = owner.install();
    await entered.promise;
    expect(owner.diagnostics().state).toBe('installing');
    await expect(owner.install()).rejects.toThrow();
    expect(owner.diagnostics().mesh.isDisposed()).toBe(false);
    drain.resolve();
    await pending;
    expect(owner.diagnostics().state).toBe('ready');
    owner.dispose();
  });
  it('drains off-scene resources despite skipped scene disposal callbacks', async () => {
    const opts = options();
    opts.scene.onDisposeObservable.add((_scene, event) => {
      event.skipNextObservers = true;
    });
    const owner = await createBabylonStartFinishStripe(opts, dependencies),
      d = owner.diagnostics(),
      release = vi.spyOn(d.texture, 'dispose'),
      materialRelease = vi.spyOn(d.material, 'dispose');
    opts.scene.dispose();
    owner.dispose();
    expect(d.mesh.isDisposed()).toBe(true);
    expect(release).toHaveBeenCalled();
    expect(materialRelease).toHaveBeenCalled();
    expect(owner.diagnostics().activeTextures).toBe(0);
  });
  it.each([undefined, null])(
    'preserves falsy cleanup error %s while draining independent texture ownership',
    async (failure) => {
      const opts = options(),
        owner = await createBabylonStartFinishStripe(opts, dependencies),
        d = owner.diagnostics(),
        release = vi.spyOn(d.texture, 'dispose');
      await owner.install();
      vi.spyOn(d.material, 'dispose').mockImplementation(() => {
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
      expect(d.mesh.isDisposed()).toBe(true);
      expect(release).toHaveBeenCalledOnce();
      expect(owner.diagnostics().activeParts).toBe(0);
    },
  );
  it('preserves primary preparation failure and releases texture even when material cleanup throws', async () => {
    const opts = options(),
      primary = new Error('stripe prepare sentinel');
    let released = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      createBabylonStartFinishStripe(opts, {
        ...dependencies,
        allocateTexture: (...args) => {
          const texture = allocateTexture(...args);
          texture.onDisposeObservable.add(() => {
            released = true;
          });
          return texture;
        },
        prepare: async (container) => {
          vi.spyOn(container.meshes[0].material!, 'dispose').mockImplementation(() => {
            throw undefined;
          });
          throw primary;
        },
      }),
    ).rejects.toBe(primary);
    expect(released).toBe(true);
    expect(opts.scene.meshes).toHaveLength(0);
  });

  it('drains texture, material and partially uploaded geometry after construction failure', async () => {
    const opts = options(),
      failure = new Error('stripe geometry sentinel');
    let texture: RawTexture | undefined,
      uploadedMesh: import('@babylonjs/core/Meshes/mesh.js').Mesh | undefined,
      geometry: import('@babylonjs/core/Meshes/geometry.js').Geometry | undefined;
    let released = false;
    let materialRelease: ReturnType<typeof vi.spyOn> | undefined;
    const apply = VertexData.prototype.applyToMesh;
    vi.spyOn(VertexData.prototype, 'applyToMesh').mockImplementation(function (
      this: VertexData,
      ...args
    ) {
      uploadedMesh = args[0];
      materialRelease = vi.spyOn(uploadedMesh.material!, 'dispose');
      apply.apply(this, args);
      geometry = uploadedMesh.geometry!;
      throw failure;
    });
    const prepare = vi.fn(async () => {});
    await expect(
      createBabylonStartFinishStripe(opts, {
        ...dependencies,
        allocateTexture: (...args) => {
          texture = allocateTexture(...args);
          texture.onDisposeObservable.add(() => {
            released = true;
          });
          return texture;
        },
        prepare,
      }),
    ).rejects.toBe(failure);
    expect(texture).toBeDefined();
    expect(released).toBe(true);
    expect(materialRelease).toHaveBeenCalledOnce();
    expect(uploadedMesh?.isDisposed()).toBe(true);
    expect(geometry?.isDisposed()).toBe(true);
    expect(opts.scene.meshes).toHaveLength(0);
    expect(prepare).not.toHaveBeenCalled();
  });
  it('keeps ordinary queued cancellation outside the GPU failure path', async () => {
    const controller = new AbortController(),
      opts = options(controller),
      entered = deferred(),
      run = deferred();
    let rejected = false;
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
          rejected = true;
          throw error;
        }
      },
    } as unknown as typeof opts.gpu;
    const allocate = vi.fn(allocateTexture),
      pending = createBabylonStartFinishStripe(opts, {
        ...dependencies,
        allocateTexture: allocate,
      }),
      failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await entered.promise;
    controller.abort();
    run.resolve();
    await failure;
    expect(rejected).toBe(false);
    expect(allocate).not.toHaveBeenCalled();
    expect(opts.scene.meshes).toHaveLength(0);
  });

  it.each([undefined, null])(
    'retains falsy raw texture disposal failure %s while draining geometry/material ownership',
    async (failure) => {
      const opts = options(),
        owner = await createBabylonStartFinishStripe(opts, dependencies),
        d = owner.diagnostics(),
        geometry = d.mesh.geometry!,
        materialRelease = vi.spyOn(d.material, 'dispose');
      await owner.install();
      vi.spyOn(d.texture, 'dispose').mockImplementation(() => {
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
      expect(d.mesh.isDisposed()).toBe(true);
      expect(geometry.isDisposed()).toBe(true);
      expect(materialRelease).toHaveBeenCalledOnce();
      expect(owner.diagnostics().activeParts).toBe(0);
    },
  );

  it('reports only the owned material/texture bindings actually attached to the visible stripe', async () => {
    const opts = options(),
      owner = await createBabylonStartFinishStripe(opts, dependencies);
    await owner.install();
    const d = owner.diagnostics();
    const replacement = new PBRMaterial('unrelated replacement', opts.scene),
      otherTexture = allocateTexture(new Uint8Array([10, 20, 30, 255]), 1, 1, opts.scene),
      release = vi.spyOn(otherTexture, 'dispose');
    d.mesh.material = replacement;
    let current = owner.diagnostics();
    expect([current.activeParts, current.activeMaterials, current.activeTextures]).toEqual([
      1, 0, 0,
    ]);
    d.mesh.material = d.material;
    d.material.albedoTexture = otherTexture;
    current = owner.diagnostics();
    expect([current.activeParts, current.activeMaterials, current.activeTextures]).toEqual([
      1, 1, 0,
    ]);
    d.material.albedoTexture = d.texture;
    opts.scene.removeMaterial(d.material);
    current = owner.diagnostics();
    expect([current.activeParts, current.activeMaterials, current.activeTextures]).toEqual([
      1, 0, 0,
    ]);
    opts.scene.addMaterial(d.material);
    d.material.albedoTexture = otherTexture;
    owner.dispose();
    expect(release).not.toHaveBeenCalled();
    expect(opts.scene.materials).toContain(replacement);
  });
});
