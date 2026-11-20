import * as T from 'three';
import { expect, it, vi } from 'vitest';
import { MxPresentationRoot } from '../src/rendering/offroad/mx-presentation-root.ts';

it('retains a hidden slot anchor and fully poses a switched-on LOD in its first frame', () => {
  const scene = new T.Group(),
    root = new MxPresentationRoot(true),
    wheel = new T.Group();
  const spoke = new T.Object3D(),
    reference = new T.Matrix4();
  scene.add(root);
  root.add(wheel);
  wheel.add(spoke);
  scene.position.set(5, 1, -7);
  root.position.set(1, 2, 3);
  scene.updateMatrixWorld(true);
  const visit = vi.spyOn(spoke, 'updateMatrixWorld');
  root.visible = false;
  root.rotation.y = 0.81;
  wheel.position.x = -2;
  spoke.position.z = 0.37;
  scene.updateMatrixWorld(true);
  expect(visit).not.toHaveBeenCalled();
  expect(root.matrixWorld).toEqual(reference.multiplyMatrices(scene.matrixWorld, root.matrix));
  // A caller requesting a particular hidden contact can still resolve its ancestry.
  spoke.getWorldPosition(new T.Vector3());
  expect(spoke.matrixWorld).toEqual(
    reference.copy(root.matrixWorld).multiply(wheel.matrix).multiply(spoke.matrix),
  );
  root.matrixAutoUpdate = false;
  wheel.matrixAutoUpdate = false;
  wheel.matrixWorldNeedsUpdate = false;
  spoke.position.z = 1.12;
  root.visible = true;
  root.updateMatrixWorld(false);
  expect(visit).toHaveBeenCalledOnce();
  expect(spoke.matrixWorld).toEqual(
    reference.copy(root.matrixWorld).multiply(wheel.matrix).multiply(spoke.matrix),
  );
  expect(root.clone(false).suspendWhenHidden).toBe(true);
  // Switching the slot back to a non-dirt entrant restores default Three.js traversal.
  root.visible = false;
  root.suspendWhenHidden = false;
  scene.updateMatrixWorld(true);
  expect(visit).toHaveBeenCalledTimes(2);
});
