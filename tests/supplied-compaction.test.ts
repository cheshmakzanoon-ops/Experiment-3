import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { CompactIndexBuffers } from '../src/rendering/compact-index-buffer.ts';
import { SuppliedDrawRanges } from '../src/rendering/supplied-draw-ranges.ts';

function context() {
  const canvas = new EventTarget();
  let bound: WebGLBuffer | null = { external: true } as WebGLBuffer;
  let element: WebGLBuffer | null = { externalElement: true } as WebGLBuffer;
  let lost = false;
  const data = new Map<WebGLBuffer, Uint32Array>();
  const types = new Map<WebGLBuffer, 'element' | 'other'>([
    [bound, 'other'],
    [element, 'element'],
  ]);
  const gl = {
    canvas,
    ELEMENT_ARRAY_BUFFER: 34963,
    ELEMENT_ARRAY_BUFFER_BINDING: 34965,
    COPY_WRITE_BUFFER: 36663,
    COPY_WRITE_BUFFER_BINDING: 36663,
    BUFFER_SIZE: 34660,
    DYNAMIC_DRAW: 35048,
    UNSIGNED_INT: 5125,
    isContextLost: () => lost,
    getParameter: vi.fn((target: number) => (target === 34965 ? element : bound)),
    getBufferParameter: vi.fn(() => data.get(bound!)?.byteLength ?? 0),
    createBuffer: vi.fn(() => ({}) as WebGLBuffer),
    bindBuffer: vi.fn((target: number, buffer: WebGLBuffer | null) => {
      if (buffer) {
        const type = types.get(buffer);
        if (target === 34963 && type === 'other')
          throw new Error('INVALID_OPERATION: other data cannot become an element buffer');
        if (!type) types.set(buffer, target === 34963 ? 'element' : 'other');
      }
      if (target === 34963) element = buffer;
      else bound = buffer;
    }),
    bufferData: vi.fn((_target: number, bytes: number) => {
      data.set(bound!, new Uint32Array(bytes / 4));
    }),
    bufferSubData: vi.fn(
      (_target: number, _offset: number, values: Uint32Array, start: number, count: number) => {
        data.get(bound!)!.set(values.subarray(start, start + count));
      },
    ),
    deleteBuffer: vi.fn((buffer: WebGLBuffer) => data.delete(buffer)),
  };
  return {
    gl: gl as unknown as WebGL2RenderingContext,
    calls: gl,
    data,
    binding: () => bound,
    elementBinding: () => element,
    lose: (dispatch = true) => {
      lost = true;
      data.clear();
      if (dispatch) canvas.dispatchEvent(new Event('webglcontextlost'));
    },
    restore: () => {
      lost = false;
      canvas.dispatchEvent(new Event('webglcontextrestored'));
    },
  };
}
function fixture() {
  const c = context(),
    geometry = new T.BufferGeometry(),
    points: number[] = [],
    indices: number[] = [];
  for (const z of [-4, 4, -5, 4, -6])
    for (let i = 0; i < 128; i++) {
      const n = points.length / 3;
      points.push(-0.2, -0.2, z, 0.2, -0.2, z, 0, 0.2, z);
      indices.push(n, n + 1, n + 2);
    }
  geometry.setAttribute('position', new T.Float32BufferAttribute(points, 3));
  geometry.setIndex(indices);
  const material = new T.MeshStandardMaterial({ transparent: true, side: T.DoubleSide });
  const mesh = new T.Mesh(geometry, material),
    camera = new T.PerspectiveCamera(60, 1, 0.01, 100);
  mesh.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const renderer = { getContext: () => c.gl } as unknown as T.WebGLRenderer,
    scene = new T.Scene();
  scene.add(mesh);
  const ranges = new SuppliedDrawRanges([{ mesh, geometries: [geometry] }], true);
  const before = () =>
    mesh.onBeforeRender(renderer, scene, camera, geometry, material, null as unknown as T.Group);
  const after = () =>
    mesh.onAfterRender(renderer, scene, camera, geometry, material, null as unknown as T.Group);
  return { ...c, geometry, material, mesh, camera, renderer, scene, ranges, before, after };
}

describe('exact ordered supplied index compaction', () => {
  it('removes invisible interior blocks, preserves source indices, winding and transparent order', () => {
    const f = fixture(),
      index = f.geometry.index!,
      original = index.array.slice(),
      position = f.geometry.attributes.position;
    const binding = f.binding(),
      element = f.elementBinding();
    f.before();
    expect(f.geometry.drawRange).toEqual({ start: 0, count: 384 * 3 });
    const attr = f.geometry.index as unknown as T.GLBufferAttribute;
    expect(attr.isGLBufferAttribute).toBe(true);
    const selected = f.data.get(attr.buffer)!.slice(0, 384 * 3);
    expect([...selected]).toEqual([
      ...original.slice(0, 384),
      ...original.slice(768, 1152),
      ...original.slice(1536),
    ]);
    expect(index.array).toEqual(original);
    expect(f.geometry.attributes.position).toBe(position);
    expect(f.material.transparent).toBe(true);
    expect(f.material.side).toBe(T.DoubleSide);
    expect(f.binding()).toBe(binding);
    expect(f.elementBinding()).toBe(element);
    expect(f.calls.bindBuffer.mock.calls.slice(0, 2)).toEqual([
      [f.gl.ELEMENT_ARRAY_BUFFER, attr.buffer],
      [f.gl.ELEMENT_ARRAY_BUFFER, element],
    ]);
    expect(
      f.calls.bindBuffer.mock.calls.slice(2).every((call) => call[0] === f.gl.COPY_WRITE_BUFFER),
    ).toBe(true);
    f.after();
    expect(f.geometry.index).toBe(index);
    expect(f.geometry.drawRange).toEqual({ start: 0, count: Infinity });
    expect(f.ranges.diagnostics().omittedTriangles).toBe(256);
    f.ranges.dispose();
    expect(f.calls.deleteBuffer).toHaveBeenCalledTimes(1);
  });
  it('reuses held selections without uploads, then updates for each actual camera', () => {
    const f = fixture();
    f.before();
    f.after();
    f.before();
    f.after();
    expect(f.calls.createBuffer).toHaveBeenCalledTimes(1);
    expect(f.calls.bufferSubData).toHaveBeenCalledTimes(1);
    f.camera.lookAt(0, 0, 5);
    f.camera.updateMatrixWorld(true);
    f.before();
    expect(f.geometry.drawRange.count).toBe(384 * 2);
    f.after();
    expect(f.calls.bufferSubData).toHaveBeenCalledTimes(2);
    f.camera.lookAt(0, 0, -5);
    f.camera.updateMatrixWorld(true);
    f.before();
    f.after();
    expect(f.calls.bufferSubData).toHaveBeenCalledTimes(3);
    expect(f.calls.createBuffer).toHaveBeenCalledTimes(1);
    f.ranges.dispose();
  });
  it('keeps a separate selection per camera, so alternating passes do not re-upload', () => {
    const f = fixture();
    // A second view (e.g. a mirror) that sees a different set of blocks.
    const other = new T.PerspectiveCamera(60, 1, 0.01, 100);
    other.lookAt(0, 0, 5);
    other.updateMatrixWorld(true);
    const pass = (camera: T.Camera) => {
      f.mesh.onBeforeRender(
        f.renderer,
        f.scene,
        camera,
        f.geometry,
        f.material,
        null as unknown as T.Group,
      );
      f.mesh.onAfterRender(
        f.renderer,
        f.scene,
        camera,
        f.geometry,
        f.material,
        null as unknown as T.Group,
      );
    };
    for (let frame = 0; frame < 4; frame++) {
      pass(f.camera);
      pass(other);
    }
    // One upload per camera, not one per pass.
    expect(f.calls.bufferSubData).toHaveBeenCalledTimes(2);
    expect(f.calls.createBuffer).toHaveBeenCalledTimes(2);
    f.ranges.dispose();
    expect(f.calls.deleteBuffer).toHaveBeenCalledTimes(2);
  });
  it('restores the source even when disposal interrupts a draw, and removes each buffer once', () => {
    const f = fixture(),
      index = f.geometry.index,
      dispose = vi.spyOn(f.geometry, 'dispose');
    f.before();
    f.ranges.dispose();
    f.ranges.dispose();
    expect(f.geometry.index).toBe(index);
    expect(f.geometry.drawRange.count).toBe(Infinity);
    expect(dispose).not.toHaveBeenCalled();
    expect(f.calls.deleteBuffer).toHaveBeenCalledTimes(1);
    expect(f.ranges.diagnostics().compacted.buffers).toBe(0);
  });
  it('keeps the independent prefix/suffix baseline and invalidated geometry unchanged', () => {
    for (const mode of ['baseline', 'version', 'range', 'displacement'] as const) {
      const f = fixture(),
        index = f.geometry.index;
      if (mode === 'baseline') f.ranges.compact = false;
      if (mode === 'version') f.geometry.attributes.position.needsUpdate = true;
      if (mode === 'range') f.geometry.setDrawRange(3, 99);
      if (mode === 'displacement') f.material.displacementMap = new T.Texture();
      const range = { ...f.geometry.drawRange };
      f.before();
      expect(f.geometry.index).toBe(index);
      expect(f.geometry.drawRange).toEqual(range);
      expect(f.calls.createBuffer).not.toHaveBeenCalled();
      f.after();
      f.ranges.dispose();
    }
  });
  it('falls back to the existing range when a buffer cannot be allocated', () => {
    const f = fixture(),
      index = f.geometry.index;
    f.calls.createBuffer.mockReturnValueOnce(null as unknown as WebGLBuffer);
    f.before();
    expect(f.geometry.index).toBe(index);
    expect(f.geometry.drawRange.count).toBe(Infinity);
    f.after();
    f.before();
    expect(f.geometry.index).not.toBe(index);
    f.after();
    f.ranges.dispose();
  });
});

describe('compacted GPU buffer ownership', () => {
  it('establishes the element type before copy uploads and keeps both external bindings', () => {
    const c = context(),
      pool = new CompactIndexBuffers(),
      key = {};
    const copy = c.binding(),
      element = c.elementBinding();
    const attr = pool.get(
      c.gl,
      key,
      new Uint32Array([0, 1, 2]),
      3,
      1,
    ) as unknown as T.GLBufferAttribute;
    expect(c.binding()).toBe(copy);
    expect(c.elementBinding()).toBe(element);
    // Model the real indexed draw: this would throw for a COPY-first buffer.
    expect(() => c.gl.bindBuffer(c.gl.ELEMENT_ARRAY_BUFFER, attr.buffer)).not.toThrow();
    c.gl.bindBuffer(c.gl.ELEMENT_ARRAY_BUFFER, element);
    const calls = c.calls.bindBuffer.mock.calls.length;
    pool.get(c.gl, key, new Uint32Array([2, 1, 0]), 3, 2);
    expect(
      c.calls.bindBuffer.mock.calls
        .slice(calls)
        .every(([target]) => target === c.gl.COPY_WRITE_BUFFER),
    ).toBe(true);
    expect(c.binding()).toBe(copy);
    expect(c.elementBinding()).toBe(element);
    pool.dispose();
  });
  it('rejects the former COPY-first initialization in the state model', () => {
    const c = context(),
      buffer = c.gl.createBuffer();
    c.gl.bindBuffer(c.gl.COPY_WRITE_BUFFER, buffer);
    expect(() => c.gl.bindBuffer(c.gl.ELEMENT_ARRAY_BUFFER, buffer)).toThrow('INVALID_OPERATION');
  });
  it('separates contexts and keys while retaining one buffer per stream', () => {
    const pool = new CompactIndexBuffers(),
      a = context(),
      b = context(),
      key = {},
      values = new Uint32Array([3, 2, 1]);
    const one = pool.get(a.gl, key, values, 3, 1);
    expect(pool.get(a.gl, key, values, 3, 1)).toBe(one);
    expect(pool.get(b.gl, key, values, 3, 1)).not.toBe(one);
    expect(pool.get(a.gl, {}, values, 3, 1)).not.toBe(one);
    expect(pool.diagnostics()).toMatchObject({ buffers: 3, uploads: 3, uploadedBytes: 36 });
    pool.dispose();
    expect(a.calls.deleteBuffer).toHaveBeenCalledTimes(2);
    expect(b.calls.deleteBuffer).toHaveBeenCalledTimes(1);
  });
  it('invalidates lost handles and uploads an unchanged selection after restoration', () => {
    const pool = new CompactIndexBuffers(),
      c = context(),
      key = {},
      values = new Uint32Array([3, 2, 1]);
    const before = pool.get(c.gl, key, values, 3, 1);
    c.lose();
    expect(pool.get(c.gl, key, values, 3, 1)).toBeNull();
    expect(pool.diagnostics().buffers).toBe(0);
    c.restore();
    expect(pool.get(c.gl, key, values, 3, 1)).not.toBe(before);
    expect(c.calls.createBuffer).toHaveBeenCalledTimes(2);
    expect(c.calls.bufferSubData).toHaveBeenCalledTimes(2);
    pool.dispose();
    expect(c.calls.deleteBuffer).toHaveBeenCalledTimes(1);
    expect(pool.get(c.gl, key, values, 3, 2)).toBeNull();
  });
  it('restores external binding and deletes a failed allocation without publishing it', () => {
    const pool = new CompactIndexBuffers(),
      c = context(),
      previous = c.binding(),
      previousElement = c.elementBinding();
    c.calls.getBufferParameter.mockReturnValueOnce(0);
    expect(() => pool.get(c.gl, {}, new Uint32Array([1, 2, 3]), 3, 1)).toThrow(
      'Unable to allocate',
    );
    expect(c.binding()).toBe(previous);
    expect(c.elementBinding()).toBe(previousElement);
    expect(c.calls.deleteBuffer).toHaveBeenCalledTimes(1);
    expect(pool.diagnostics().buffers).toBe(0);
    pool.dispose();
  });
  it('does not misclassify loss during the allocation query as a healthy allocation failure', () => {
    const pool = new CompactIndexBuffers(),
      c = context(),
      key = {},
      values = new Uint32Array([1, 2, 3]);
    c.calls.getBufferParameter.mockImplementationOnce(() => {
      // The loss event may be queued while this synchronous query is returning.
      c.lose(false);
      return 0;
    });
    expect(pool.get(c.gl, key, values, 3, 1)).toBeNull();
    expect(c.calls.bufferSubData).not.toHaveBeenCalled();
    expect(c.calls.deleteBuffer).not.toHaveBeenCalled();
    expect(pool.diagnostics()).toEqual({ buffers: 0, uploads: 0, uploadedBytes: 0 });
    c.restore();
    expect(pool.get(c.gl, key, values, 3, 1)).not.toBeNull();
    expect(c.calls.createBuffer).toHaveBeenCalledTimes(2);
    expect(c.calls.bufferSubData).toHaveBeenCalledTimes(1);
    expect(pool.diagnostics()).toEqual({ buffers: 1, uploads: 1, uploadedBytes: 12 });
    pool.dispose();
  });
  it('rejects invalid upload ranges before creating a buffer', () => {
    const pool = new CompactIndexBuffers(),
      c = context(),
      values = new Uint32Array([1, 2, 3]);
    expect(() => pool.get(c.gl, {}, values, 4, 1)).toThrow('Invalid compacted');
    expect(() => pool.get(c.gl, {}, values, 2.5, 1)).toThrow('Invalid compacted');
    expect(() => pool.get(c.gl, {}, values, 3, NaN)).toThrow('Invalid compacted');
    expect(c.calls.createBuffer).not.toHaveBeenCalled();
    pool.dispose();
  });
});

describe('owned preparation of exact upcoming index streams', () => {
  it('skips a current tiny LOD that the ordinary selector cannot compact', () => {
    const f = fixture(),
      tiny = new T.BoxGeometry();
    f.mesh.geometry = tiny;
    expect(f.ranges.prepareCamera(f.renderer, f.scene, f.camera)).toBe(true);
    expect(f.calls.createBuffer).not.toHaveBeenCalled();
    f.ranges.dispose();
    tiny.dispose();
  });
  it('does not claim prepared after a failed native buffer creation', () => {
    const f = fixture();
    f.calls.createBuffer.mockReturnValueOnce(null as unknown as WebGLBuffer);
    expect(f.ranges.prepareCamera(f.renderer, f.scene, f.camera)).toBe(false);
    expect(f.ranges.diagnostics().compacted.buffers).toBe(0);
    f.ranges.dispose();
  });
  const submit = (f: ReturnType<typeof fixture>, camera: T.Camera) => {
    f.mesh.onBeforeRender(
      f.renderer,
      f.scene,
      camera,
      f.geometry,
      f.material,
      null as unknown as T.Group,
    );
    const attribute = f.geometry.index as unknown as T.GLBufferAttribute;
    const bytes = attribute.isGLBufferAttribute
      ? [...f.data.get(attribute.buffer)!.slice(0, f.geometry.drawRange.count)]
      : [...f.geometry.index!.array];
    f.mesh.onAfterRender(
      f.renderer,
      f.scene,
      camera,
      f.geometry,
      f.material,
      null as unknown as T.Group,
    );
    return bytes;
  };
  it('matches ordered baseline bytes and exact buffers/uploads for main and mirror cameras', () => {
    const baseline = fixture(),
      prepared = fixture();
    const cameras = [
      prepared.camera,
      new T.PerspectiveCamera(60, 1, 0.01, 100),
      new T.PerspectiveCamera(60, 1, 0.01, 100),
    ];
    cameras[1].lookAt(0, 0, 5);
    cameras[2].lookAt(0.3, 0, -5);
    cameras.forEach((camera) => camera.updateMatrixWorld(true));
    const source = prepared.geometry.index!,
      sourceBytes = source.array.slice();
    const range = { ...prepared.geometry.drawRange },
      material = prepared.mesh.material;
    const expected = cameras.map((camera) => submit(baseline, camera));
    for (const camera of cameras)
      expect(prepared.ranges.prepareCamera(prepared.renderer, prepared.scene, camera)).toBe(true);
    expect(prepared.geometry.index).toBe(source);
    expect(prepared.geometry.drawRange).toEqual(range);
    expect(source.array).toEqual(sourceBytes);
    expect(prepared.mesh.material).toBe(material);
    expect(prepared.ranges.diagnostics().submissions).toBe(0);
    const before = prepared.ranges.diagnostics().compacted;
    const queries = prepared.calls.getBufferParameter.mock.calls.length;
    const bindingQueries = prepared.calls.getParameter.mock.calls.length;
    expect(cameras.map((camera) => submit(prepared, camera))).toEqual(expected);
    expect(prepared.ranges.diagnostics().compacted).toEqual(before);
    expect(prepared.calls.getBufferParameter).toHaveBeenCalledTimes(queries);
    expect(prepared.calls.getParameter).toHaveBeenCalledTimes(bindingQueries);
    expect(prepared.ranges.diagnostics()).toEqual(baseline.ranges.diagnostics());
    prepared.ranges.dispose();
    baseline.ranges.dispose();
  });
  it.each(['ancestor', 'layer', 'frustum', 'material', 'excluded'] as const)(
    'allocates no stream for %s-hidden bindings',
    (hidden) => {
      const f = fixture(),
        parent = new T.Group();
      f.scene.add(parent);
      parent.add(f.mesh);
      if (hidden === 'ancestor') parent.visible = false;
      if (hidden === 'layer') f.mesh.layers.set(2);
      if (hidden === 'frustum') {
        f.mesh.position.x = 1000;
        f.mesh.updateMatrixWorld(true);
      }
      if (hidden === 'material') f.material.visible = false;
      expect(
        f.ranges.prepareCamera(
          f.renderer,
          f.scene,
          f.camera,
          undefined,
          hidden === 'excluded' ? [parent] : [],
        ),
      ).toBe(true);
      expect(f.calls.createBuffer).not.toHaveBeenCalled();
      f.ranges.dispose();
    },
  );
  it.each([
    'override',
    'array',
    'groups',
    'displacement',
    'wireframe',
    'shader',
    'range',
    'version',
    'hook',
    'scene-hook',
    'auto-lod',
  ] as const)('declines unsupported %s before allocations', (unsupported) => {
    const f = fixture();
    if (unsupported === 'override') f.scene.overrideMaterial = new T.MeshBasicMaterial();
    if (unsupported === 'array')
      f.mesh.material = [f.material] as unknown as T.MeshStandardMaterial;
    if (unsupported === 'groups') f.geometry.addGroup(0, 384);
    if (unsupported === 'displacement') f.material.displacementMap = new T.Texture();
    if (unsupported === 'wireframe') f.material.wireframe = true;
    if (unsupported === 'shader')
      f.mesh.material = new T.ShaderMaterial() as unknown as T.MeshStandardMaterial;
    if (unsupported === 'range') f.geometry.setDrawRange(3, 99);
    if (unsupported === 'version') f.geometry.attributes.position.needsUpdate = true;
    if (unsupported === 'hook') f.mesh.onBeforeRender = () => {};
    const sceneHook = vi.fn(() => {
      f.mesh.visible = false;
    });
    if (unsupported === 'scene-hook') f.scene.onBeforeRender = sceneHook;
    if (unsupported === 'auto-lod') {
      const lod = new T.LOD();
      lod.addLevel(f.mesh, 0);
      lod.addLevel(new T.Mesh(new T.BoxGeometry(), f.material), 0.1);
      f.scene.add(lod);
      f.scene.updateMatrixWorld(true);
    }
    expect(f.ranges.prepareCamera(f.renderer, f.scene, f.camera)).toBe(false);
    expect(f.calls.createBuffer).not.toHaveBeenCalled();
    expect(sceneHook).not.toHaveBeenCalled();
    f.ranges.dispose();
  });
  it('declines shared geometry across different transforms without extra buffers', () => {
    const f = fixture();
    f.ranges.dispose();
    const other = new T.Mesh(f.geometry, f.material);
    other.position.x = 0.1;
    f.scene.add(other);
    other.updateMatrixWorld(true);
    const ranges = new SuppliedDrawRanges(
      [
        { mesh: f.mesh, geometries: [f.geometry] },
        { mesh: other, geometries: [f.geometry] },
      ],
      true,
    );
    expect(ranges.prepareCamera(f.renderer, f.scene, f.camera)).toBe(false);
    expect(f.calls.createBuffer).not.toHaveBeenCalled();
    ranges.dispose();
  });
  it('updates the same stream after a camera change without changing the source', () => {
    const f = fixture(),
      source = f.geometry.index;
    expect(f.ranges.prepareCamera(f.renderer, f.scene, f.camera)).toBe(true);
    f.camera.lookAt(0, 0, 5);
    f.camera.updateMatrixWorld(true);
    expect(f.ranges.prepareCamera(f.renderer, f.scene, f.camera)).toBe(true);
    expect(f.calls.createBuffer).toHaveBeenCalledTimes(1);
    expect(f.calls.bufferSubData).toHaveBeenCalledTimes(2);
    submit(f, f.camera);
    expect(f.calls.bufferSubData).toHaveBeenCalledTimes(2);
    expect(f.geometry.index).toBe(source);
    f.ranges.dispose();
  });
  it.each(['cancelled', 'lost', 'disposed'] as const)(
    'does not allocate for an already %s owner',
    (state) => {
      const f = fixture();
      if (state === 'lost') f.lose();
      if (state === 'disposed') f.ranges.dispose();
      expect(
        f.ranges.prepareCamera(f.renderer, f.scene, f.camera, () => state === 'cancelled'),
      ).toBe(false);
      expect(f.calls.createBuffer).not.toHaveBeenCalled();
      f.ranges.dispose();
    },
  );
  it('keeps healthy short allocations fatal and never installs a partial prepared stream', () => {
    const f = fixture(),
      source = f.geometry.index;
    f.calls.getBufferParameter.mockReturnValueOnce(0);
    expect(() => f.ranges.prepareCamera(f.renderer, f.scene, f.camera)).toThrow(
      'Unable to allocate compacted index buffer',
    );
    expect(f.calls.bufferSubData).not.toHaveBeenCalled();
    expect(f.geometry.index).toBe(source);
    expect(f.geometry.drawRange.count).toBe(Infinity);
    expect(f.ranges.diagnostics().compacted.buffers).toBe(0);
    f.ranges.dispose();
  });
  it('stops on loss during allocation validation and recreates only after restoration', () => {
    const f = fixture(),
      source = f.geometry.index;
    f.calls.getBufferParameter.mockImplementationOnce(() => {
      f.lose();
      return 0;
    });
    expect(f.ranges.prepareCamera(f.renderer, f.scene, f.camera)).toBe(false);
    expect(f.calls.bufferSubData).not.toHaveBeenCalled();
    expect(f.geometry.index).toBe(source);
    f.restore();
    expect(f.ranges.prepareCamera(f.renderer, f.scene, f.camera)).toBe(true);
    submit(f, f.camera);
    expect(f.calls.bufferSubData).toHaveBeenCalledTimes(1);
    f.ranges.dispose();
  });
});
