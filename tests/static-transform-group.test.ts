import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { StaticTransformGroup } from '../src/rendering/static-transform-group.ts';

function tree() {
  const scene = new T.Scene();
  const owner = new StaticTransformGroup();
  const offset = new T.Group();
  const leaf = new T.Object3D();
  const actor = new T.Object3D();
  scene.add(owner, actor);
  owner.add(offset);
  offset.add(leaf);
  offset.position.set(3, 2, -4);
  offset.rotation.set(0.2, -0.5, 0.1);
  leaf.position.set(2, 7, -5);
  leaf.scale.set(2, 0.7, 0.6);
  owner.sealTransforms();
  scene.updateMatrixWorld(true);
  return { scene, owner, offset, leaf, actor };
}

const values = (root: T.Object3D) => {
  const result: number[][] = [];
  root.traverse((object) => result.push(object.matrixWorld.toArray()));
  return result;
};

describe('sealed static venue transforms', () => {
  it('skips identical static descendants across forced colour/mirror/shadow passes but updates actors', () => {
    const { scene, owner, leaf, actor } = tree();
    const before = values(owner);
    const staticVisit = vi.spyOn(leaf, 'updateMatrixWorld');
    const dynamicVisit = vi.spyOn(actor, 'updateMatrixWorld');
    for (let i = 0; i < 9; i++) {
      actor.position.x = i;
      scene.updateMatrixWorld(true);
    }
    expect(staticVisit).not.toHaveBeenCalled();
    expect(dynamicVisit).toHaveBeenCalledTimes(9);
    expect(values(owner)).toEqual(before);
    expect(actor.matrixWorld.elements[12]).toBe(8);
  });

  it('matches uncached matrices exactly through parent rotation, translation and nonuniform scale', () => {
    const { scene, owner } = tree();
    for (let i = 0; i < 30; i++) {
      scene.position.set(i / 3, 2, -i / 2);
      scene.rotation.set(0.1, i / 7, 0.3);
      scene.scale.set(2, 1 + i / 20, 0.7);
      owner.position.set(-i, i / 10, 5);
      owner.rotation.set(i / 9, 0.5, -0.2);
      owner.scale.set(0.6, 1.2, 2.1);
      scene.updateMatrixWorld(true);
      const cached = values(owner);
      owner.thawTransforms();
      scene.updateMatrixWorld(true);
      expect(values(owner)).toEqual(cached);
      owner.sealTransforms();
      scene.updateMatrixWorld(true);
    }
  });

  it('keeps descendants invalid after a parent-only world query', () => {
    const { scene, owner, leaf } = tree();
    owner.position.x = 17;
    owner.updateWorldMatrix(true, false);
    scene.updateMatrixWorld(true);
    const observed = leaf.matrixWorld.toArray();
    owner.thawTransforms();
    scene.updateMatrixWorld(true);
    expect(leaf.matrixWorld.toArray()).toEqual(observed);
  });

  it('handles a full world query, reparenting, manual owner matrices and explicit descendant editing', () => {
    const { scene, owner, offset, leaf } = tree();
    const parent = new T.Group();
    parent.position.set(10, -3, 8);
    scene.add(parent);
    parent.add(owner);
    owner.matrixAutoUpdate = false;
    owner.matrix.makeRotationY(0.43).setPosition(5, 4, 3);
    offset.position.y = -12;
    owner.invalidateTransforms();
    leaf.getWorldPosition(new T.Vector3());
    owner.updateWorldMatrix(true, true);
    const before = values(owner);
    owner.thawTransforms();
    owner.updateWorldMatrix(true, true);
    expect(values(owner)).toEqual(before);
    expect(owner.matrixAutoUpdate).toBe(false);
  });

  it('invalidates nested sealed owners and structural additions without detaching metadata', () => {
    const { scene, owner, offset } = tree();
    const nested = new StaticTransformGroup();
    const leaf = new T.Object3D();
    nested.add(leaf);
    nested.sealTransforms();
    offset.add(nested);
    owner.userData.architecture = { revision: 'retained' };
    owner.invalidateTransforms();
    scene.updateMatrixWorld(true);
    leaf.position.z = 7;
    owner.invalidateTransforms();
    scene.updateMatrixWorld(true);
    const observed = leaf.matrixWorld.toArray();
    nested.thawTransforms();
    owner.thawTransforms();
    scene.updateMatrixWorld(true);
    expect(leaf.matrixWorld.toArray()).toEqual(observed);
    owner.sealTransforms();
    scene.updateMatrixWorld(true);
    const newChild = new T.Object3D();
    newChild.position.x = 43;
    owner.add(newChild);
    scene.updateMatrixWorld(true);
    expect(newChild.matrixWorld.elements[12]).toBe(43);
    owner.remove(newChild);
    scene.updateMatrixWorld(true);
    expect(owner.userData.architecture).toEqual({ revision: 'retained' });
    expect(owner.children).toContain(offset);
  });

  it('does not cache a partial construction and rejects skinning rather than freezing actors', () => {
    const owner = new StaticTransformGroup(),
      child = new T.Object3D();
    owner.add(child);
    for (let i = 0; i < 8; i++) {
      child.position.x = i;
      owner.updateMatrixWorld(true);
      expect(child.matrixWorld.elements[12]).toBe(i);
    }
    owner.add(new T.Bone());
    expect(() => owner.sealTransforms()).toThrow('Animated skeletons');
  });
});
