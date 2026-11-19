import assert from 'node:assert/strict';
import { nativeRendererHarness } from './native-renderer-harness.mjs';
import {
  prepareProbeGeometry,
  prepareRetainedStaticGeometry,
} from '../../src/rendering/geometry-preparation.ts';
import { ReflectionSystem } from '../../src/rendering/reflections.ts';

export const nativeGeometryCases = [];
function state(h) {
  const r = h.renderer;
  return {
    target: r.getRenderTarget(),
    face: r.getActiveCubeFace(),
    mip: r.getActiveMipmapLevel(),
    viewport: r.getViewport(new h.T.Vector4()).toArray(),
    scissor: r.getScissor(new h.T.Vector4()).toArray(),
    scissorTest: r.getScissorTest(),
    autoClear: r.autoClear,
    sortObjects: r.sortObjects,
    xr: r.xr.enabled,
  };
}
function fixture() {
  const h = nativeRendererHarness(),
    { T } = h,
    scene = new T.Scene();
  const materials = [],
    objects = [],
    geometryNames = new Map(),
    arrayNames = new Map();
  const directions = [
    [8, 0, 0],
    [-8, 0, 0],
    [0, 0, 8],
  ];
  let callbacks = 0,
    uploads = 0;
  for (let i = 0; i < directions.length; i++) {
    const geometry = new T.BoxGeometry(1, 1, 1);
    geometry.name = `retained-${i}`;
    geometryNames.set(geometry, geometry.name);
    for (const [slot, attribute] of Object.entries(geometry.attributes)) {
      arrayNames.set(attribute.array, `${geometry.name}:${slot}`);
      attribute.onUpload(() => uploads++);
    }
    arrayNames.set(geometry.index.array, `${geometry.name}:index`);
    geometry.index.onUpload(() => uploads++);
    geometry.drawRange = { start: 3, count: 9 };
    const material = new T.MeshBasicMaterial({ color: 0x667788 });
    materials.push(material);
    const object = new T.Mesh(geometry, material);
    object.position.fromArray(directions[i]);
    object.onBeforeRender = () => callbacks++;
    scene.add(object);
    objects.push(object);
  }
  scene.updateMatrixWorld();
  const target = new T.WebGLCubeRenderTarget(16),
    cube = new T.CubeCamera(0.1, 30, target);
  return {
    ...h,
    scene,
    objects,
    materials,
    target,
    cube,
    arrayNames,
    callbacks: () => callbacks,
    uploads: () => uploads,
    capture() {
      h.stage('capture');
      cube.update(h.renderer, scene);
    },
    close() {
      for (const o of objects) o.geometry.dispose();
      for (const m of materials) m.dispose();
      target.dispose();
      h.dispose();
    },
  };
}
function normalizedRaster(h) {
  return h.events
    .filter((e) => e.stage === 'capture' && e.method.startsWith('draw') && e.count > 0)
    .map((e) => ({
      method: e.method,
      face: e.cubeFace,
      count: e.count,
      offset: e.offset,
      indexOwner: e.index ? h.arrayNames.get(h.buffers.get(e.index).data) : null,
    }));
}
function test(name, run) {
  nativeGeometryCases.push({ name, run });
}

test('Native compileAsync leaves retained vertex/index buffers cold', async () => {
  const h = fixture();
  try {
    h.clearEvents();
    await h.renderer.compileAsync(h.scene, h.cube.children[0]);
    assert.equal(h.summary().uploads, 0);
    assert.equal(h.renderer.info.memory.geometries, 0);
    return { nativeBufferUploadsAfterCompile: 0, nativeGeometryRegistrationsAfterCompile: 0 };
  } finally {
    h.close();
  }
});

test('Exact native geometry owners move before all six cube draws without extra payload uploads', async () => {
  const cold = fixture(),
    prepared = fixture();
  try {
    const before = state(prepared),
      ranges = prepared.objects.map((o) => o.geometry.drawRange);
    const beforeObjects = prepared.objects.map((o) => ({
      parent: o.parent,
      material: o.material,
      callback: o.onBeforeRender,
      matrix: o.matrix.toArray(),
      matrixWorld: o.matrixWorld.toArray(),
      groups: o.geometry.groups,
    }));
    cold.clearEvents();
    prepared.clearEvents();
    cold.capture();
    prepared.stage('preparation');
    const result = prepareRetainedStaticGeometry(prepared.renderer, [
      ...prepared.objects,
      prepared.objects[0],
    ]);
    assert.equal(result.prepared, 3);
    assert.equal(result.skipped, 0);
    assert.deepEqual(state(prepared), before);
    assert.equal(prepared.callbacks(), 0);
    assert.equal(prepared.renderer.info.memory.geometries, 3);
    for (let i = 0; i < prepared.objects.length; i++) {
      const o = prepared.objects[i],
        expected = beforeObjects[i];
      assert.equal(o.geometry.drawRange, ranges[i]);
      assert.equal(o.parent, expected.parent);
      assert.equal(o.material, expected.material);
      assert.equal(o.onBeforeRender, expected.callback);
      assert.deepEqual(o.matrix.toArray(), expected.matrix);
      assert.deepEqual(o.matrixWorld.toArray(), expected.matrixWorld);
      assert.equal(o.geometry.groups, expected.groups);
    }
    const prepEvents = [...prepared.events],
      uploadedBuffers = new Map(
        prepEvents.filter((e) => e.method === 'bufferData').map((e) => [e.data, e.buffer]),
      );
    assert.equal(prepEvents.filter((e) => e.method.startsWith('draw')).length, 3);
    assert(prepEvents.filter((e) => e.method.startsWith('draw')).every((e) => e.count === 0));
    for (const method of ['clear', 'blitFramebuffer', 'generateMipmap'])
      assert.equal(prepEvents.filter((e) => e.method === method).length, 0);
    prepared.capture();
    assert.equal(
      prepared.events.filter((e) => e.stage === 'capture' && e.method === 'bufferData').length,
      0,
    );
    assert.equal(prepared.summary().uploads, cold.summary().uploads);
    assert.deepEqual(normalizedRaster(prepared), normalizedRaster(cold));
    assert.equal(prepared.callbacks(), cold.callbacks());
    assert.equal(prepared.uploads(), cold.uploads());
    for (const e of prepared.events.filter(
      (e) => e.stage === 'capture' && e.method.startsWith('draw') && e.index,
    ))
      assert.equal(e.index, uploadedBuffers.get(prepared.buffers.get(e.index).data));
    const coldEvents = cold.events.filter(
      (e) => e.method === 'bufferData' || (e.method.startsWith('draw') && e.count > 0),
    );
    const firstDraw = coldEvents.findIndex((e) => e.method.startsWith('draw'));
    const interleavedUploads = coldEvents
      .slice(firstDraw + 1)
      .filter((e) => e.method === 'bufferData').length;
    assert(interleavedUploads > 0);
    return {
      coldUploads: cold.summary().uploads,
      preparedTotalUploads: prepared.summary().uploads,
      coldUploadsAfterFirstRaster: interleavedUploads,
      preparedCaptureUploads: 0,
      preparationZeroCountDraws: 3,
      preparationRasterDraws: 0,
      retainedRasterDraws: normalizedRaster(prepared),
      originalCallbacksPreserved: true,
      originalRangeObjectsAndTransformsPreserved: true,
      nativeIndexBufferHandlesRetained: true,
    };
  } finally {
    cold.close();
    prepared.close();
  }
});

test('Prepared but never rendered original geometries own native deletion', async () => {
  const h = fixture();
  try {
    h.clearEvents();
    prepareRetainedStaticGeometry(h.renderer, h.objects);
    const count = h.summary().uploads;
    assert.equal(count, 12);
    h.stage('original-owner-disposal');
    for (const object of h.objects) object.geometry.dispose();
    assert.equal(h.summary().deleted, count);
    assert.equal(h.renderer.info.memory.geometries, 0);
    return {
      preparedBufferCount: count,
      deletedExactlyOnceByOriginalGeometries: count,
      nativeGeometriesRemaining: 0,
    };
  } finally {
    h.close();
  }
});

test('Cancellation stops between geometry owners and restores original ranges/state', async () => {
  const h = fixture();
  try {
    const before = state(h),
      ranges = h.objects.map((o) => o.geometry.drawRange);
    let stopped = false;
    h.objects[0].geometry.index.onUpload(() => {
      stopped = true;
    });
    h.clearEvents();
    const result = prepareRetainedStaticGeometry(h.renderer, h.objects, () => stopped);
    assert.deepEqual(result, { prepared: 1, skipped: 0, cancelled: true });
    assert.equal(h.summary().uploads, 4);
    assert.equal(h.summary().rasterDraws, 0);
    assert.deepEqual(state(h), before);
    h.objects.forEach((o, i) => assert.equal(o.geometry.drawRange, ranges[i]));
    h.clearEvents();
    assert.deepEqual(
      prepareRetainedStaticGeometry(h.renderer, h.objects, () => true),
      { prepared: 0, skipped: 0, cancelled: true },
    );
    assert.equal(h.events.length, 0);
    return {
      preparationStoppedAfterFirstOwner: true,
      cancelledBeforeStartNativeCalls: 0,
      rendererAndRangeStateRestored: true,
    };
  } finally {
    h.close();
  }
});

test('Public render failure restores the active geometry and canvas renderer state', async () => {
  const h = fixture();
  try {
    h.renderer.setPixelRatio(2);
    h.renderer.setViewport(4, 5, 8, 9);
    h.renderer.setScissor(1, 2, 7, 6);
    h.renderer.setScissorTest(true);
    const before = state(h),
      surfaceBefore = h.nativeSurfaceState(),
      ranges = h.objects.map((o) => o.geometry.drawRange);
    const nativeRender = h.renderer.render;
    let calls = 0;
    h.renderer.render = function (...args) {
      const value = nativeRender.apply(this, args);
      if (++calls === 2) throw new Error('failure after completed native submission');
      return value;
    };
    assert.throws(
      () => prepareRetainedStaticGeometry(h.renderer, h.objects),
      /failure after completed/,
    );
    h.renderer.render = nativeRender;
    assert.deepEqual(state(h), before);
    assert.deepEqual(h.nativeSurfaceState(), surfaceBefore);
    h.objects.forEach((o, i) => assert.equal(o.geometry.drawRange, ranges[i]));
    assert.equal(h.summary().rasterDraws, 0);
    return {
      publicRenderErrorObserved: true,
      originalRangeObjectsAndRendererStateRestored: true,
      limitation:
        'A failure thrown inside the GL driver can leave Three native render-stack state incomplete; the production owner must retire that renderer, as with any failed real render.',
    };
  } finally {
    h.close();
  }
});

test('Offscreen entry keeps original native framebuffer viewport and scissor state without preparation', async () => {
  const h = fixture();
  try {
    h.renderer.setPixelRatio(2);
    h.renderer.setViewport(11, 12, 50, 51);
    h.target.viewport.set(2, 3, 8, 9);
    h.target.scissor.set(1, 2, 7, 6);
    h.target.scissorTest = true;
    for (const explicitOverride of [false, true]) {
      h.renderer.setRenderTarget(h.target, 2, 0);
      if (explicitOverride) {
        h.renderer.setViewport(4, 5, 8, 9);
        h.renderer.setScissor(3, 4, 5, 6);
        h.renderer.setScissorTest(false);
      }
      const before = state(h),
        surfaceBefore = h.nativeSurfaceState();
      h.clearEvents();
      assert.deepEqual(prepareRetainedStaticGeometry(h.renderer, h.objects), {
        prepared: 0,
        skipped: 3,
        cancelled: false,
      });
      assert.equal(
        prepareProbeGeometry(h.renderer, h.scene, h.cube, () => false),
        true,
      );
      assert.equal(h.events.length, 0);
      assert.deepEqual(state(h), before);
      assert.deepEqual(h.nativeSurfaceState(), surfaceBefore);
    }
    return {
      nativePreparationCalls: 0,
      nativeFramebufferAndViewportScissorPreserved: true,
      pixelRatio: 2,
      checkedTargetDefaultAndExplicitOverrides: true,
      offscreenCaptureRemainsOnOriginalNativePath: true,
    };
  } finally {
    h.close();
  }
});

test('InstancedMesh geometry uses native geometry ownership without borrowing instance attributes', async () => {
  const h = nativeRendererHarness(),
    { T } = h;
  const geometry = new T.BoxGeometry(),
    material = new T.MeshBasicMaterial();
  const mesh = new T.InstancedMesh(geometry, material, 2),
    scene = new T.Scene();
  const identity = new T.Matrix4();
  mesh.setMatrixAt(0, identity);
  mesh.setMatrixAt(1, identity);
  mesh.setColorAt(0, new T.Color(0xff0000));
  mesh.setColorAt(1, new T.Color(0x00ff00));
  mesh.frustumCulled = false;
  scene.add(mesh);
  const camera = new T.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 5;
  try {
    h.clearEvents();
    h.stage('preparation');
    prepareRetainedStaticGeometry(h.renderer, [mesh]);
    assert.equal(h.summary().uploads, 4);
    assert(
      h.events
        .filter((e) => e.method === 'bufferData')
        .every((e) => e.data !== mesh.instanceMatrix.array && e.data !== mesh.instanceColor.array),
    );
    const beforeCapture = h.events.length;
    h.stage('instanced-native-render');
    h.renderer.render(scene, camera);
    const remaining = h.events.slice(beforeCapture).filter((e) => e.method === 'bufferData');
    assert.deepEqual(
      new Set(remaining.map((e) => e.data)),
      new Set([mesh.instanceMatrix.array, mesh.instanceColor.array]),
    );
    assert.equal(h.renderer.info.memory.geometries, 1);
    h.stage('original-instanced-owner-disposal');
    mesh.dispose();
    geometry.dispose();
    assert.equal(h.summary().deleted, 6);
    return {
      retainedGeometryUploadsInPreparation: 4,
      originalInstanceOwnerUploadsOnFirstRealDraw: 2,
      exactInstancePayloadsPreserved: true,
      originalOwnerDisposals: 6,
      limitation:
        'Instance matrices and colors remain cold; this narrow prototype does not claim to prepare every first-draw buffer.',
    };
  } finally {
    mesh.dispose();
    geometry.dispose();
    material.dispose();
    h.dispose();
  }
});

test('Shared retained BufferAttribute identities use one native payload and native disposal rules', async () => {
  const h = nativeRendererHarness(),
    { T } = h;
  const a = new T.BoxGeometry(),
    b = new T.BoxGeometry();
  for (const name of Object.keys(a.attributes)) b.setAttribute(name, a.attributes[name]);
  const material = new T.MeshBasicMaterial();
  try {
    h.clearEvents();
    prepareRetainedStaticGeometry(h.renderer, [new T.Mesh(a, material), new T.Mesh(b, material)]);
    assert.equal(h.summary().uploads, 5);
    assert.equal(h.renderer.info.memory.geometries, 2);
    a.dispose();
    b.dispose();
    assert.equal(h.summary().deleted, 5);
    assert.equal(h.renderer.info.memory.geometries, 0);
    return {
      geometries: 2,
      sharedVertexAttributeOwners: 3,
      distinctIndexOwners: 2,
      nativeUploads: 5,
      originalOwnerDeletes: 5,
    };
  } finally {
    a.dispose();
    b.dispose();
    material.dispose();
    h.dispose();
  }
});

test('Unprepared dynamic/morph/instanced-buffer/skinned/batched/external owners are excluded', async () => {
  const h = nativeRendererHarness(),
    { T } = h,
    material = new T.MeshBasicMaterial(),
    objects = [];
  const dynamic = new T.BoxGeometry();
  dynamic.attributes.position.setUsage(T.DynamicDrawUsage);
  objects.push(new T.Mesh(dynamic, material));
  const morph = new T.BoxGeometry();
  morph.morphAttributes.position = [morph.attributes.position.clone()];
  objects.push(new T.Mesh(morph, material));
  const instanced = new T.InstancedBufferGeometry().copy(new T.BoxGeometry());
  objects.push(new T.Mesh(instanced, material));
  const skinned = new T.SkinnedMesh(new T.BoxGeometry(), material);
  objects.push(skinned);
  const batch = new T.Mesh(new T.BoxGeometry(), material);
  batch.isBatchedMesh = true;
  objects.push(batch);
  const external = new T.BufferGeometry();
  external.setAttribute('position', new T.GLBufferAttribute({}, h.gl.FLOAT, 3, 4, 3));
  objects.push(new T.Mesh(external, material));
  try {
    h.clearEvents();
    assert.deepEqual(prepareRetainedStaticGeometry(h.renderer, objects), {
      prepared: 0,
      skipped: 6,
      cancelled: false,
    });
    assert.equal(h.events.length, 0);
    return { skippedCategories: 6, nativeCalls: 0 };
  } finally {
    objects.forEach((o) => o.geometry.dispose());
    material.dispose();
    h.dispose();
  }
});

function reflectionFixture() {
  const h = fixture(),
    { T } = h,
    reflection = new ReflectionSystem();
  const extras = [],
    extraMaterials = [];
  const box = (name, position, parent = h.scene) => {
    const geometry = new T.BoxGeometry(),
      material = new T.MeshBasicMaterial();
    geometry.name = name;
    extraMaterials.push(material);
    for (const [slot, attribute] of Object.entries(geometry.attributes))
      h.arrayNames.set(attribute.array, `${name}:${slot}`);
    h.arrayNames.set(geometry.index.array, `${name}:index`);
    const mesh = new T.Mesh(geometry, material);
    mesh.position.fromArray(position);
    parent.add(mesh);
    extras.push(mesh);
    return mesh;
  };
  const car = new T.Group();
  car.position.y = -1.5;
  h.scene.add(car);
  const subject = box('hidden-subject', [0, 1.5, 5], car);
  const excludedRoot = new T.Group();
  h.scene.add(excludedRoot);
  const excluded = box('probe-exclusion', [0, 0, -8], excludedRoot);
  reflection.probeExclusions = [excludedRoot];
  const invisibleRoot = new T.Group();
  invisibleRoot.visible = false;
  h.scene.add(invisibleRoot);
  const invisible = box('invisible-ancestor', [0, 0, -10], invisibleRoot);
  const wrongLayer = box('wrong-layer', [0, 0, -12]);
  wrongLayer.layers.set(31);
  const outside = box('outside-far-frustum', [2000, 0, 0]);
  const unculled = box('unculled-outside-frustum', [2500, 0, 0]);
  unculled.frustumCulled = false;
  const layerParent = new T.Group();
  layerParent.layers.set(31);
  h.scene.add(layerParent);
  const layerChild = box('visible-child-of-wrong-layer-parent', [0, 0, -8], layerParent);
  const mirror = box('hidden-mirror', [5, 0, 5]);
  const secondMirror = box('hidden-second-mirror', [-5, 0, 5]);
  reflection.attachMirrors([mirror, secondMirror]);
  const manualLod = new T.LOD();
  manualLod.autoUpdate = false;
  manualLod.position.set(0, 8, 0);
  h.scene.add(manualLod);
  const selectedLod = box('selected-manual-lod', [0, 0, 0], manualLod);
  const inactiveLod = box('inactive-manual-lod', [0, 0, 0], manualLod);
  manualLod.addLevel(selectedLod, 0);
  manualLod.addLevel(inactiveLod, 20);
  inactiveLod.visible = false;
  h.scene.updateMatrixWorld();
  return {
    ...h,
    reflection,
    car,
    mirror,
    excludedRoot,
    box,
    selected: [...h.objects, layerChild, selectedLod, unculled],
    omitted: [subject, excluded, invisible, wrongLayer, outside, mirror, secondMirror, inactiveLod],
    close() {
      reflection.dispose();
      extras.forEach((mesh) => mesh.geometry.dispose());
      extraMaterials.forEach((material) => material.dispose());
      h.close();
    },
  };
}

test('First real reflection capture prepares only visible native face consumers before raster and skips later refreshes', async () => {
  const h = reflectionFixture();
  try {
    const before = state(h),
      scale = { value: 0.37 };
    const originalRanges = [...h.selected, ...h.omitted].map((object) => object.geometry.drawRange);
    h.clearEvents();
    h.stage('actual-first-capture');
    h.reflection.beginFrame(1, true);
    h.reflection.updateProbe(h.renderer, h.scene, h.car, [], true, 1.5, scale);
    const firstRaster = h.events.findIndex((e) => e.method.startsWith('draw') && e.count > 0);
    assert(firstRaster >= 0);
    const uploads = h.events.filter((e) => e.method === 'bufferData');
    assert.equal(uploads.length, h.selected.length * 4);
    assert(uploads.every((e) => e.cubeFace === null));
    assert(h.events.slice(firstRaster).every((e) => e.method !== 'bufferData'));
    const selectedNames = new Set(h.selected.map((o) => o.geometry.name));
    assert.deepEqual(
      new Set(uploads.map((e) => h.arrayNames.get(e.data).split(':')[0])),
      selectedNames,
    );
    assert.equal(
      h.events.filter((e) => e.method.startsWith('draw') && e.count === 0).length,
      h.selected.length,
    );
    assert.deepEqual(
      new Set(h.events.filter((e) => e.method === 'clear').map((e) => e.cubeFace)),
      new Set([0, 1, 2, 3, 4, 5]),
    );
    assert.equal(h.reflection.probeUpdates, 1);
    assert.equal(h.reflection.probeDiagnostics.pendingFace, -1);
    assert.equal(scale.value, 0.37);
    assert(h.car.visible && h.mirror.visible && h.excludedRoot.visible);
    assert.deepEqual(state(h), before);
    [...h.selected, ...h.omitted].forEach((o, i) =>
      assert.equal(o.geometry.drawRange, originalRanges[i]),
    );
    const firstDraws = h.events.filter((e) => e.method.startsWith('draw') && e.count > 0).length;
    assert(firstDraws > 0);
    h.clearEvents();
    h.stage('cadence-refresh');
    h.reflection.beginFrame(2.6, true);
    h.reflection.updateProbe(h.renderer, h.scene, h.car, [], true, 1.5, scale);
    assert.equal(h.summary().uploads, 0);
    assert.equal(h.events.filter((e) => e.method.startsWith('draw') && e.count === 0).length, 0);
    assert.equal(h.summary().rasterDraws, firstDraws);
    assert.equal(h.reflection.probeUpdates, 2);
    return {
      selectedGeometryOwners: h.selected.length,
      omittedGeometryOwners: h.omitted.length,
      selectedNames: [...selectedNames],
      firstCaptureNativeUploads: uploads.length,
      firstCaptureUploadsAfterRaster: 0,
      firstCaptureZeroCountDraws: h.selected.length,
      laterRefreshZeroCountDraws: 0,
      laterRefreshPayloadUploads: 0,
      nativeCubeFaces: 6,
      originalVisibilityRangesAndRendererStateRestored: true,
    };
  } finally {
    h.close();
  }
});

test('Automatic LOD branches keep native selection and do not upload inactive levels early', async () => {
  const h = nativeRendererHarness(),
    { T } = h,
    scene = new T.Scene();
  const near = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
  const far = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
  const lod = new T.LOD();
  lod.addLevel(near, 0);
  lod.addLevel(far, 20);
  lod.position.x = 8;
  scene.add(lod);
  const target = new T.WebGLCubeRenderTarget(16),
    cube = new T.CubeCamera(0.1, 30, target);
  scene.updateMatrixWorld();
  try {
    const visibility = [near.visible, far.visible];
    h.clearEvents();
    assert.equal(
      prepareProbeGeometry(h.renderer, scene, cube, () => false),
      true,
    );
    assert.equal(h.events.length, 0);
    assert.deepEqual([near.visible, far.visible], visibility);
    cube.update(h.renderer, scene);
    assert.equal(h.summary().uploads, 4);
    const arrays = new Set([
      ...Object.values(near.geometry.attributes).map((a) => a.array),
      near.geometry.index.array,
    ]);
    assert(h.events.filter((e) => e.method === 'bufferData').every((e) => arrays.has(e.data)));
    assert.equal(near.visible, true);
    assert.equal(far.visible, false);
    return { preparationNativeCalls: 0, nativeSelectedLevelUploads: 4, inactiveLevelUploads: 0 };
  } finally {
    near.geometry.dispose();
    far.geometry.dispose();
    near.material.dispose();
    far.material.dispose();
    target.dispose();
    h.dispose();
  }
});

test('A failed first preparation restores capture exclusions and publishes no incomplete cubemap', async () => {
  const h = reflectionFixture();
  try {
    const before = state(h),
      scale = { value: 0.37 },
      nativeRender = h.renderer.render;
    let calls = 0;
    h.renderer.render = function (...args) {
      const result = nativeRender.apply(this, args);
      if (++calls === 2) throw new Error('retained preparation failed');
      return result;
    };
    h.clearEvents();
    h.reflection.beginFrame(1, true);
    assert.throws(
      () => h.reflection.updateProbe(h.renderer, h.scene, h.car, [], true, 1.5, scale),
      /retained preparation failed/,
    );
    h.renderer.render = nativeRender;
    assert.equal(h.reflection.probeUpdates, 0);
    assert.equal(h.reflection.localProbeActive, false);
    assert.equal(h.summary().rasterDraws, 0);
    assert.equal(scale.value, 0.37);
    assert(h.car.visible && h.mirror.visible && h.excludedRoot.visible);
    assert.deepEqual(state(h), before);
    const uploads = h.summary().uploads;
    h.reflection.updateProbe(h.renderer, h.scene, h.car, [], true);
    assert.equal(h.summary().uploads, uploads);
    h.reflection.beginFrame(1.6, true);
    h.reflection.updateProbe(h.renderer, h.scene, h.car, [], true);
    assert.equal(h.reflection.probeUpdates, 1);
    assert.equal(h.summary().uploads, h.selected.length * 4);
    return {
      failedCaptureRasterDraws: 0,
      failedCapturePublished: false,
      sameRequestImmediateRetryWork: 0,
      boundedRetryReusedAlreadyPreparedOwners: true,
    };
  } finally {
    h.close();
  }
});

test('Disposal during one original upload stops remaining preparation and cube work', async () => {
  const h = reflectionFixture();
  try {
    h.objects[0].geometry.index.onUpload(() => h.reflection.dispose());
    h.clearEvents();
    h.reflection.beginFrame(1, true);
    h.reflection.updateProbe(h.renderer, h.scene, h.car, [], true);
    assert.equal(h.summary().uploads, 4);
    assert.equal(h.summary().rasterDraws, 0);
    assert.equal(h.reflection.probeUpdates, 0);
    assert.equal(h.reflection.localProbeActive, false);
    assert(h.car.visible && h.mirror.visible && h.excludedRoot.visible);
    h.objects[0].geometry.dispose();
    assert.equal(h.summary().deleted, 4);
    return {
      preparedOwnerUploads: 4,
      laterOwnerUploads: 0,
      cubeRasterDraws: 0,
      originalOwnerDeletes: 4,
    };
  } finally {
    h.close();
  }
});

test('Interleaved static owners retain one native allocation and later versioned updates', async () => {
  const h = fixture(),
    { T } = h;
  try {
    const geometry = h.objects[0].geometry;
    const data = new Float32Array(geometry.attributes.position.count * 8);
    for (let i = 0; i < geometry.attributes.position.count; i++) {
      data.set(geometry.attributes.position.array.subarray(i * 3, i * 3 + 3), i * 8);
      data.set(geometry.attributes.normal.array.subarray(i * 3, i * 3 + 3), i * 8 + 3);
      data.set(geometry.attributes.uv.array.subarray(i * 2, i * 2 + 2), i * 8 + 6);
    }
    const shared = new T.InterleavedBuffer(data, 8);
    geometry.setAttribute('position', new T.InterleavedBufferAttribute(shared, 3, 0));
    geometry.setAttribute('normal', new T.InterleavedBufferAttribute(shared, 3, 3));
    geometry.setAttribute('uv', new T.InterleavedBufferAttribute(shared, 2, 6));
    h.clearEvents();
    prepareRetainedStaticGeometry(h.renderer, [h.objects[0]]);
    assert.equal(h.summary().uploads, 2);
    const positionVersion = shared.version,
      range = geometry.drawRange;
    h.scene.remove(h.objects[1], h.objects[2]);
    h.clearEvents();
    h.capture();
    assert.equal(h.summary().uploads, 0);
    assert.equal(shared.version, positionVersion);
    shared.array[0] += 0.25;
    shared.needsUpdate = true;
    h.clearEvents();
    h.capture();
    assert.equal(h.summary().uploads, 0);
    assert.equal(h.summary().updates, 1);
    assert.equal(geometry.drawRange, range);
    return {
      interleavedNativeBuffers: 1,
      nativeIndexBuffers: 1,
      firstCaptureNewUploads: 0,
      laterVersionedUpdates: 1,
      laterReallocations: 0,
    };
  } finally {
    h.close();
  }
});

test('Probe selection follows native automatic world-matrix updates and preserves explicit matrix ownership', async () => {
  const h = nativeRendererHarness(),
    { T } = h,
    scene = new T.Scene();
  const mesh = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial()),
    group = new T.Group();
  const target = new T.WebGLCubeRenderTarget(16),
    cube = new T.CubeCamera(0.1, 30, target);
  group.position.x = 8;
  group.add(mesh);
  scene.add(group);
  scene.updateMatrixWorld();
  try {
    group.position.x = 100;
    h.clearEvents();
    prepareProbeGeometry(h.renderer, scene, cube, () => false);
    assert.equal(mesh.matrixWorld.elements[12], 100);
    assert.equal(h.summary().uploads, 0);
    cube.update(h.renderer, scene);
    assert.equal(h.summary().uploads, 0);
    group.position.x = 8;
    prepareProbeGeometry(h.renderer, scene, cube, () => false);
    assert.equal(mesh.matrixWorld.elements[12], 8);
    assert.equal(h.summary().uploads, 4);
    h.clearEvents();
    cube.update(h.renderer, scene);
    assert.equal(h.summary().uploads, 0);
    assert(h.summary().rasterDraws > 0);
    scene.matrixWorldAutoUpdate = false;
    group.position.x = 100;
    const matrix = mesh.matrixWorld.toArray(),
      nativeUpdate = scene.updateMatrixWorld;
    let updates = 0;
    scene.updateMatrixWorld = function (...args) {
      updates++;
      return nativeUpdate.apply(this, args);
    };
    h.clearEvents();
    prepareProbeGeometry(h.renderer, scene, cube, () => false);
    cube.update(h.renderer, scene);
    assert.equal(updates, 0);
    assert.deepEqual(mesh.matrixWorld.toArray(), matrix);
    assert.equal(h.summary().uploads, 0);
    assert(h.summary().rasterDraws > 0);
    return {
      movedOutsideBeforePreparationUploads: 0,
      movedInsideRetainedUploads: 4,
      subsequentCaptureUploads: 0,
      explicitOwnerForcedWorldUpdates: 0,
    };
  } finally {
    mesh.geometry.dispose();
    mesh.material.dispose();
    target.dispose();
    h.dispose();
  }
});
