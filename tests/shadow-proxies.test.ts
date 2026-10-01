import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { ShadowProxies, plainShadowCaster } from '../src/rendering/shadow-proxies.ts';
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
        a.fromBufferAttribute(position, index ? index.getX(i + k) : i + k);
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
  // Measured: 91 -> 52 shadow draws at LOD0, 23 -> 13 at LOD1 and LOD2.
  expect(levels[0].draws).toBe(91);
  expect(after[0].draws).toBeLessThanOrEqual(52);
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
