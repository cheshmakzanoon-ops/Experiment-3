import { expect, it, vi } from 'vitest';
import * as T from 'three';
import { compileSceneTarget } from '../src/rendering/preparation.ts';
import { programHarness } from './helpers/three-program-harness.ts';

function fixture() {
  const h = programHarness(),
    scene = new T.Scene(),
    camera = new T.PerspectiveCamera(),
    geometry = new T.BoxGeometry(),
    material = new T.MeshStandardMaterial(),
    target = new T.WebGLRenderTarget(960, 600, { type: T.HalfFloatType });
  scene.add(
    new T.Mesh(geometry, material),
    new T.SkinnedMesh(geometry, material),
    new T.InstancedMesh(geometry, material, 2),
  );
  return {
    ...h,
    scene,
    camera,
    geometry,
    material,
    target,
    dispose() {
      for (const owner of [...h.owners.keys()]) owner.dispose();
      geometry.dispose();
      target.dispose();
    },
  };
}

it('initializes owned native scene variants before drawing while leaving unrelated pending owners alone', async () => {
  const h = fixture();
  // Keep a previously compiled canvas variant on the participating material.
  h.renderer.setRenderTarget(null);
  h.renderer.compile(h.scene.children[0], h.camera);
  const older = [...h.owners.get(h.material)!.values()][0];
  const unrelated = Object.assign(new T.MeshStandardMaterial(), {
    defines: { UNRELATED_PENDING: 1 },
  });
  h.renderer.compile(new T.Mesh(h.geometry, unrelated), h.camera);
  const unrelatedProgram = [...h.owners.get(unrelated)!.values()][0];
  const before = h.state(),
    stage = vi.fn(() => h.stage('prepared-metadata'));
  await compileSceneTarget(h.renderer, h.scene, h.camera, h.target, undefined, {
    cancelled: () => false,
    beforeMetadata: stage,
  });
  const owned = [...h.owners.get(h.material)!.values()];
  expect(owned).toHaveLength(4); // canvas + ordinary/skinned/instanced linear variants
  expect(owned).toContain(older);
  expect(h.state()).toEqual(before);
  expect(h.render).not.toHaveBeenCalled();
  expect(stage).toHaveBeenCalledOnce();
  expect(h.queries.filter((query) => query.kind === 'program-log')).toEqual(
    owned.map((program) => ({
      kind: 'program-log',
      program: program.program,
      stage: 'prepared-metadata',
    })),
  );
  expect(h.queries.some((query) => query.program === unrelatedProgram.program)).toBe(false);
  // Reentry retains the same references, and their real first-use cache means
  // neither this preparation nor the later draw repeats the native queries.
  const queries = [...h.queries];
  await compileSceneTarget(h.renderer, h.scene, h.camera, h.target);
  h.renderer.setRenderTarget(h.target);
  h.stage('after-six-faces');
  h.render(h.scene);
  expect(h.queries).toEqual(queries);
  expect([...h.owners.get(h.material)!.values()]).toEqual(owned);
  h.dispose();
});

it('snapshots native program references before an await can add a different material variant', async () => {
  const h = fixture();
  let finish: (value: T.Object3D) => void = () => {};
  h.renderer.compileAsync = (root) => {
    h.renderer.compile(root, h.camera);
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const before = h.state();
  const pending = compileSceneTarget(h.renderer, h.scene, h.camera, h.target);
  const original = [...h.owners.get(h.material)!.values()];
  expect(original).toHaveLength(3);
  expect(h.state()).toEqual(before);
  expect(h.queries).toEqual([]);
  Object.assign(h.material, { defines: { ADDED_DURING_WAIT: 1 } });
  h.renderer.compile(h.scene.children[0], h.camera);
  const later = [...h.owners.get(h.material)!.values()].filter(
    (program) => !original.includes(program),
  );
  expect(later).toHaveLength(1);
  finish(h.scene);
  await pending;
  expect(
    h.queries.filter((query) => query.kind === 'program-log').map((query) => query.program),
  ).toEqual(original.map((program) => program.program));
  expect(h.queries.some((query) => query.program === later[0].program)).toBe(false);
  h.dispose();
});

it('skips released native programs after compilation resolves and never queries a retired renderer', async () => {
  const h = fixture();
  let finish: (value: T.Object3D) => void = () => {};
  h.renderer.compileAsync = (root) => {
    h.renderer.compile(root, h.camera);
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const pending = compileSceneTarget(h.renderer, h.scene, h.camera, h.target);
  expect(h.created).toHaveLength(3);
  h.material.dispose();
  expect(h.cache.programs).toEqual([]);
  h.retire();
  finish(h.scene);
  await pending;
  expect(h.queries).toEqual([]);
  h.geometry.dispose();
  h.target.dispose();
});

it('cancels metadata before native work and prepares the same retained variants on a live reentry', async () => {
  const h = fixture(),
    stage = vi.fn();
  let cancelled = true;
  await compileSceneTarget(h.renderer, h.scene, h.camera, h.target, undefined, {
    cancelled: () => cancelled,
    beforeMetadata: stage,
  });
  expect(stage).not.toHaveBeenCalled();
  expect(h.queries).toEqual([]);
  const retained = [...h.cache.programs];
  expect(retained).toHaveLength(3);
  cancelled = false;
  await compileSceneTarget(h.renderer, h.scene, h.camera, h.target, undefined, {
    cancelled: () => cancelled,
    beforeMetadata: stage,
  });
  expect(h.cache.programs).toEqual(retained);
  expect(stage).toHaveBeenCalledOnce();
  expect(h.queries.filter((query) => query.kind === 'program-log')).toHaveLength(3);
  h.dispose();
});

it('rechecks cancellation if the preparation progress callback retires the owner', async () => {
  const h = fixture();
  let cancelled = false;
  await compileSceneTarget(h.renderer, h.scene, h.camera, h.target, undefined, {
    cancelled: () => cancelled,
    beforeMetadata: () => {
      cancelled = true;
      h.material.dispose();
      h.retire();
    },
  });
  expect(h.queries).toEqual([]);
  h.geometry.dispose();
  h.target.dispose();
});
