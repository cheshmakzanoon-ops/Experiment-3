/* global __TEXTURE_VARIANT__ */
/** Controlled fixtures for the actual committed TextureBudget module.
 * The scalar canvas double records ownership/paint propagation, not native pixels.
 * Native pixel evidence is retained separately by the orchestrator.
 */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as T from 'three';
import { TextureBudget } from 'engine-followup:texture-budget';

const variant = __TEXTURE_VARIANT__;
const definitions = {
  'generated-shared-1024': [
    { source: 'generated-a', kind: 'generated', count: 1024, scale: 1, cpu: false },
  ],
  'imported-shared-1024': [
    { source: 'imported-a', kind: 'imported', count: 1024, scale: 1, cpu: false },
  ],
  'mixed-six-groups-1024': [
    { source: 'generated-a', kind: 'generated', count: 256, scale: 1, cpu: false },
    { source: 'generated-a', kind: 'generated', count: 128, scale: 2, cpu: false },
    { source: 'generated-a', kind: 'generated', count: 128, scale: 1, cpu: true },
    { source: 'generated-b', kind: 'generated', count: 128, scale: 1, cpu: false },
    { source: 'imported-a', kind: 'imported', count: 192, scale: 1, cpu: false },
    { source: 'imported-b', kind: 'imported', count: 192, scale: 1, cpu: false },
  ],
};

class ScalarCanvas {
  width = 300;
  height = 150;
  paint = 0;
  context = {
    drawImage: (source) => {
      this.paint = source.paint;
    },
    clearRect: () => {
      this.paint = 0;
    },
  };
  getContext() {
    return this.context;
  }
}

function environment(counted) {
  let counters = { createdCanvases: 0, drawImageCalls: 0, clearRectCalls: 0, getContextCalls: 0 };
  const copies = [];
  class CountedCanvas extends ScalarCanvas {
    firstContextOptions = null;
    firstContextObserved = false;
    constructor() {
      super();
      this.context = {
        drawImage: (source, x, y, width, height) => {
          counters.drawImageCalls++;
          assert.equal(x, 0);
          assert.equal(y, 0);
          if (width !== undefined) assert.equal(width, this.width);
          if (height !== undefined) assert.equal(height, this.height);
          this.paint = source.paint;
        },
        clearRect: (x, y, width, height) => {
          counters.clearRectCalls++;
          assert.deepEqual([x, y, width, height], [0, 0, this.width, this.height]);
          this.paint = 0;
        },
      };
    }
    getContext(kind, options) {
      counters.getContextCalls++;
      assert.equal(kind, '2d');
      if (!this.firstContextObserved) {
        this.firstContextObserved = true;
        this.firstContextOptions = options ?? null;
      }
      return this.context;
    }
  }
  const Canvas = counted ? CountedCanvas : ScalarCanvas;
  globalThis.HTMLCanvasElement = Canvas;
  globalThis.document = counted
    ? {
        createElement(kind) {
          assert.equal(kind, 'canvas');
          counters.createdCanvases++;
          const canvas = new Canvas();
          copies.push(canvas);
          return canvas;
        },
      }
    : { createElement: () => new Canvas() };
  return {
    Canvas,
    copies,
    read: () => ({ ...counters }),
    reset() {
      counters = { createdCanvases: 0, drawImageCalls: 0, clearRectCalls: 0, getContextCalls: 0 };
    },
  };
}

function scene(maps) {
  return new T.Mesh(
    new T.BufferGeometry(),
    maps.map((map) => new T.MeshBasicMaterial({ map, alphaMap: map })),
  );
}
function destroyScene(root) {
  root.geometry.dispose();
  for (const material of root.material) material.dispose();
}
function original(Canvas, kind, paint = 1) {
  const image = new Canvas();
  image.width = 1024;
  image.height = 512;
  image.paint = paint;
  const map = kind === 'generated' ? new T.CanvasTexture(image) : new T.Texture(image);
  if (kind === 'imported') {
    map.flipY = false;
    map.userData.immutableAssetTexture = true;
  }
  return { map, image, source: map.source, external: map.clone() };
}
function fixture(caseId, Canvas) {
  const groups = definitions[caseId];
  assert.ok(groups, `Unknown case ${caseId}`);
  const originals = new Map();
  const wrappers = [];
  const groupsWithMaps = [];
  for (const group of groups) {
    let source = originals.get(group.source);
    if (!source) {
      source = original(Canvas, group.kind, originals.size + 1);
      originals.set(group.source, source);
    }
    const maps = [];
    for (let index = 0; index < group.count; index++) {
      const map = source.map.clone();
      if (group.scale !== 1) map.userData.textureBudgetScale = group.scale;
      if (group.cpu) map.userData.cpuReadback = true;
      maps.push(map);
      wrappers.push(map);
    }
    groupsWithMaps.push({ ...group, maps, original: source });
  }
  const root = scene(wrappers);
  const budget = new TextureBudget();
  budget.configure(128, 2);
  return { groups: groupsWithMaps, wrappers, originals, root, budget };
}
function versions(maps) {
  return maps.map((map) => map.version);
}
function deltas(maps, before) {
  return maps.map((map, index) => map.version - before[index]);
}
function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function countedCase(caseId) {
  const env = environment(true);
  const f = fixture(caseId, env.Canvas);
  let disposeEvents = 0;
  for (const map of f.wrappers) map.addEventListener('dispose', () => disposeEvents++);
  const before = versions(f.wrappers);
  const originalSourceVersions = [...f.originals.values()].map((source) => source.source.version);
  env.reset();
  f.budget.register(f.root);
  const generatedGroups = f.groups.filter((group) => group.kind === 'generated');
  const importedGroups = f.groups.filter((group) => group.kind === 'imported');
  const expectedDraws =
    variant === 'baseline'
      ? sum(generatedGroups.map((group) => group.count)) + importedGroups.length
      : f.groups.length;
  const expectedUpdates =
    variant === 'baseline'
      ? sum(f.groups.map((group) => (group.count * (group.count + 1)) / 2))
      : f.wrappers.length;
  const expectedDisposals =
    variant === 'baseline' ? f.wrappers.length + f.groups.length : f.wrappers.length * 2;
  assert.equal(env.read().drawImageCalls, expectedDraws);
  assert.equal(env.read().clearRectCalls, expectedDraws - f.groups.length);
  assert.equal(env.read().createdCanvases, f.groups.length);
  assert.equal(disposeEvents, expectedDisposals);
  assert.equal(sum(deltas(f.wrappers, before)), expectedUpdates);
  assert.equal(new Set(f.wrappers.map((map) => map.source)).size, f.groups.length);
  assert.deepEqual(
    [...f.originals.values()].map((source) => source.source.version),
    originalSourceVersions,
  );
  const groups = f.groups.map((group) => {
    const first = group.maps[0];
    const width = 128 * group.scale;
    for (const [index, map] of group.maps.entries()) {
      assert.equal(map.source, first.source);
      assert.notEqual(map.source, group.original.source);
      assert.equal(map.image.width, width);
      assert.equal(map.image.height, width / 2);
      assert.equal(map.image.paint, group.original.image.paint);
      assert.equal(map.anisotropy, 2);
      assert.equal(map.minFilter, T.LinearMipmapLinearFilter);
      assert.equal(map.generateMipmaps, true);
      const globalIndex = f.wrappers.indexOf(map);
      assert.equal(
        map.version - before[globalIndex],
        variant === 'baseline' ? group.count - index : 1,
      );
    }
    assert.equal(group.original.source.data, group.original.image);
    assert.equal(group.original.external.source, group.original.source);
    assert.deepEqual(
      first.image.firstContextOptions,
      group.cpu ? { willReadFrequently: true } : null,
    );
    return {
      source: group.source,
      kind: group.kind,
      wrappers: group.count,
      scale: group.scale,
      cpuReadback: group.cpu,
      size: [first.image.width, first.image.height],
      firstContextOptions: first.image.firstContextOptions,
      ownedSourceVersion: first.source.version,
      expectedOwnedSourceVersion:
        variant === 'baseline' ? (group.count * (group.count + 1)) / 2 : group.count,
    };
  });
  for (const group of groups)
    assert.equal(group.ownedSourceVersion, group.expectedOwnedSourceVersion);
  const increments = deltas(f.wrappers, before);
  const registration = {
    wrappers: f.wrappers.length,
    originalSources: f.originals.size,
    budgetSources: groups.length,
    ...env.read(),
    disposeEvents,
    wrapperVersionIncrements: sum(increments),
    minWrapperVersionIncrement: Math.min(...increments),
    maxWrapperVersionIncrement: Math.max(...increments),
    groups,
    originalsAndExternalClonesUnchanged: true,
    allWrapperVersionDeltasChecked: true,
  };
  env.reset();
  disposeEvents = 0;
  const repeatedBefore = versions(f.wrappers);
  f.budget.register(f.root);
  assert.deepEqual(versions(f.wrappers), repeatedBefore);
  assert.equal(sum(Object.values(env.read())), 0);
  assert.equal(disposeEvents, 0);
  const repeatedRegistration = { ...env.read(), disposeEvents, wrapperVersionIncrements: 0 };
  f.budget.dispose();
  assert.equal(disposeEvents, f.wrappers.length);
  for (const group of f.groups)
    for (const map of group.maps) assert.equal(map.source, group.original.source);
  const disposedVersions = versions(f.wrappers);
  f.budget.dispose();
  assert.deepEqual(versions(f.wrappers), disposedVersions);
  assert.equal(disposeEvents, f.wrappers.length);
  destroyScene(f.root);
  return {
    caseId,
    registration,
    repeatedRegistration,
    disposal: { disposeEvents, everySourceRestored: true, secondDisposalIsIdle: true },
  };
}

function lifecycleProof() {
  const env = environment(true);
  const a = original(env.Canvas, 'generated', 1);
  const unrelated = original(env.Canvas, 'generated', 9);
  const imported = original(env.Canvas, 'imported', 21);
  const normal = a.map.clone();
  const sibling = a.map.clone();
  const hero = a.map.clone();
  const readback = a.map.clone();
  hero.userData.textureBudgetScale = 2;
  readback.userData.cpuReadback = true;
  const maps = [normal, sibling, hero, readback, unrelated.map, imported.map];
  const roots = [scene(maps)];
  const budget = new TextureBudget();
  budget.configure(128, 2);
  budget.register(roots[0]);
  const sourceIdentities = maps.map((map) => map.source);
  const normalImage = normal.image;
  assert.deepEqual(readback.image.firstContextOptions, { willReadFrequently: true });
  a.image.paint = 7;
  const late = [normal.clone(), normal.clone()];
  const lateImported = imported.map.clone();
  const all = [...maps, ...late, lateImported];
  roots.push(scene([normal, ...late, lateImported]));
  env.reset();
  const lateBefore = versions(all);
  budget.register(roots[1]);
  assert.equal(normal.image, normalImage);
  assert.equal(normal.image.paint, 7);
  assert.equal(hero.image.paint, 1);
  assert.equal(readback.image.paint, 1);
  assert.equal(unrelated.map.image.paint, 9);
  assert.equal(lateImported.image.paint, 21);
  assert.equal(lateImported.source, imported.map.source);
  assert.ok(late.every((map) => map.source === normal.source));
  const lateRegistration = {
    ...env.read(),
    wrapperVersionIncrements: sum(deltas(all, lateBefore)),
    generatedGroupPaint: normal.image.paint,
    otherBudgetGroupsRetainPriorCopyUntilRefresh: [hero.image.paint, readback.image.paint],
    originalAndExternalPaint: [a.image.paint, a.external.image.paint],
    sourceAndCopyIdentityPreserved: true,
  };
  assert.equal(lateRegistration.drawImageCalls, variant === 'baseline' ? 2 : 1);
  assert.equal(lateRegistration.wrapperVersionIncrements, variant === 'baseline' ? 9 : 6);
  a.image.paint = 11;
  env.reset();
  let refreshDisposals = 0;
  const release = () => refreshDisposals++;
  for (const map of all) map.addEventListener('dispose', release);
  const refreshBefore = versions(all);
  budget.refresh(readback);
  const affected = [normal, sibling, hero, readback, ...late];
  assert.ok(affected.every((map) => map.image.paint === 11));
  assert.equal(unrelated.map.image.paint, 9);
  assert.equal(imported.map.image.paint, 21);
  assert.equal(refreshDisposals, 0);
  assert.deepEqual(deltas(all, refreshBefore), [1, 1, 1, 1, 0, 0, 1, 1, 0]);
  assert.deepEqual(
    maps.map((map) => map.source),
    sourceIdentities,
  );
  const explicitRefresh = {
    ...env.read(),
    disposeEvents: refreshDisposals,
    allSourceGroupsRepainted: true,
  };
  assert.equal(explicitRefresh.drawImageCalls, 3);
  assert.equal(explicitRefresh.clearRectCalls, 3);
  for (const map of all) map.removeEventListener('dispose', release);
  const releasedWidths = [];
  const widthListeners = all.map((map, index) => {
    const callback = () => releasedWidths.push({ wrapper: index, width: map.image.width });
    map.addEventListener('dispose', callback);
    return callback;
  });
  const priorWidths = all.map((map) => map.image.width);
  budget.configure(256, 4);
  assert.equal(releasedWidths.length, all.length);
  for (const event of releasedWidths) assert.equal(event.width, priorWidths[event.wrapper]);
  assert.deepEqual(
    maps.map((map) => map.source),
    sourceIdentities,
  );
  for (const [index, map] of all.entries())
    map.removeEventListener('dispose', widthListeners[index]);
  budget.configure(1024, 8);
  assert.ok(affected.every((map) => map.image === a.image));
  assert.equal(imported.map.image, imported.image);
  assert.equal(unrelated.map.image, unrelated.image);
  assert.ok(all.every((map) => map.anisotropy === 8 && map.generateMipmaps));
  const retiredRoot = scene([normal]);
  roots.push(retiredRoot);
  budget.unregister(retiredRoot);
  assert.equal(normal.source, a.source);
  const retiredVersion = normal.version;
  budget.configure(128, 1);
  assert.equal(normal.version, retiredVersion);
  assert.equal(normal.image, a.image);
  assert.equal(sibling.image.width, 128);
  budget.register(retiredRoot);
  assert.equal(normal.source, sibling.source);
  budget.dispose();
  for (const map of affected) assert.equal(map.source, a.source);
  assert.equal(unrelated.map.source, unrelated.source);
  assert.equal(imported.map.source, imported.source);
  assert.equal(lateImported.source, imported.source);
  const restoredVersions = versions(all);
  budget.dispose();
  assert.deepEqual(versions(all), restoredVersions);
  const reusableRoot = scene([normal]);
  roots.push(reusableRoot);
  budget.register(reusableRoot);
  assert.notEqual(normal.source, a.source);
  assert.equal(normal.image.paint, 11);
  budget.dispose();
  assert.equal(normal.source, a.source);
  for (const root of roots) destroyScene(root);
  return {
    lateRegistration,
    explicitRefresh,
    resize: {
      releasedWidths,
      everyReleasePrecededDimensionChange: true,
      sourceIdentitiesStable: true,
    },
    fullQualityUsesAuthoredImages: true,
    unregisteredWrapperUnaffectedByLaterQualityChange: true,
    reRegistrationJoinsLiveGroup: true,
    everyOriginalSourceRestored: true,
    repeatedDisposalIsIdle: true,
    disposedBudgetReusable: true,
  };
}

const timingEnvironment = process.argv.includes('--serve') ? environment(false) : undefined;
let checksum = 0;
function timingSample(caseId, repetitions) {
  globalThis.gc?.();
  const durationsMs = [];
  for (let index = 0; index < repetitions; index++) {
    const f = fixture(caseId, timingEnvironment.Canvas);
    const start = performance.now();
    f.budget.register(f.root);
    const elapsed = performance.now() - start;
    durationsMs.push(elapsed);
    // Observable use and cleanup stay outside the registration interval.
    checksum += f.wrappers[0].version + f.wrappers.at(-1).version + f.wrappers[0].image.width;
    assert.equal(new Set(f.wrappers.map((map) => map.source)).size, f.groups.length);
    f.budget.dispose();
    destroyScene(f.root);
  }
  return {
    repetitions,
    registrationMs: sum(durationsMs),
    perRegistrationMs: sum(durationsMs) / repetitions,
    durationsMs,
    checksum,
  };
}

if (process.argv.includes('--proof')) {
  const proof = {
    variant,
    boundary:
      'Instrumented scalar paint-propagation canvas double; no browser rasterization or GPU.',
    cases: Object.keys(definitions).map(countedCase),
    lifecycle: lifecycleProof(),
    resourceUsage: process.resourceUsage(),
  };
  process.stdout.write(`${JSON.stringify(proof)}\n`);
} else if (process.argv.includes('--serve')) {
  process.on('disconnect', () => process.exit(0));
  process.on('message', (message) => {
    try {
      if (message.command === 'sample') {
        process.send({
          id: message.id,
          ok: true,
          result: timingSample(message.caseId, message.repetitions),
        });
      } else if (message.command === 'stop') {
        process.send({
          id: message.id,
          ok: true,
          result: { resourceUsage: process.resourceUsage(), memory: process.memoryUsage() },
        });
        process.disconnect();
      } else throw new Error(`Unknown command ${message.command}`);
    } catch (error) {
      process.send({ id: message.id, ok: false, error: error?.stack ?? String(error) });
    }
  });
  process.send({ ready: true, variant });
} else throw new Error('Expected --proof or --serve');
