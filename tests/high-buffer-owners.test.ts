import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runInThisContext } from 'node:vm';
import * as T from 'three';
import { installHighBufferOwners, type HighBufferUpload } from '../e2e/high-buffer-owners.ts';
import {
  GeometryGL,
  nativeGeometryRenderer,
  nativeTriangle,
} from './helpers/native-geometry-renderer.ts';

const cleanups: (() => void)[] = [];
beforeEach(() => {
  // Installed WebGLRenderer owns an animation service even when no loop runs.
  vi.stubGlobal('self', { requestAnimationFrame: () => 1, cancelAnimationFrame() {} });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.unstubAllGlobals();
});
function observe(
  options: {
    limits?: { views?: number; nodes?: number; renderers?: number };
    serialized?: boolean;
  } = {},
) {
  const records: HighBufferUpload[] = [],
    unavailable: string[] = [];
  let chase = false;
  const target = new EventTarget();
  vi.stubGlobal('__THREE_DEVTOOLS__', target);
  const install = options.serialized
    ? (runInThisContext(
        `(${installHighBufferOwners.toString()})`,
      ) as typeof installHighBufferOwners)
    : installHighBufferOwners;
  const observer = install({
    prototype: GeometryGL.prototype,
    onUpload: (record) => records.push(structuredClone(record)),
    onUnavailable: (message) => unavailable.push(message),
    chaseStarted: () => chase,
    limits: options.limits,
  });
  cleanups.push(() => observer.stop());
  return {
    observer,
    target,
    records,
    unavailable,
    chase: () => {
      chase = true;
    },
  };
}

function nativeRun(instrumented: boolean) {
  const o = instrumented ? observe({ serialized: true }) : null;
  const h = nativeGeometryRenderer(),
    mesh = nativeTriangle();
  let callbacks = 0;
  mesh.geometry.index!.onUpload(() => callbacks++);
  (mesh.geometry.attributes.position as T.BufferAttribute).onUpload(() => callbacks++);
  h.scene.add(mesh);
  const result = h.renderer.render(h.scene, h.camera);
  h.renderer.render(h.scene, h.camera);
  mesh.geometry.dispose();
  mesh.material.dispose();
  h.renderer.dispose();
  o?.observer.stop();
  return {
    commands: h.gl.commands,
    records: o?.records,
    unavailable: o?.unavailable,
    callbacks,
    result,
  };
}

it('serializes the real observer and preserves every installed renderer GL invocation, draw and callback', () => {
  const cold = nativeRun(false),
    observed = nativeRun(true);
  expect(observed.commands).toEqual(cold.commands);
  expect(observed.callbacks).toBe(2);
  expect(observed.result).toBe(cold.result);
  expect(observed.unavailable).toEqual([]);
  expect(
    observed.commands
      .filter((command) => command.name === 'drawElements')
      .map((command) => command.args[1]),
  ).toEqual([3, 3]);
  expect(observed.records).toHaveLength(2);
  const [vertex, index] = observed.records!;
  expect(vertex).toMatchObject({
    attribution: 'registered-array',
    exact: null,
    bufferKnown: true,
    bufferDataStarts: 1,
  });
  expect(vertex.candidates.map((owner) => owner.slot)).toEqual(['position']);
  expect(index).toMatchObject({
    attribution: 'exact-direct-index',
    bufferKnown: true,
    exact: { slot: 'index', geometryName: 'triangle geometry', versionAtCall: 0 },
  });
  expect(index.renderer).toBeGreaterThan(0);
  expect(index.buffer).not.toBe(vertex.buffer);
});

it('preserves the existing devtools target, listeners and native Scene/renderer events', () => {
  const target = new EventTarget(),
    events: unknown[] = [];
  vi.stubGlobal('__THREE_DEVTOOLS__', target);
  target.addEventListener('observe', (event) => events.push((event as CustomEvent).detail));
  const o = installHighBufferOwners({
    prototype: GeometryGL.prototype,
    onUpload() {},
    chaseStarted: () => false,
  });
  cleanups.push(() => o.stop());
  const before = new T.Scene(),
    h = nativeGeometryRenderer();
  expect(
    (globalThis as typeof globalThis & { __THREE_DEVTOOLS__: EventTarget }).__THREE_DEVTOOLS__,
  ).toBe(target);
  expect(events.filter((event) => event === before)).toHaveLength(1);
  expect(events.filter((event) => event === h.renderer)).toHaveLength(1);
  h.renderer.dispose();
  o.stop();
  const after = new T.Scene();
  expect(events.filter((event) => event === after)).toHaveLength(1);
});

it('keeps equal-sized views distinct and reports shared-array native-owner ambiguity', () => {
  const o = observe(),
    h = nativeGeometryRenderer();
  const a = nativeTriangle('a'),
    b = nativeTriangle('b'),
    c = nativeTriangle('c');
  b.geometry.setAttribute(
    'position',
    new T.BufferAttribute(a.geometry.attributes.position.array, 3),
  );
  h.scene.add(a, b, c);
  h.renderer.render(h.scene, h.camera);
  const positions = o.records.filter((record) => record.target === 34962);
  expect(positions).toHaveLength(3);
  expect(positions[0].view).toBe(positions[1].view);
  expect(positions[0].buffer).not.toBe(positions[1].buffer);
  expect(new Set(positions[0].candidates.map((owner) => owner.nativeAttribute)).size).toBe(2);
  expect(positions[2].byteLength).toBe(positions[0].byteLength);
  expect(positions[2].view).not.toBe(positions[0].view);
  expect(positions[2].backingBuffer).not.toBe(positions[0].backingBuffer);
  const indices = o.records.filter((record) => record.target === 34963);
  expect(new Set(indices.map((record) => record.view)).size).toBe(3);
  expect(indices.map((record) => record.exact?.geometryName)).toEqual([
    'a geometry',
    'b geometry',
    'c geometry',
  ]);
  h.renderer.dispose();
});

it('normalizes interleaved slots to the installed native cache owner without merging their slots', () => {
  const o = observe(),
    h = nativeGeometryRenderer(),
    mesh = nativeTriangle();
  const data = new T.InterleavedBuffer(
    new Float32Array([-1, -1, 0, 0, 0, 1, 1, -1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1]),
    6,
  );
  mesh.geometry.setAttribute('position', new T.InterleavedBufferAttribute(data, 3, 0));
  mesh.geometry.setAttribute('normal', new T.InterleavedBufferAttribute(data, 3, 3));
  h.scene.add(mesh);
  h.renderer.render(h.scene, h.camera);
  const positions = o.records.filter((record) => record.target === 34962);
  expect(positions).toHaveLength(1);
  expect(positions[0].candidates.map((owner) => owner.slot)).toEqual(['position', 'normal']);
  expect(new Set(positions[0].candidates.map((owner) => owner.nativeAttribute)).size).toBe(1);
  expect(positions[0].candidates.map((owner) => [owner.stride, owner.offset])).toEqual([
    [6, 0],
    [6, 3],
  ]);
  h.renderer.dispose();
});

it('records native deletion/recreation of a shared attribute separately from same-array aliases', () => {
  const o = observe(),
    h = nativeGeometryRenderer(),
    a = nativeTriangle('shared a'),
    b = nativeTriangle('shared b');
  b.geometry.setAttribute('position', a.geometry.attributes.position);
  h.scene.add(a, b);
  h.renderer.render(h.scene, h.camera);
  const first = o.records.find((record) => record.target === 34962)!;
  expect(o.records.filter((record) => record.target === 34962)).toHaveLength(1);
  expect(new Set(first.candidates.map((owner) => owner.nativeAttribute)).size).toBe(1);
  expect(first.candidates).toHaveLength(2);
  h.scene.remove(a);
  a.geometry.dispose();
  h.renderer.render(h.scene, h.camera);
  const recreated = o.records.filter((record) => record.target === 34962).at(-1)!;
  expect(recreated.view).toBe(first.view);
  expect(recreated.buffer).not.toBe(first.buffer);
  expect(recreated.priorBuffersForView).toEqual([
    {
      buffer: first.buffer,
      context: first.context,
      generation: first.generation,
      deleteObserved: true,
      bufferDataStarts: 1,
      bufferDataReturns: 1,
    },
  ]);
  h.renderer.dispose();
});

it('rejects stale registration after the native scene callback changes arrays and revalidates versions', () => {
  const o = observe(),
    h = nativeGeometryRenderer(),
    a = nativeTriangle('a'),
    b = nativeTriangle('b');
  const pa = a.geometry.attributes.position as T.BufferAttribute,
    pb = b.geometry.attributes.position as T.BufferAttribute;
  const old = pa.array;
  h.scene.add(a, b);
  h.scene.onBeforeRender = () => {
    pa.array = new Float32Array(old);
    pb.array = old;
  };
  h.renderer.render(h.scene, h.camera);
  expect(
    o.records.filter((record) => record.target === 34962).map((record) => record.attribution),
  ).toEqual(['unknown', 'unknown']);
  expect(o.records.find((record) => record.staleCandidates === 1)).toMatchObject({
    attribution: 'unknown',
    candidates: [],
  });
  h.scene.onBeforeRender = () => {};
  // The actual direct draw registered the new live arrays after first use.
  pb.needsUpdate = true;
  h.renderer.render(h.scene, h.camera);
  const update = o.records.find((record) => record.method === 'bufferSubData')!;
  expect(update.candidates[0]).toMatchObject({ versionAtCall: 1, registeredVersion: 0 });
  expect(update.previousView).toBe(update.view);
  h.renderer.dispose();
});

it('labels Three-generated wireframe indices separately from the raw geometry index', () => {
  const o = observe(),
    h = nativeGeometryRenderer(),
    mesh = nativeTriangle();
  h.scene.add(mesh);
  h.renderer.render(h.scene, h.camera);
  mesh.material.wireframe = true;
  h.renderer.render(h.scene, h.camera);
  const indices = o.records.filter((record) => record.target === 34963);
  expect(indices.map((record) => record.attribution)).toEqual([
    'exact-direct-index',
    'derived-wireframe',
  ]);
  expect(indices[1].exact).toBeNull();
  expect(indices[1].view).not.toBe(indices[0].view);
  expect(
    h.gl.commands
      .filter((command) => command.name === 'drawElements')
      .map((command) => command.args[1]),
  ).toEqual([3, 6]);
  h.renderer.dispose();
});

it('does not attribute an upload to a mesh whose registered geometry was replaced', () => {
  const o = observe(),
    h = nativeGeometryRenderer(),
    a = nativeTriangle('replaced'),
    b = nativeTriangle('actual');
  const oldGeometry = a.geometry,
    oldArray = oldGeometry.attributes.position.array;
  h.scene.add(a, b);
  h.scene.onBeforeRender = () => {
    a.geometry = nativeTriangle('replacement').geometry;
    (b.geometry.attributes.position as T.BufferAttribute).array = oldArray;
  };
  h.renderer.render(h.scene, h.camera);
  const upload = o.records.find((record) => record.staleCandidates > 0)!;
  expect(upload).toMatchObject({ attribution: 'unknown', candidates: [], exact: null });
  expect(
    o.records.filter((record) => record.exact).map((record) => record.exact!.geometryName),
  ).toEqual(['replacement geometry', 'actual geometry']);
  h.renderer.dispose();
});

it.each([false, true])(
  'clears outer direct ownership for an actual nested renderer, including throw=%s',
  (throws) => {
    const o = observe(),
      outer = nativeGeometryRenderer(),
      inner = nativeGeometryRenderer(outer.gl);
    const a = nativeTriangle('outer compile'),
      b = nativeTriangle('inner projection');
    outer.scene.add(a);
    inner.scene.add(b);
    const error = new Error('inner native before-render rejection');
    if (throws)
      b.onBeforeRender = () => {
        throw error;
      };
    a.material.onBeforeCompile = () => {
      if (throws) expect(() => inner.renderer.render(inner.scene, inner.camera)).toThrow(error);
      else inner.renderer.render(inner.scene, inner.camera);
    };
    outer.renderer.render(outer.scene, outer.camera);
    const outerIndex = o.records.find(
      (record) => record.exact?.geometryName === 'outer compile geometry',
    )!;
    const innerVertex = o.records.find(
      (record) =>
        record.target === 34962 &&
        record.candidates.some((owner) => owner.geometryName === 'inner projection geometry'),
    )!;
    expect(innerVertex.renderer).toBeGreaterThan(0);
    expect(innerVertex.renderer).not.toBe(outerIndex.renderer);
    expect(innerVertex.exact).toBeNull();
    expect(o.observer.currentUpload(outer.gl)).toBeNull();
    inner.renderer.dispose();
    outer.renderer.dispose();
  },
);

it('restores actual nested render scopes and preserves native onUpload failures', () => {
  const o = observe(),
    h = nativeGeometryRenderer(),
    outer = nativeTriangle('outer'),
    inner = nativeTriangle('inner');
  const innerScene = new T.Scene();
  innerScene.add(inner);
  h.scene.add(outer);
  outer.onBeforeRender = () => h.renderer.render(innerScene, h.camera);
  h.renderer.render(h.scene, h.camera);
  expect(
    o.records.filter((record) => record.exact).map((record) => record.exact!.geometryName),
  ).toEqual(['inner geometry', 'outer geometry']);
  const bad = nativeTriangle('failed'),
    error = new Error('native attribute onUpload failure');
  (bad.geometry.attributes.position as T.BufferAttribute).onUpload(() => {
    throw error;
  });
  h.scene.clear().add(bad);
  expect(() => h.renderer.render(h.scene, h.camera)).toThrow(error);
  expect(o.observer.currentUpload(h.gl)).toBeNull();
  const buffer = h.gl.createBuffer();
  h.gl.bindBuffer(34962, buffer);
  h.gl.bufferData(34962, new Float32Array([7]), 35044);
  expect(o.records.at(-1)).toMatchObject({ renderer: 0, attribution: 'unknown', exact: null });
  h.renderer.dispose();
});

it('retains native thrown values, start-versus-return counts and pre-call upload metadata', () => {
  const o = observe(),
    h = nativeGeometryRenderer(),
    mesh = nativeTriangle();
  h.scene.add(mesh);
  const error = new Error('native bufferData rejection');
  h.gl.failBufferData = error;
  let during: HighBufferUpload | null = null;
  h.gl.onBufferData = () => {
    during = o.observer.currentUpload(h.gl);
  };
  expect(() => h.renderer.render(h.scene, h.camera)).toThrow(error);
  expect(during).toMatchObject({
    attribution: 'registered-array',
    bufferDataStarts: 1,
    bufferDataReturnsBeforeCall: 0,
  });
  expect(o.observer.currentUpload(h.gl)).toBeNull();
  h.gl.failBufferData = null;
  // The original failed createBuffer never entered Three's attribute cache.
  h.renderer.render(h.scene, h.camera);
  expect(o.records[1].buffer).not.toBe(o.records[0].buffer);
  expect(o.records[1].bufferDataReturnsBeforeCall).toBe(0);
  h.renderer.dispose();
});

it('tracks the default and distinct VAO element bindings without querying GL state', () => {
  const o = observe(),
    gl = new GeometryGL();
  const buffers = [gl.createBuffer(), gl.createBuffer(), gl.createBuffer()];
  const vaos = [null, gl.createVertexArray(), gl.createVertexArray()];
  for (let i = 0; i < vaos.length; i++) {
    gl.bindVertexArray(vaos[i]);
    gl.bindBuffer(34963, buffers[i]);
    gl.bufferData(34963, new Uint16Array([i]), 35044);
  }
  const first = o.records.map((record) => record.buffer);
  for (const i of [1, 0, 2]) {
    gl.bindVertexArray(vaos[i]);
    gl.bufferSubData(34963, 0, new Uint16Array([i + 1]));
  }
  expect(o.records.slice(3).map((record) => record.buffer)).toEqual([first[1], first[0], first[2]]);
  expect(gl.commands.some((command) => command.name.startsWith('get'))).toBe(false);
  gl.deleteBuffer(buffers[2]);
  gl.bufferSubData(34963, 0, new Uint16Array([4]));
  expect(o.records.at(-1)?.bufferKnown).toBe(false);
});

it('separates renderer retirement, retained JS arrays and native context generations', () => {
  const o = observe(),
    h = nativeGeometryRenderer(),
    mesh = nativeTriangle();
  h.scene.add(mesh);
  h.renderer.render(h.scene, h.camera);
  const first = o.records.find((record) => record.exact)!;
  mesh.geometry.dispose();
  h.renderer.dispose();
  const next = nativeGeometryRenderer(h.gl);
  next.scene.add(mesh);
  next.renderer.render(next.scene, next.camera);
  const second = o.records.filter((record) => record.exact).at(-1)!;
  expect(second.renderer).not.toBe(first.renderer);
  expect(second.buffer).not.toBe(first.buffer);
  expect(second.view).toBe(first.view); // Same deliberately retained JS array.
  expect(second.bufferDataStarts).toBe(1);
  h.gl.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  h.gl.canvas.dispatchEvent(new Event('webglcontextrestored'));
  next.renderer.render(next.scene, next.camera);
  const restored = o.records.filter((record) => record.exact).at(-1)!;
  expect(restored.generation).toBe(second.generation + 1);
  expect(restored.buffer).not.toBe(second.buffer);
  expect(restored.bufferKnown).toBe(true);
  next.renderer.dispose();
});

it('reports bounded inventory/aliases explicitly and restores only its own wrappers', () => {
  const original = GeometryGL.prototype.bufferData;
  const o = observe({ limits: { views: 1, nodes: 2 } }),
    h = nativeGeometryRenderer();
  h.scene.add(nativeTriangle('a'), nativeTriangle('b'), nativeTriangle('c'));
  h.renderer.render(h.scene, h.camera);
  expect(o.records.some((record) => record.inventoryTruncated)).toBe(true);
  expect(o.records.some((record) => record.attribution === 'unknown')).toBe(true);
  expect(o.records.filter((record) => record.exact)).toHaveLength(3);
  const observerWrapper = GeometryGL.prototype.bufferData;
  const laterWrapper = function (this: GeometryGL, ...args: unknown[]) {
    return observerWrapper.apply(this, args);
  };
  GeometryGL.prototype.bufferData = laterWrapper;
  o.observer.stop();
  expect(GeometryGL.prototype.bufferData).toBe(laterWrapper);
  GeometryGL.prototype.bufferData = original;
  h.renderer.dispose();
});

it('never promotes a truncated same-view alias set into an exact native owner', () => {
  const o = observe(),
    h = nativeGeometryRenderer();
  const shared = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  for (let i = 0; i < 6; i++) {
    const mesh = nativeTriangle(`alias ${i}`);
    mesh.geometry.setAttribute('position', new T.BufferAttribute(shared, 3));
    h.scene.add(mesh);
  }
  h.renderer.render(h.scene, h.camera);
  const records = o.records.filter((record) => record.target === 34962);
  expect(records).toHaveLength(6);
  for (const record of records) {
    expect(record).toMatchObject({
      attribution: 'registered-array',
      exact: null,
      aliasesTruncated: true,
      previousExactNativeAttribute: 0,
      previousExactVersion: null,
    });
    expect(record.candidates).toHaveLength(4);
    expect(record.priorBuffersForView.length).toBeLessThanOrEqual(4);
  }
  expect(records.at(-1)!.priorBuffersTruncated).toBe(true);
  h.renderer.dispose();
});

it('creates the absent devtools target and keeps diagnostic exceptions out of native behavior', () => {
  vi.stubGlobal('__THREE_DEVTOOLS__', undefined);
  const observer = installHighBufferOwners({
    prototype: GeometryGL.prototype,
    chaseStarted: () => false,
    onUpload() {
      throw new Error('diagnostic delivery failure');
    },
    onUnavailable() {
      throw new Error('diagnostic reporter failure');
    },
  });
  cleanups.push(() => observer.stop());
  const target = (globalThis as typeof globalThis & { __THREE_DEVTOOLS__: EventTarget })
    .__THREE_DEVTOOLS__;
  expect(target).toBeInstanceOf(EventTarget);
  const h = nativeGeometryRenderer();
  h.scene.add(nativeTriangle());
  expect(h.renderer.render(h.scene, h.camera)).toBeUndefined();
  expect(h.gl.commands.filter((command) => command.name === 'drawElements')).toHaveLength(1);
  h.renderer.dispose();
  observer.stop();
  expect(
    (globalThis as typeof globalThis & { __THREE_DEVTOOLS__: EventTarget }).__THREE_DEVTOOLS__,
  ).toBe(target);
});

it('retains the owner through a later delegating draw wrapper and native instanced attributes', () => {
  const o = observe(),
    h = nativeGeometryRenderer(),
    source = nativeTriangle();
  const mesh = new T.InstancedMesh(source.geometry, source.material, 2);
  mesh.frustumCulled = false;
  mesh.setColorAt(0, new T.Color(0.2, 0.3, 0.4));
  h.scene.add(mesh);
  const captured = h.renderer.renderBufferDirect;
  h.renderer.renderBufferDirect = function (...args) {
    return captured.apply(this, args);
  };
  h.renderer.render(h.scene, h.camera);
  h.renderer.renderBufferDirect = captured;
  expect(o.records.flatMap((record) => record.candidates.map((owner) => owner.slot))).toContain(
    'instanceMatrix',
  );
  expect(o.records.flatMap((record) => record.candidates.map((owner) => owner.slot))).toContain(
    'instanceColor',
  );
  expect(o.records.filter((record) => record.exact)).toHaveLength(1);
  expect(
    h.gl.commands
      .filter((command) => command.name === 'drawElementsInstanced')
      .map((command) => command.args.at(-1)),
  ).toEqual([2]);
  h.renderer.dispose();
});
