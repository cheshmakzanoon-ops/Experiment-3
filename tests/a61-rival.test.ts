import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { HeroShells, HERO_PARTS } from '../src/rendering/hero-shells.ts';
import { A61_MANIFESTS, type RivalLevels } from '../src/rendering/a61-rival.ts';
import { FormulaCar } from '../src/rendering/car.ts';
import { DriverAsset } from '../src/rendering/driver-asset.ts';
import type { ReducedCar } from '../src/rendering/lod.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../src/simulation/protocol.ts';
import { WHEEL_POSITIONS } from '../src/simulation/vehicle.ts';
import { DEFAULT_LIVERY } from '../src/storage/livery.ts';

let levels: RivalLevels, legacy: HeroShells, driver: DriverAsset;
const names = ['near', 'mid', 'far'] as const;
beforeAll(async () => {
  levels = (await Promise.all(
    names.map((name, i) =>
      HeroShells.decode(
        new Uint8Array(readFileSync(`src/rendering/a61-rival-${name}.glb.gz`)),
        undefined,
        A61_MANIFESTS[i],
      ),
    ),
  )) as unknown as RivalLevels;
  legacy = await HeroShells.decode(
    new Uint8Array(readFileSync('src/rendering/apx01-shell.glb.gz')),
  );
  driver = await DriverAsset.decode(
    new Uint8Array(readFileSync('src/rendering/apx01-driver.glb.gz')),
  );
});
afterAll(() => {
  levels?.forEach((a) => a.dispose());
  legacy?.dispose();
  driver?.dispose();
});
afterEach(() => vi.unstubAllGlobals());

function canvasStub() {
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
}
function release(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  root.traverse((o) => {
    if (o instanceof T.SkinnedMesh) o.skeleton.dispose();
    if (o instanceof T.Mesh) {
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    }
  });
  for (const m of materials)
    for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
}
function census(root: T.Object3D) {
  let draws = 0,
    triangles = 0;
  root.traverseVisible((o) => {
    if (o instanceof T.Mesh) {
      draws += Array.isArray(o.material) ? o.geometry.groups.length : 1;
      triangles +=
        ((o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3) *
        (o instanceof T.InstancedMesh ? o.count : 1);
    }
  });
  return { draws, triangles };
}

it('retains one original native source, complete mechanical roles, bounded UVs and three smaller derivatives', () => {
  const source = createHash('sha256')
    .update(readFileSync('scripts/apx01-assembly.blend'))
    .digest('hex');
  const author = createHash('sha256')
    .update(readFileSync('scripts/author-a61-rival.py'))
    .digest('hex');
  const counts: number[] = [];
  let download = 0;
  for (let level = 0; level < 3; level++) {
    const manifest = A61_MANIFESTS[level],
      asset = levels[level];
    expect(manifest.sourceSHA256).toBe(source);
    expect(manifest.authorSHA256).toBe(author);
    expect(manifest.detailLevel).toBe(level);
    expect(manifest.finalArtApproved).toBe(false);
    expect(manifest.parts.slice().sort()).toEqual(HERO_PARTS.slice().sort());
    download += manifest.compressedBytes;
    counts.push(Object.values(manifest.triangles).reduce((a, b) => a + b, 0));
    for (const role of HERO_PARTS) {
      const geometry = asset.copy(role),
        positions = geometry.getAttribute('position'),
        normals = geometry.getAttribute('normal'),
        uv = geometry.getAttribute('uv');
      expect(positions.count).toBeLessThan(32768);
      for (let i = 0; i < positions.count; i += 7) {
        expect(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i))).toBeCloseTo(1, 5);
        expect(uv.getX(i)).toBeGreaterThanOrEqual(-1e-5);
        expect(uv.getX(i)).toBeLessThanOrEqual(1.00001);
        expect(uv.getY(i)).toBeGreaterThanOrEqual(-1e-5);
        expect(uv.getY(i)).toBeLessThanOrEqual(1.00001);
      }
      geometry.dispose();
    }
  }
  expect(counts[0]).toBeLessThan(125000);
  expect(counts[1]).toBeLessThan(counts[0] * 0.3);
  expect(counts[2]).toBeLessThan(counts[1] * 0.45);
  expect(download).toBeLessThan(2 * 1024 * 1024);
});

it('changes the rival surfaces, not its suspension sockets, axle spacing, tyre radius or player source', () => {
  for (const role of [
    'suspension_link',
    'front_upright',
    'rear_upright',
    'brake_rotor',
    'tire_front',
    'tire_rear',
  ] as const) {
    const old = legacy.copy(role),
      now = levels[0].copy(role);
    for (const end of ['min', 'max'] as const)
      expect(now.boundingBox![end].distanceTo(old.boundingBox![end]), role).toBeLessThan(0.0001);
    old.dispose();
    now.dispose();
  }
  const old = legacy.copy('sidepod'),
    now = levels[0].copy('sidepod');
  expect(now.getAttribute('position').array).not.toEqual(old.getAttribute('position').array);
  // Preserve the intake/deck envelope while moving the undercut, rather than
  // changing the physical height just to create a larger bounding box.
  expect(now.boundingBox!.max.y).toBeCloseTo(old.boundingBox!.max.y, 4);
  const original = old.getAttribute('position'),
    revised = now.getAttribute('position');
  let moved = 0;
  const point = new T.Vector3(),
    previous = new T.Vector3();
  for (let i = 0; i < revised.count; i += 19) {
    point.fromBufferAttribute(revised, i);
    if (point.z < -1.3 || point.z > -0.4 || Math.abs(point.x) < 0.16) continue;
    let closest = Infinity;
    for (let j = 0; j < original.count; j++)
      closest = Math.min(
        closest,
        point.distanceToSquared(previous.fromBufferAttribute(original, j)),
      );
    moved = Math.max(moved, Math.sqrt(closest));
  }
  expect(moved).toBeGreaterThan(0.008);
  expect(now.boundingBox!.min.z).toBeCloseTo(old.boundingBox!.min.z, 4);
  expect(now.boundingBox!.max.z).toBeCloseTo(old.boundingBox!.max.z, 4);
  old.dispose();
  now.dispose();
  expect(A61_MANIFESTS[0].triangles.floor_edges).toBeGreaterThan(
    legacy.diagnostics().triangles.floor_edges,
  );
});

it('rejects mixed-tier data and corrupt models instead of silently reverting to the old rival', async () => {
  const bytes = new Uint8Array(readFileSync('src/rendering/a61-rival-near.glb.gz'));
  await expect(HeroShells.decode(bytes, undefined, A61_MANIFESTS[1])).rejects.toThrow('integrity');
  bytes[90] ^= 1;
  await expect(HeroShells.decode(bytes, undefined, A61_MANIFESTS[0])).rejects.toThrow('integrity');
});

it('keeps owned clones independent and mirrors triangle winding with the wheel', () => {
  for (const asset of levels) {
    const right = asset.copy('front_cover'),
      left = asset.copy('front_cover', -1),
      other = asset.copy('front_cover');
    const p = right.getAttribute('position'),
      l = left.getAttribute('position');
    for (let i = 0; i < p.count; i += 11) expect(l.getX(i)).toBeCloseTo(-p.getX(i), 6);
    for (let i = 0; i < right.index!.count; i += 3) {
      expect(left.index!.getX(i + 1)).toBe(right.index!.getX(i + 2));
      expect(left.index!.getX(i + 2)).toBe(right.index!.getX(i + 1));
    }
    p.setX(0, 99);
    expect(other.getAttribute('position').getX(0)).not.toBe(99);
    right.dispose();
    left.dispose();
    other.dispose();
  }
});

it('preserves actual FormulaCar steering, service, damage, replay rewind and mirror handoff without increasing near draws', () => {
  canvasStub();
  const baseline = new FormulaCar(1, legacy, driver),
    car = new FormulaCar(1, legacy, driver, undefined, levels);
  const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 1 });
  const frame = sim.makeFrame(),
    o = carBase(1),
    reduced = (car as unknown as { reduced: ReducedCar[] }).reduced;
  const metrics: unknown[] = [];
  try {
    expect(car.root.userData.a61).toHaveLength(3);
    for (const [distance, level] of [
      [0, 0],
      [100, 1],
      [250, 2],
      [0, 0],
    ]) {
      baseline.setLod(distance, 'high', false);
      car.setLod(distance, 'high', false);
      expect(car.lodLevel).toBe(level);
      const b = census(baseline.root),
        c = census(car.root);
      metrics.push({ level, before: b, after: c });
      if (level === 0) expect(c.draws).toBeLessThanOrEqual(b.draws);
      expect(c.triangles).toBeLessThan(level === 0 ? 250000 : level === 1 ? 65000 : 30000);
      for (const steer of [-0.38, 0, 0.38]) {
        frame[o + F.STEER] = steer;
        for (let i = 0; i < 4; i++) {
          const w = o + WHEEL_BASE + i * WHEEL_STRIDE;
          frame[w + W.STEER] = i < 2 ? steer : 0;
          frame[w + W.LENGTH] = 0.21 + i * 0.015;
          frame[w + W.CAMBER] = i % 2 ? -0.045 : 0.045;
          frame[w + W.ROTATION] = 1.23;
        }
        const saved = frame.slice();
        car.update(frame, frame, o, 1, 1 / 60, frame[H.TIME], false);
        expect(frame).toEqual(saved);
        const pivots = level === 0 ? car.wheelPivots : reduced[level - 1].wheels;
        for (let i = 0; i < 4; i++) {
          const w = o + WHEEL_BASE + i * WHEEL_STRIDE;
          expect(pivots[i].position.x).toBe(WHEEL_POSITIONS[i][0]);
          expect(pivots[i].position.z).toBe(WHEEL_POSITIONS[i][2]);
          expect(pivots[i].rotation.y).toBeCloseTo(frame[w + W.STEER], 6);
          expect(pivots[i].position.y).toBeCloseTo(0.05 - frame[w + W.LENGTH], 6);
        }
      }
    }
    frame[o + F.PIT_PHASE] = 3;
    frame[o + F.PIT_CLOCK] = 2.1;
    for (let i = 0; i < 4; i++) frame[o + WHEEL_BASE + i * WHEEL_STRIDE + W.LOAD] = 0;
    car.update(frame, frame, o, 1, 0, 0, false);
    for (const representation of reduced)
      for (let i = 0; i < 4; i++) {
        expect(Math.abs(representation.spins[i].position.x)).toBeCloseTo(0.48, 5);
        expect(representation.brakes[i].position.x).toBe(0);
      }
    frame[o + F.FRONT_HEALTH] = 0.01;
    frame[o + F.REAR_HEALTH] = 0.01;
    car.update(frame, frame, o, 1, 0, 0, false);
    for (const r of reduced) {
      expect(r.front.visible).toBe(false);
      expect(r.rear.visible).toBe(false);
    }
    car.showDetail(2);
    expect(car.lodLevel).toBe(0);
    car.showDetail(0);
    expect(reduced.every((r) => !r.root.visible)).toBe(true);
    car.setLivery({ ...DEFAULT_LIVERY, primary: '#134862', accent: '#efc89d' });
    expect(car.paint.color.getHexString()).toBe('134862');
    const neutral = sim.makeFrame();
    car.update(neutral, neutral, o, 1, 0, 0, false);
    expect(car.frontWing.visible).toBe(true);
    for (const r of reduced) expect(r.front.visible).toBe(true);
    console.log('A61_CPU_DRAW_CENSUS', JSON.stringify(metrics));
  } finally {
    release(car.root);
    release(baseline.root);
  }
});
