import { expect, it } from 'vitest';
import * as T from 'three';
import { renderCensus } from '../src/rendering/render-census.ts';

it('counts only shadow casters, frustum-tested, for a shadow camera census', () => {
  const scene = new T.Scene(),
    group = new T.Group();
  group.name = 'Props';
  scene.add(group);
  const geometry = new T.BoxGeometry(),
    material = new T.MeshStandardMaterial();
  const caster = new T.Mesh(geometry, material),
    receiver = new T.Mesh(geometry, material),
    outside = new T.Mesh(geometry, material);
  caster.castShadow = outside.castShadow = true;
  receiver.receiveShadow = true;
  outside.position.x = 500;
  group.add(caster, receiver, outside);
  const camera = new T.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 50, 0);
  camera.lookAt(0, 0, 0);
  expect(renderCensus(scene, [camera], [scene], true)).toEqual([
    { owner: 'Props', draws: 1, instances: 1 },
  ]);
  expect(renderCensus(scene, [camera], [scene])).toEqual([
    { owner: 'Props', draws: 2, instances: 2 },
  ]);
  geometry.dispose();
  material.dispose();
});
