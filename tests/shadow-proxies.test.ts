import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import {
  RANGE_ONLY_SHADOW_HOOK,
  SHADOW_MERGE,
  ShadowProxies,
  plainShadowCaster,
} from '../src/rendering/shadow-proxies.ts';
import { FormulaCar } from '../src/rendering/car.ts';
import { HeroShells } from '../src/rendering/hero-shells.ts';
import { DriverAsset } from '../src/rendering/driver-asset.ts';

afterEach(() => vi.unstubAllGlobals());

/** World-space triangles three's shadow pass would draw, keyed by depth side. */
function shadowTriangles(root: T.Object3D) {
  root.updateMatrixWorld(true);
  const sides = new Map<T.Side, string[]>();
  const a = new T.Vector3();
  root.traverseVisible((object) => {
    if (!plainShadowCaster(object)) return;
    const material = object.material as T.Material;
    const side =
      material.shadowSide ??
      { [T.FrontSide]: T.BackSide, [T.BackSide]: T.FrontSide, [T.DoubleSide]: T.DoubleSide }[
        material.side
      ];
    const position = object.geometry.getAttribute('position'),
      index = object.geometry.index;
    const list = sides.get(side) ?? [];
    sides.set(side, list);
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i += 3) {
      const corners: string[] = [];
      for (let k = 0; k < 3; k++) {
        const vertex = index ? index.getX(i + k) : i + k;
        a.fromBufferAttribute(position, vertex);
        if (object instanceof T.SkinnedMesh) object.applyBoneTransform(vertex, a);
        a.applyMatrix4(object.matrixWorld);
        corners.push(`${a.x.toFixed(4)},${a.y.toFixed(4)},${a.z.toFixed(4)}`);
      }
      // Winding decides the culled face: keep it, but start at the least corner.
      const first = corners.indexOf([...corners].sort()[0]);
      list.push([0, 1, 2].map((k) => corners[(first + k) % 3]).join('|'));
    }
  });
  for (const list of sides.values()) list.sort();
  return sides;
}
function drawables(root: T.Object3D) {
  let n = 0;
  root.traverseVisible((o) => {
    if (o instanceof T.Mesh && o.castShadow) n++;
  });
  return n;
}

it('merges a frame and its direct plain casters per shadow side, leaving everything else', () => {
  const frame = new T.Group();
  frame.position.set(3, 1, -2);
  frame.rotation.y = 0.4;
  const box = new T.BoxGeometry(0.4, 0.2, 0.3);
  const make = (material: T.Material, x: number) => {
    const mesh = new T.Mesh(box.clone(), material);
    mesh.position.x = x;
    mesh.rotation.z = x;
    mesh.castShadow = true;
    frame.add(mesh);
    return mesh;
  };
  const front = [make(new T.MeshStandardMaterial(), 0), make(new T.MeshStandardMaterial(), 1)];
  const double = make(new T.MeshStandardMaterial({ side: T.DoubleSide }), 2);
  const cutout = make(new T.MeshStandardMaterial({ alphaTest: 0.5 }), 3);
  const moving = make(new T.MeshStandardMaterial(), 4);
  (moving.geometry.getAttribute('position') as T.BufferAttribute).setUsage(T.DynamicDrawUsage);
  const nested = new T.Group();
  frame.add(nested);
  const deep = new T.Mesh(box.clone(), new T.MeshStandardMaterial());
  deep.castShadow = true;
  nested.add(deep);
  const instanced = new T.InstancedMesh(box.clone(), new T.MeshStandardMaterial(), 2);
  instanced.castShadow = true;
  frame.add(instanced);
  const before = shadowTriangles(frame);
  const proxies = new ShadowProxies();
  const casters = proxies.add(frame);
  // Only the two front-side plain meshes merge; a lone double-sided mesh,
  // alpha-tested, CPU-animated, nested and instanced meshes stay as they were.
  expect(casters).toHaveLength(1);
  expect(casters[0].parent).toBe(frame);
  const merged = casters[0].geometry;
  expect(proxies.bytes).toBe(
    merged.getAttribute('position').array.byteLength + merged.index!.array.byteLength,
  );
  expect((casters[0].material as T.Material).shadowSide).toBe(T.BackSide);
  expect(front.map((m) => m.castShadow)).toEqual([false, false]);
  expect([double, cutout, moving, deep, instanced].every((m) => m.castShadow)).toBe(true);
  // Hidden outside shadow passes; the same triangles as the sources inside.
  expect(casters[0].visible).toBe(false);
  expect(drawables(frame)).toBe(5);
  proxies.withCasters(() => {
    expect(drawables(frame)).toBe(6);
    expect(shadowTriangles(frame)).toEqual(before);
  });
  expect(casters[0].visible).toBe(false);
  // Adding again creates nothing new; removal restores the sources.
  expect(proxies.add(frame)).toHaveLength(0);
  proxies.remove(frame);
  expect(proxies.count).toBe(0);
  expect(casters[0].parent).toBe(null);
  expect(front.map((m) => m.castShadow)).toEqual([true, true]);
  expect(shadowTriangles(frame)).toEqual(before);
});

it('merges skinned primitives on one skeleton into one skinned caster with identical posed triangles', () => {
  const frame = new T.Group();
  frame.position.set(1, 0.5, 2);
  const rootBone = new T.Bone(),
    arm = new T.Bone();
  arm.position.y = 0.5;
  rootBone.add(arm);
  const skeleton = new T.Skeleton([rootBone, arm]);
  const other = new T.Skeleton([new T.Bone()]);
  const skinned = (material: T.Material, x: number, bones = skeleton) => {
    const geometry = new T.BoxGeometry(0.2, 1, 0.2, 1, 4, 1);
    const position = geometry.getAttribute('position');
    const skinIndex = new Uint16Array(position.count * 4),
      skinWeight = new Float32Array(position.count * 4);
    for (let i = 0; i < position.count; i++) {
      const up = position.getY(i) + 0.5;
      skinIndex[i * 4 + 1] = bones === skeleton ? 1 : 0;
      skinWeight[i * 4] = 1 - up;
      skinWeight[i * 4 + 1] = up;
    }
    geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(skinWeight, 4));
    geometry.translate(x, 0, 0);
    const mesh = new T.SkinnedMesh(geometry, material);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    frame.add(mesh);
    mesh.bind(bones, new T.Matrix4());
    return mesh;
  };
  const sources = [
    skinned(new T.MeshStandardMaterial(), 0),
    skinned(new T.MeshStandardMaterial(), 0.3),
    skinned(new T.MeshStandardMaterial(), 0.6),
  ];
  const stranger = skinned(new T.MeshStandardMaterial(), 0.9, other);
  frame.add(rootBone);
  const proxies = new ShadowProxies();
  const casters = proxies.add(frame);
  expect(casters).toHaveLength(1);
  const caster = casters[0] as T.SkinnedMesh;
  expect(caster).toBeInstanceOf(T.SkinnedMesh);
  expect(caster.skeleton).toBe(skeleton);
  expect(caster.frustumCulled).toBe(false);
  expect(sources.every((m) => !m.castShadow)).toBe(true);
  expect(stranger.castShadow).toBe(true);
  // Pose the arm; the caster follows the same bones.
  arm.rotation.z = 0.7;
  rootBone.rotation.x = -0.2;
  frame.updateMatrixWorld(true);
  skeleton.update();
  const merged = proxies.withCasters(() => shadowTriangles(frame));
  proxies.remove(frame);
  expect(merged).toEqual(shadowTriangles(frame));
});

it('follows LOD tier swaps: vertices merged once, triangles once per index set', () => {
  const frame = new T.Group();
  const tiers = [0, 1].map(() => [] as T.BufferGeometry[]);
  const meshes = [0, 1].map((x) => {
    const full = new T.SphereGeometry(0.4, 12, 8);
    full.translate(x, 0, 0);
    // The reduced tier shares the vertex buffer and keeps every other triangle.
    const reduced = new T.BufferGeometry();
    reduced.setAttribute('position', full.getAttribute('position'));
    const index = full.index!.array;
    const kept: number[] = [];
    for (let t = 0; t < index.length; t += 6) kept.push(index[t], index[t + 1], index[t + 2]);
    reduced.setIndex(kept);
    tiers[0].push(full);
    tiers[1].push(reduced);
    const mesh: T.Mesh = new T.Mesh(full as T.BufferGeometry, new T.MeshStandardMaterial());
    mesh.castShadow = true;
    frame.add(mesh);
    return mesh;
  });
  const proxies = new ShadowProxies();
  const [caster] = proxies.add(frame);
  const expected = (tier: number) => {
    meshes.forEach((m, i) => {
      m.geometry = tiers[tier][i];
      m.castShadow = true;
    });
    const triangles = shadowTriangles(frame);
    meshes.forEach((m) => (m.castShadow = false));
    return triangles;
  };
  const full = expected(0),
    reduced = expected(1);
  meshes.forEach((m, i) => (m.geometry = tiers[0][i]));
  const first = proxies.withCasters(() => [shadowTriangles(frame), caster.geometry] as const);
  expect(first[0]).toEqual(full);
  meshes.forEach((m, i) => (m.geometry = tiers[1][i]));
  const second = proxies.withCasters(() => [shadowTriangles(frame), caster.geometry] as const);
  expect(second[0]).toEqual(reduced);
  expect(second[1]).not.toBe(first[1]);
  expect(second[1].getAttribute('position')).toBe(first[1].getAttribute('position'));
  meshes.forEach((m, i) => (m.geometry = tiers[0][i]));
  proxies.withCasters(() => expect(caster.geometry).toBe(first[1]));
  proxies.dispose();
});

it('leaves large sources casting alone and keeps merged casters within 16-bit indices', () => {
  const frame = new T.Group();
  const grid = (vertices: number) => {
    const side = Math.ceil(Math.sqrt(vertices)) - 1;
    const mesh = new T.Mesh(
      new T.PlaneGeometry(1, 1, side, side) as T.BufferGeometry,
      new T.MeshStandardMaterial(),
    );
    mesh.castShadow = true;
    frame.add(mesh);
    return mesh;
  };
  const large = grid(SHADOW_MERGE.maxSourceVertices + 500);
  expect(large.geometry.getAttribute('position').count).toBeGreaterThan(
    SHADOW_MERGE.maxSourceVertices,
  );
  // Twelve sources of ~7.4k vertices: over 65,535 in total, so two chunks.
  const small = Array.from({ length: 12 }, () => grid(7400));
  const before = shadowTriangles(frame);
  const proxies = new ShadowProxies();
  const casters = proxies.add(frame);
  expect(casters).toHaveLength(2);
  expect(large.castShadow).toBe(true);
  expect(small.every((m) => !m.castShadow)).toBe(true);
  for (const caster of casters) {
    expect(caster.geometry.getAttribute('position').count).toBeLessThanOrEqual(
      SHADOW_MERGE.maxCasterVertices,
    );
    expect(caster.geometry.index!.array).toBeInstanceOf(Uint16Array);
  }
  expect(proxies.withCasters(() => shadowTriangles(frame))).toEqual(before);
  proxies.dispose();
});

it('shares identical merged geometry across cars and releases it with the last user', () => {
  const part = () => {
    const frame = new T.Group();
    for (const x of [0, 0.4, 0.8]) {
      const mesh = new T.Mesh(new T.BoxGeometry(0.3, 0.2, 0.5), new T.MeshStandardMaterial());
      mesh.position.x = x;
      mesh.castShadow = true;
      frame.add(mesh);
    }
    return frame;
  };
  const [a, b, c] = [part(), part(), part()];
  c.children[0].position.x = 0.05;
  const proxies = new ShadowProxies();
  const [ca] = proxies.add(a);
  const one = proxies.bytes;
  const [cb] = proxies.add(b);
  expect(cb.geometry).toBe(ca.geometry);
  expect(proxies.bytes).toBe(one);
  // A different placement is different data.
  const [cc] = proxies.add(c);
  expect(cc.geometry).not.toBe(ca.geometry);
  expect(proxies.bytes).toBe(2 * one);
  let disposed = 0;
  ca.geometry.addEventListener('dispose', () => disposed++);
  proxies.remove(a);
  expect(disposed).toBe(0);
  expect(cb.geometry.getAttribute('position')).toBeDefined();
  proxies.remove(b);
  expect(disposed).toBe(1);
  expect(proxies.bytes).toBe(one);
  proxies.dispose();
  expect(proxies.bytes).toBe(0);
});

it('accepts a shadow hook only when it is marked as draw-range narrowing', () => {
  const mesh = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
  mesh.castShadow = true;
  expect(plainShadowCaster(mesh)).toBe(true);
  mesh.onBeforeShadow = () => undefined;
  expect(plainShadowCaster(mesh)).toBe(false);
  mesh.userData[RANGE_ONLY_SHADOW_HOOK] = true;
  expect(plainShadowCaster(mesh)).toBe(true);
});

it('shows the casters only while the renderer renders shadow maps', () => {
  const frame = new T.Group();
  for (let i = 0; i < 2; i++) {
    const mesh = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
    mesh.castShadow = true;
    mesh.position.x = i;
    frame.add(mesh);
  }
  const proxies = new ShadowProxies();
  const [caster] = proxies.add(frame);
  const seen: boolean[] = [];
  const shadowMap = {
    render: vi.fn(() => {
      seen.push(caster.visible);
    }),
  };
  const renderer = { shadowMap } as unknown as T.WebGLRenderer;
  const original = shadowMap.render;
  proxies.install(renderer);
  expect(() => proxies.install(renderer)).toThrow('already installed');
  renderer.shadowMap.render([], new T.Scene(), new T.PerspectiveCamera());
  expect(seen).toEqual([true]);
  expect(original).toHaveBeenCalledOnce();
  expect(caster.visible).toBe(false);
  original.mockImplementationOnce(() => {
    throw new Error('lost');
  });
  expect(() => renderer.shadowMap.render([], new T.Scene(), new T.PerspectiveCamera())).toThrow(
    'lost',
  );
  expect(caster.visible).toBe(false);
  proxies.dispose();
  expect(renderer.shadowMap.render).toBe(original);
  expect(proxies.count).toBe(0);
});

it('casts the same shadow triangles from a rival car with about half the draws', async () => {
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
  const levels: { draws: number; triangles: Map<T.Side, string[]> }[] = [];
  for (const level of [0, 1, 2]) {
    car.setLod(level === 0 ? 10 : level === 1 ? 100 : 400, 'high', false);
    expect(car.lodLevel).toBe(level);
    levels.push({ draws: drawables(car.root), triangles: shadowTriangles(car.root) });
  }
  proxies.add(...car.shadowFrames());
  const after = [0, 1, 2].map((level) => {
    car.setLod(level === 0 ? 10 : level === 1 ? 100 : 400, 'high', false);
    return proxies.withCasters(() => ({
      draws: drawables(car.root),
      triangles: shadowTriangles(car.root),
    }));
  });
  for (const [level, row] of after.entries()) {
    expect(row.triangles, `LOD ${level}`).toEqual(levels[level].triangles);
    expect(row.draws, `LOD ${level}`).toBeLessThan(levels[level].draws);
    if (level > 0) expect(row.draws, `LOD ${level}`).toBeLessThanOrEqual(13);
  }
  // Measured: 92 -> 54 shadow draws at LOD0 (the satin floor carbon is its own
  // material since D06), 23 -> 13 at LOD1 and LOD2.
  expect(levels[0].draws).toBe(92);
  expect(after[0].draws).toBeLessThanOrEqual(54);
  // Damage still removes a wing's shadow: its caster lives in the wing group.
  car.frontWing.visible = false;
  car.setLod(10, 'high', false);
  const damaged = proxies.withCasters(() => shadowTriangles(car.root));
  car.frontWing.visible = true;
  car.root.updateMatrixWorld(true);
  const wingTriangles = proxies.withCasters(
    () => [...shadowTriangles(car.frontWing).values()].flat().length,
  );
  expect(wingTriangles).toBeGreaterThan(0);
  expect([...damaged.values()].flat().length).toBe(
    [...levels[0].triangles.values()].flat().length - wingTriangles,
  );
  proxies.dispose();
  hero.dispose();
  driver.dispose();
});
