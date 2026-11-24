import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import * as T from 'three';
import { FormulaCar } from '../src/rendering/car.ts';
import { HeroShells } from '../src/rendering/hero-shells.ts';
import { DriverAsset } from '../src/rendering/driver-asset.ts';
import { ShadowProxies, shadowSideOf } from '../src/rendering/shadow-proxies.ts';

afterEach(() => vi.unstubAllGlobals());

function shadowDraws(root: T.Object3D) {
  const meshes: T.Mesh[] = [];
  root.traverseVisible((object) => {
    if (object instanceof T.Mesh && object.castShadow) meshes.push(object);
  });
  return meshes;
}

function worldCorners(meshes: readonly T.Mesh[]) {
  return meshes.flatMap((mesh) => {
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.index;
    return Array.from({ length: index?.count ?? position.count }, (_, i) =>
      new T.Vector3()
        .fromBufferAttribute(position, index ? index.getX(i) : i)
        .applyMatrix4(mesh.matrixWorld),
    );
  });
}

function expectSameSurface(actual: readonly T.Vector3[], expected: readonly T.Vector3[]) {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i].distanceTo(expected[i]), `corner ${i}`).toBeLessThan(0.000003);
  }
  for (let i = 0; i < expected.length; i += 3) {
    const normal = (points: readonly T.Vector3[]) =>
      points[i + 1]
        .clone()
        .sub(points[i])
        .cross(points[i + 2].clone().sub(points[i]))
        .normalize();
    // Keeping the ordered geometric normal also checks triangle winding.
    expect(normal(actual).distanceTo(normal(expected)), `normal ${i / 3}`).toBeLessThan(0.000003);
  }
}

it('preserves positions, oriented normals, depth sides and culling under changing owner transforms', () => {
  const frame = new T.Group();
  const sources: T.Mesh[] = [];
  for (const side of [T.FrontSide, T.BackSide, T.DoubleSide]) {
    for (const x of [-0.4, 0.6]) {
      const source = new T.Mesh(
        new T.BoxGeometry(0.3, 0.4, 0.7),
        new T.MeshStandardMaterial({ side }),
      );
      source.position.set(x, 0.2, side * 0.3);
      source.rotation.set(0.1 * side, x * 0.4, 0.2);
      source.scale.set(1.1, 0.7, 1.3);
      source.castShadow = true;
      source.receiveShadow = true;
      frame.add(source);
      sources.push(source);
    }
  }
  const original = sources.map((mesh) => ({
    geometry: mesh.geometry,
    material: mesh.material,
    positions: mesh.geometry.getAttribute('position').array.slice(),
    normals: mesh.geometry.getAttribute('normal').array.slice(),
    index: mesh.geometry.index!.array.slice(),
  }));
  const proxies = new ShadowProxies();
  const casters = proxies.add(frame);
  expect(casters).toHaveLength(3);
  const poses = [
    { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    { position: [3, 1, -2], rotation: [0.2, 0.7, -0.4], scale: [1.7, 0.6, 1.2] },
    { position: [-2, 0.5, 1], rotation: [-0.4, 1.3, 0.6], scale: [-1.2, 0.8, 1.5] },
  ];
  for (const pose of poses) {
    frame.position.fromArray(pose.position);
    frame.rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2]);
    frame.scale.fromArray(pose.scale);
    frame.updateMatrixWorld(true);
    proxies.withCasters(() => {
      for (const caster of casters) {
        const side = shadowSideOf(caster.material as T.Material);
        const sameSide = sources.filter(
          (source) => shadowSideOf(source.material as T.Material) === side,
        );
        expectSameSurface(worldCorners([caster]), worldCorners(sameSide));
        expect(caster.matrixWorld.determinant() < 0).toBe(
          sameSide[0].matrixWorld.determinant() < 0,
        );
        expect(caster.frustumCulled).toBe(true);
        const sphere = caster.geometry.boundingSphere!.clone().applyMatrix4(caster.matrixWorld);
        for (const point of worldCorners(sameSide)) {
          expect(point.distanceTo(sphere.center)).toBeLessThanOrEqual(sphere.radius + 0.000003);
        }
        // A merged bound may submit extra offscreen triangles, but must never
        // reject a source which the shadow camera can see.
        for (const offset of [-3, 0, 3]) {
          const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 30);
          camera.position.copy(frame.position).add(new T.Vector3(offset, 1, 10));
          camera.lookAt(frame.position.clone().add(new T.Vector3(offset, 0, 0)));
          camera.updateMatrixWorld(true);
          const frustum = new T.Frustum().setFromProjectionMatrix(
            new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
          );
          if (sameSide.some((source) => frustum.intersectsObject(source))) {
            expect(frustum.intersectsObject(caster)).toBe(true);
          }
        }
      }
    });
    expect(casters.every((caster) => !caster.visible)).toBe(true);
  }
  // Shadow-only batching must not touch the camera-pass geometry or material.
  for (const [i, source] of sources.entries()) {
    expect(source.geometry).toBe(original[i].geometry);
    expect(source.material).toBe(original[i].material);
    expect(source.geometry.getAttribute('position').array).toEqual(original[i].positions);
    expect(source.geometry.getAttribute('normal').array).toEqual(original[i].normals);
    expect(source.geometry.index!.array).toEqual(original[i].index);
    expect(source.receiveShadow).toBe(true);
  }
  proxies.dispose();
  expect(sources.every((source) => source.castShadow)).toBe(true);
  expect(proxies.bytes).toBe(0);
});

it('keeps independently moving and hidden owners separate and restores each owner exactly once', () => {
  const reference = new T.Group();
  for (let i = 0; i < 3; i++) {
    const owner = new T.Group();
    owner.position.x = i * 1.5;
    for (const x of [-0.2, 0.2]) {
      const source = new T.Mesh(new T.BoxGeometry(0.2, 0.4, 0.6), new T.MeshStandardMaterial());
      source.position.x = x;
      source.castShadow = true;
      source.frustumCulled = i !== 1;
      owner.add(source);
    }
    reference.add(owner);
  }
  const candidate = reference.clone(true);
  const sources = shadowDraws(candidate);
  const proxies = new ShadowProxies();
  const casters = proxies.add(...candidate.children);
  expect(casters).toHaveLength(3);
  expect(casters.map((caster) => caster.frustumCulled)).toEqual([true, false, true]);
  const geometries = [...new Set(casters.map((caster) => caster.geometry))];
  const geometryDisposals = geometries.map((geometry) => {
    const disposed = vi.fn();
    geometry.addEventListener('dispose', disposed);
    return disposed;
  });
  const materialDisposals = casters.map((caster) => {
    const disposed = vi.fn();
    (caster.material as T.Material).addEventListener('dispose', disposed);
    return disposed;
  });
  for (let step = 0; step < 4; step++) {
    for (const root of [reference, candidate]) {
      root.position.set(0.2 * step, 0.1 * step, -0.3 * step);
      root.rotation.y = 0.4 * step;
      root.children[0].scale.set(1, 1 - 0.1 * step, 1);
      root.children[1].rotation.x = 0.6 * step;
      root.children[1].position.y = 0.2 * step;
      root.children[2].visible = step !== 2;
      root.updateMatrixWorld(true);
    }
    proxies.withCasters(() => {
      expectSameSurface(worldCorners(shadowDraws(candidate)), worldCorners(shadowDraws(reference)));
    });
  }
  proxies.remove(candidate.children[0]);
  expect(casters[0].parent).toBeNull();
  expect(sources.slice(0, 2).every((source) => source.castShadow)).toBe(true);
  expect(sources.slice(2).every((source) => !source.castShadow)).toBe(true);
  // Identical merged buffers remain live for the other owners.
  expect(geometryDisposals.every((disposed) => disposed.mock.calls.length === 0)).toBe(true);
  const renderFailure = new Error('shadow pass interrupted');
  expect(() =>
    proxies.withCasters(() => {
      throw renderFailure;
    }),
  ).toThrow(renderFailure);
  expect(casters.every((caster) => !caster.visible)).toBe(true);
  proxies.dispose();
  proxies.dispose();
  expect(proxies.count).toBe(0);
  expect(proxies.bytes).toBe(0);
  for (const disposed of [...geometryDisposals, ...materialDisposals])
    expect(disposed).toHaveBeenCalledOnce();
  expect(sources.every((source) => source.castShadow)).toBe(true);
  expectSameSurface(worldCorners(shadowDraws(candidate)), worldCorners(shadowDraws(reference)));
});

it('preserves the middle-LOD actuator, brake and suspension draws outside rigid shadow frames', async () => {
  const context = new Proxy({} as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === 'measureText') return (text: string) => ({ width: text.length * 8 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient')
        return () => ({ addColorStop() {} });
      return () => undefined;
    },
  });
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
  const hero = await HeroShells.decode(
    new Uint8Array(readFileSync('src/rendering/apx01-shell.glb.gz')),
  );
  const driver = await DriverAsset.decode(
    new Uint8Array(readFileSync('src/rendering/apx01-driver.glb.gz')),
  );
  const car = new FormulaCar(3, hero, driver);
  const proxies = new ShadowProxies();
  try {
    car.setLod(100, 'high', false);
    const before = shadowDraws(car.root);
    const actuators = before.filter((mesh) => mesh.parent?.name === 'Wing flap hydraulic cylinder');
    const brakes = before.filter((mesh) => mesh.name === 'Upright-owned reduced brake');
    const suspension = before.filter((mesh) => mesh.name === 'Shared articulated suspension');
    expect(actuators).toHaveLength(2);
    expect(brakes).toHaveLength(4);
    expect(suspension).toHaveLength(1);
    const independent = [...actuators, ...brakes, ...suspension];
    const original = independent.map((mesh) => ({
      mesh,
      parent: mesh.parent,
      geometry: mesh.geometry,
      material: mesh.material,
    }));
    const created = proxies.add(...car.shadowFrames());
    proxies.withCasters(() => {
      const after = shadowDraws(car.root);
      const remaining = after.filter((mesh) => !created.includes(mesh));
      expect(new Set(remaining)).toEqual(new Set(independent));
      // Body, front wing, rear wing, moving flap and four wheel-spin owners.
      expect(after.filter((mesh) => created.includes(mesh))).toHaveLength(8);
      for (const source of original) {
        expect(source.mesh.parent).toBe(source.parent);
        expect(source.mesh.geometry).toBe(source.geometry);
        expect(source.mesh.material).toBe(source.material);
        expect(source.mesh.castShadow).toBe(true);
      }
    });
    proxies.dispose();
    expect(shadowDraws(car.root)).toEqual(before);
  } finally {
    proxies.dispose();
    hero.dispose();
    driver.dispose();
  }
});
