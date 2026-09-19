import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  daylightState,
  shadowAnchor,
  SUN_OFFSET,
  configureSky,
} from '../src/rendering/daylight.ts';
import {
  sampleBody,
  sculptedLoft,
  wingElement,
  aeroPlate,
  type BodySection,
} from '../src/rendering/bodywork.ts';
import { surfacePixels } from '../src/rendering/surface-detail.ts';
import { terrainHeight, vegetationPlan } from '../src/rendering/landscape.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { CircuitScene } from '../src/rendering/circuit.ts';

const sections: readonly BodySection[] = [
  [-1.7, -0.2, 0.06, 0.1],
  [-0.8, -0.1, 0.3, 0.2],
  [0.2, 0, 0.26, 0.13],
  [0.4, 0.02, 0.2, 0.08],
];
describe('original bodywork reference geometry', () => {
  it('interpolates authored sections without negative dimensions or envelope overshoot', () => {
    for (let i = 0; i < sections.length - 1; i++)
      for (let step = 0; step <= 20; step++) {
        const a = sections[i],
          b = sections[i + 1],
          sample = sampleBody(sections, a[0] + ((b[0] - a[0]) * step) / 20);
        for (const axis of [1, 2, 3]) {
          expect(sample[axis]).toBeGreaterThanOrEqual(Math.min(a[axis], b[axis]) - 1e-10);
          expect(sample[axis]).toBeLessThanOrEqual(Math.max(a[axis], b[axis]) + 1e-10);
        }
      }
    expect(() => sampleBody(sections, NaN)).toThrow();
    expect(() => sampleBody([...sections].reverse(), 0)).toThrow();
  });
  it('closes the shell, reconciles its skin seam, and retains finite unit normals', () => {
    const geometry = sculptedLoft(sections, 0.4, 0.6),
      p = geometry.getAttribute('position'),
      n = geometry.getAttribute('normal');
    expect(p.count).toBeGreaterThan(800);
    for (let i = 0; i < p.count; i++) {
      expect([p.getX(i), p.getY(i), p.getZ(i)].every(Number.isFinite)).toBe(true);
      expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 4);
    }
    const skin = p.count - 84;
    for (let i = 0; i < skin; i += 41)
      for (const get of ['getX', 'getY', 'getZ'] as const) expect(n[get](i)).toBe(n[get](i + 40));
    expect(geometry.boundingBox!.min.z).toBeCloseTo(-1.7, 6);
    expect(geometry.boundingBox!.max.z).toBeCloseTo(0.4, 6);
    geometry.dispose();
  });
  it('makes a thin swept wing with outward upper normals, not a rounded plank', () => {
    const geometry = wingElement(1.94, 0.34, 0.025, 0.015, 0.08, 0.028),
      p = geometry.getAttribute('position'),
      n = geometry.getAttribute('normal');
    const middle = 10 * 33 + 8;
    expect(n.getY(middle)).toBeGreaterThan(0.85);
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new T.Vector3());
    expect(size.x).toBeCloseTo(1.94, 5);
    expect(size.y).toBeLessThan(0.12);
    expect(Array.from(p.array).every(Number.isFinite)).toBe(true);
    expect(() => wingElement(0, 0.3, 0.02, 0.01)).toThrow();
    geometry.dispose();
    const plate = aeroPlate([
      [-0.3, 0],
      [0.3, 0],
      [0.2, 0.4],
      [-0.3, 0.3],
    ]);
    plate.computeBoundingBox();
    expect(plate.boundingBox!.max.x - plate.boundingBox!.min.x).toBeLessThan(0.04);
    plate.dispose();
  });
});
it.each(['asphalt', 'grass', 'gravel', 'concrete'] as const)(
  '%s texels are deterministic, bounded and fully opaque',
  (kind) => {
    const a = surfacePixels(kind, 32),
      b = surfacePixels(kind, 32);
    expect(a).toEqual(b);
    expect(a.albedo.length).toBe(32 * 32 * 4);
    expect(new Set(a.height).size).toBeGreaterThan(50);
    for (let i = 0; i < 32 * 32; i++) expect(a.albedo[i * 4 + 3]).toBe(255);
    expect(() => surfacePixels(kind, NaN)).toThrow();
  },
);
it('reduces direct sunlight with recorded cloud cover and bounds adverse weather lighting', () => {
  let previous = Infinity;
  for (let i = 0; i <= 100; i++) {
    const state = daylightState(i / 100, 60);
    expect(state.sun).toBeLessThanOrEqual(previous);
    previous = state.sun;
    expect(Object.values(state).every(Number.isFinite)).toBe(true);
    expect(state.fill).toBeLessThan(1);
    expect(state.sun).toBeGreaterThan(0);
  }
  expect(daylightState(-1, -1)).toEqual(daylightState(0, 0));
  expect(() => daylightState(NaN, 0)).toThrow();
  const sky = new Sky();
  configureSky(sky);
  expect(sky.material.uniforms.sunPosition.value.toArray()).toEqual(SUN_OFFSET.toArray());
  expect(sky.material.fragmentShader).toContain('uniform float cloudCover');
  sky.geometry.dispose();
  sky.material.dispose();
});
it('snaps shadows in the rotated light frame and safely supports an aliased output', () => {
  const forward = SUN_OFFSET.clone().normalize(),
    right = new T.Vector3(0, 1, 0).cross(forward).normalize();
  const a = new T.Vector3(),
    b = right.clone().multiplyScalar(0.001),
    out = new T.Vector3();
  expect(shadowAnchor(a, 2048, 38, out).length()).toBeCloseTo(0, 8);
  expect(shadowAnchor(b, 2048, 38, out).dot(right)).toBeCloseTo(0, 8);
  const target = new T.Vector3(3, 4, 5),
    expected = shadowAnchor(target, 2048, 38, new T.Vector3());
  expect(shadowAnchor(target, 2048, 38, target).distanceTo(expected)).toBeLessThan(1e-10);
  expect(() => shadowAnchor(target, 0, 38, out)).toThrow();
});
it('places complete trees on the visible ground, outside every nearby racing or pit corridor', () => {
  const track = new Track('clear'),
    trees = vegetationPlan(track),
    point = trackPoint();
  expect(trees).toEqual(vegetationPlan(track));
  expect(trees.length).toBeGreaterThan(400);
  expect(trees.length).toBeLessThanOrEqual(650);
  for (const tree of trees) {
    const lateral = track.nearest(tree.x, tree.z, point);
    expect(Math.abs(lateral)).toBeGreaterThanOrEqual(
      track.boundary(point.s, lateral < 0 ? -1 : 1) + 14,
    );
    const y =
      Math.abs(lateral) <= point.width + 38
        ? point.y +
          point.bank * Math.max(-12, Math.min(12, lateral)) -
          0.04 -
          Math.max(0, Math.abs(lateral) - 15) * 0.045
        : terrainHeight(tree.x, tree.z);
    expect(tree.y).toBeCloseTo(y, 7);
    expect(tree.height).toBeGreaterThanOrEqual(6);
  }
});
it('maps pit wetness to the same clamped lateral cells used by physical surface sampling', () => {
  const track = new Track('rain', true),
    scene = Object.assign(Object.create(CircuitScene.prototype), {
      track,
      group: new T.Group(),
    }) as CircuitScene;
  const road = scene.ribbon(new T.MeshStandardMaterial(), {
    start: 50,
    end: 80,
    step: 2,
    columns: 4,
    offset: (s, t) => track.pitOffset(s) + (t * 2 - 1) * 3.6,
  });
  const state = road.geometry.getAttribute('trackUV');
  for (let i = 0; i < state.count; i++) expect(state.getX(i)).toBe(1);
  road.geometry.dispose();
  (road.material as T.Material).dispose();
});
