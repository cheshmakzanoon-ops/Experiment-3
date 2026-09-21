import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  helmetShell,
  helmetPatch,
  helmetPoint,
  HELMET_PROFILE,
} from '../src/rendering/helmet-shell.ts';
import {
  floorGeometry,
  floorPoint,
  wheelCoverGeometry,
  FLOOR_STATIONS,
  FLOOR_THICKNESS,
} from '../src/rendering/car-floor.ts';
import { wingElement } from '../src/rendering/bodywork.ts';

function closedOutward(g: T.BufferGeometry) {
  const p = g.getAttribute('position'),
    normal = g.getAttribute('normal'),
    ix = g.index!;
  expect(Array.from(p.array).every(Number.isFinite)).toBe(true);
  expect(Array.from(normal.array).every(Number.isFinite)).toBe(true);
  const edge = new Map<string, number>();
  let volume = 0;
  const a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3(),
    cross = new T.Vector3();
  const key = (i: number) =>
    [p.getX(i), p.getY(i), p.getZ(i)].map((n) => Math.round(n * 1e6)).join(',');
  for (let i = 0; i < ix.count; i += 3) {
    const ids = [ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)];
    a.fromBufferAttribute(p, ids[0]);
    b.fromBufferAttribute(p, ids[1]);
    c.fromBufferAttribute(p, ids[2]);
    cross.crossVectors(b.clone().sub(a), c.clone().sub(a));
    if (cross.lengthSq() < 1e-20) continue;
    volume += a.dot(new T.Vector3().crossVectors(b, c)) / 6;
    for (let j = 0; j < 3; j++) {
      const k = [key(ids[j]), key(ids[(j + 1) % 3])].sort().join('|');
      edge.set(k, (edge.get(k) ?? 0) + 1);
    }
  }
  expect([...edge.values()].every((n) => n === 2)).toBe(true);
  expect(volume).toBeGreaterThan(0);
  return volume;
}
describe('27F closed original hero surfaces and LOD continuity', () => {
  it('has a closed outward helmet, a projecting chin and restrained crown instead of a sphere', () => {
    const g = helmetShell();
    closedOutward(g);
    expect(helmetPoint(-0.09, Math.PI / 2).z).toBeGreaterThan(
      helmetPoint(0.041, Math.PI / 2).z + 0.014,
    );
    expect(g.boundingBox!.max.y).toBeCloseTo(0.149, 6);
    for (const [y, w] of HELMET_PROFILE) expect(Math.abs(helmetPoint(y, 0).x)).toBeCloseTo(w, 6);
    g.dispose();
  });
  it('keeps every visor vertex outside the exact corresponding shell point', () => {
    const g = helmetPatch(-0.033, 0.043, 0.095, Math.PI - 0.095),
      p = g.getAttribute('position'),
      uv = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      const y = T.MathUtils.lerp(-0.033, 0.043, uv.getY(i)),
        phi = T.MathUtils.lerp(0.095, Math.PI - 0.095, uv.getX(i));
      const on = helmetPoint(y, phi),
        v = new T.Vector3().fromBufferAttribute(p, i),
        n = new T.Vector3().fromBufferAttribute(g.getAttribute('normal'), i);
      expect(v.distanceTo(on)).toBeGreaterThan(0.0028);
      expect(n.dot(new T.Vector3(on.x, 0, on.z))).toBeGreaterThan(0);
    }
    g.dispose();
  });
  it.each(['high', 'mid', 'far'] as const)(
    'keeps the %s floor sealed, finite-thickness and on the shared tunnel envelope',
    (detail) => {
      const g = floorGeometry(detail);
      closedOutward(g);
      const p = g.getAttribute('position');
      for (let i = 0; i < FLOOR_STATIONS.length; i++)
        for (const u of [-1, -0.5, 0, 0.5, 1]) {
          const bottom = floorPoint(i, u, false),
            top = floorPoint(i, u, true);
          expect(top.y - bottom.y).toBeCloseTo(FLOOR_THICKNESS, 12);
          expect(
            Array.from({ length: p.count }, (_, j) =>
              new T.Vector3().fromBufferAttribute(p, j).distanceTo(bottom),
            ).some((d) => d < 1e-6),
          ).toBe(true);
        }
      expect(g.boundingBox!.min.y).toBeGreaterThan(-0.411);
      g.dispose();
    },
  );
  it.each(['high', 'mid', 'far'] as const)(
    'has a closed %s wheel cover with a dish, inner bore and visible rim thickness',
    (detail) => {
      const g = wheelCoverGeometry(detail);
      closedOutward(g);
      expect(g.boundingBox!.max.z - g.boundingBox!.min.z).toBeCloseTo(0.015, 6);
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++)
        expect(Math.hypot(p.getX(i), p.getY(i))).toBeGreaterThan(0.0519);
      g.dispose();
    },
  );
  it('reduces airfoil tessellation without replacing the four slotted elements with boxes', () => {
    const levels = (['high', 'mid', 'far'] as const).map((d) =>
      wingElement(1.94, 0.34, 0.025, 0.015, 0.08, 0.028, d),
    );
    for (const g of levels) {
      closedOutward(g);
      expect(g.boundingBox!.min.x).toBeCloseTo(-0.97, 6);
      expect(g.boundingBox!.max.x).toBeCloseTo(0.97, 6);
    }
    expect(levels[2].index!.count).toBeLessThan(levels[1].index!.count);
    expect(levels[1].index!.count).toBeLessThan(levels[0].index!.count);
    levels.forEach((g) => g.dispose());
  });
  it('rejects invalid geometric requests rather than creating NaN vertices', () => {
    expect(() => helmetPoint(NaN, 0)).toThrow();
    expect(() => helmetPoint(1, 0)).toThrow();
    expect(() => helmetPatch(0.04, -0.03, 0, Math.PI)).toThrow();
    expect(() => floorPoint(-1, 0, false)).toThrow();
    expect(() => floorPoint(0, 2, true)).toThrow();
    expect(() => wingElement(1, 0.3, 0.02, 0.01, 0, 0, 'invalid' as 'high')).toThrow();
  });
});
