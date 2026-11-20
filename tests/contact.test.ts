import { describe, it, expect, vi } from 'vitest';
import { Vec3, lerp, mod } from '../src/core/math.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { TriangleBVH, VerticalRayColumn, rayHit } from '../src/simulation/bvh.ts';
import { lapStation } from '../src/simulation/racing-line.ts';
import { Track, trackPoint, surfaceSample } from '../src/simulation/track.ts';
import { TrackContactMesh, kerbHeight } from '../src/simulation/contact.ts';

const square = () =>
  new TriangleBVH(
    new Float64Array([-1, 0, -1, 1, 0, -1, -1, 0, 1, 1, 0, 1]),
    new Uint32Array([0, 2, 1, 1, 2, 3]),
  );
describe('triangle contact acceleration', () => {
  it('hits edges, vertices and seams without a gap', () => {
    const b = square(),
      hit = rayHit(),
      down = new Vec3(0, -1, 0);
    for (const x of [-1, -0.5, 0, 0.5, 1]) {
      expect(b.raycast(new Vec3(x, 2, -x), down, 3, hit)).toBe(true);
      expect(hit.distance).toBeCloseTo(2, 10);
      expect(hit.normal.y).toBeCloseTo(1, 10);
    }
  });
  it('rejects distant, backwards and malformed rays', () => {
    const b = square(),
      hit = rayHit();
    expect(b.raycast(new Vec3(0, 2, 0), new Vec3(0, -1, 0), 1, hit)).toBe(false);
    expect(b.raycast(new Vec3(0, 2, 0), new Vec3(0, 1, 0), 3, hit)).toBe(false);
    expect(() => b.raycast(new Vec3(), new Vec3(), 3, hit)).toThrow();
    expect(() => b.raycast(new Vec3(NaN), new Vec3(0, -1, 0), 3, hit)).toThrow();
  });
  it('traverses both directions and respects inclined triangles', () => {
    const b = new TriangleBVH(
      new Float64Array([-1, -1, -1, 1, 1, -1, 0, 0, 1]),
      new Uint32Array([0, 2, 1]),
    );
    const hit = rayHit();
    expect(b.raycast(new Vec3(0, 2, 0), new Vec3(0, -1, 0), 3, hit)).toBe(true);
    expect(hit.normal.x).toBeLessThan(-0.6);
    expect(b.raycast(new Vec3(0, -2, 0), new Vec3(0, 1, 0), 3, hit)).toBe(true);
    expect(hit.normal.y).toBeLessThan(0);
  });
  it('matches the analytic road, limits triangle work and closes the lap seam', () => {
    const track = new Track(),
      mesh = new TrackContactMesh(track, 2048);
    const p = trackPoint(),
      s = surfaceSample();
    for (let j = 0; j < 100; j++) {
      track.at((j * track.length) / 100, p);
      const distance = mesh.cast(new Vec3(p.x, p.y + 1, p.z), new Vec3(0, -1, 0), 2, s);
      expect(Number.isFinite(distance)).toBe(true);
      expect(Math.abs(s.height - p.y)).toBeLessThan(0.002);
      expect(mesh.bvh.trianglesTested).toBeLessThan(100);
    }
  });
  it('retains exact vertical hits across cell edges, cache evictions and overlapping road decks', () => {
    const vertices: number[] = [],
      indices: number[] = [];
    for (const height of [-1, 3, 5]) {
      for (let x = -20; x < 20; x += 2) {
        const n = vertices.length / 3;
        vertices.push(x, height, -5, x + 2, height, -5, x, height, 5, x + 2, height, 5);
        indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
      }
    }
    const tree = new TriangleBVH(
      Float64Array.from(vertices),
      Uint32Array.from(indices),
      undefined,
      (_triangle, x, height) => height < 4 || x >= 0,
    );
    const down = new Vec3(0, -1, 0),
      origin = new Vec3();
    for (const x of [-20, -16.000000001, -16, -4, 0, 4.000000001, 16, 400, -4]) {
      for (const y of [7, 5, 4, 2.9, -1.01]) {
        for (const z of [-5.000000001, -5, 0, 5, 8]) {
          origin.set(x, y, z);
          const full = rayHit(),
            local = rayHit();
          expect(tree.raycastVertical(origin, 3, local)).toBe(tree.raycast(origin, down, 3, full));
          expect(local).toEqual(full);
        }
      }
    }
    expect(() => tree.raycastVertical(new Vec3(NaN), 2, rayHit())).toThrow('Invalid ray');
    expect(() => tree.raycastVertical(origin, -1, rayHit())).toThrow('Invalid ray');
  });
  it('predicts suspension height without reading wet surface properties twice', () => {
    const track = new Track('rain'),
      mesh = new TrackContactMesh(track, 256);
    const at = track.at(47, trackPoint()),
      origin = new Vec3(at.x, at.y + 1, at.z);
    const down = new Vec3(0, -1, 0),
      full = surfaceSample(),
      predicted = surfaceSample();
    const sample = vi.spyOn(track, 'sample');
    const distance = mesh.cast(origin, down, 2, full);
    expect(Number.isFinite(distance)).toBe(true);
    expect(sample).toHaveBeenCalledTimes(1);
    expect(mesh.cast(origin, down, 2, predicted, true)).toBe(distance);
    expect(predicted.height).toBe(full.height);
    expect(predicted.normal).toEqual(full.normal);
    expect(sample).toHaveBeenCalledTimes(1);
  });
  it('reuses only static geometry while a stationary tyre picks up fresh track conditions', () => {
    const track = new Track('rain'),
      mesh = new TrackContactMesh(track, 512);
    const station = track.at(83, trackPoint()),
      origin = new Vec3(station.x, station.y + 1, station.z);
    const down = new Vec3(0, -1, 0),
      surface = surfaceSample(),
      other = surfaceSample();
    const distance = mesh.cast(origin, down, 2, surface),
      normal = new Vec3().copy(surface.normal);
    expect(Number.isFinite(distance)).toBe(true);
    const cell = surface.cell;
    track.water[cell] = 0.875;
    track.temperature[cell] = 14.5;
    mesh.cast(origin, new Vec3(0.15, -1, 0).normalize(), 2, other);
    surface.normal.set(1, 0, 0);
    expect(mesh.cast(origin, down, 2, surface)).toBe(distance);
    expect(mesh.bvh.trianglesTested).toBe(0);
    expect(surface.normal).toEqual(normal);
    expect(surface.water).toBe(0.875);
    expect(surface.temp).toBe(14.5);
    expect(mesh.cast(origin, down, 0.25, surface)).toBe(Infinity);
    origin.y += 0.5;
    expect(mesh.cast(origin, down, 2, surface)).toBeCloseTo(distance + 0.5, 12);
  });
  it('matches oblique triangle faces, interpolated normals and multiple decks on a vertical ray', () => {
    const verts: number[] = [],
      normals: number[] = [],
      indices: number[] = [];
    for (const y of [-1.3, 3.6]) {
      for (let j = 0; j < 35; j++) {
        const i = verts.length / 3,
          x = j * 0.76 - 12;
        const a = 0.27 * Math.sin(j * 0.31),
          b = 0.19 * Math.cos(j * 0.53);
        verts.push(x, y + a, -4, x + 1.7, y + b, -3.7, x - 0.12, y + a + 0.28, 4.3);
        normals.push(-0.11, 1, 0.09, -0.23, 0.97, 0.12, 0.12, 0.96, -0.06);
        indices.push(i, i + 1, i + 2);
      }
    }
    const tree = new TriangleBVH(
      Float64Array.from(verts),
      Uint32Array.from(indices),
      Float64Array.from(normals),
    );
    const down = new Vec3(0, -1, 0);
    for (let i = 0; i < 600; i++) {
      const origin = new Vec3(
        12 * Math.sin(i * 1.73),
        3 + 2 * Math.cos(i * 0.47),
        3.9 * Math.sin(i * 0.79),
      );
      const full = rayHit(),
        local = rayHit();
      expect(tree.raycastVertical(origin, 8, local)).toBe(tree.raycast(origin, down, 8, full));
      expect(local).toEqual(full);
    }
  });
  it('keeps every crossing of a cached vertical line when its origin changes decks or meshes', () => {
    const levels = (bottom: number, top: number) =>
      new TriangleBVH(
        Float64Array.from([
          -2,
          bottom,
          -2,
          2,
          bottom,
          -2,
          0,
          bottom,
          2,
          -2,
          top,
          -2,
          2,
          top,
          -2,
          0,
          top,
          2,
        ]),
        Uint32Array.from([0, 2, 1, 3, 5, 4]),
      );
    const down = new Vec3(0, -1, 0),
      column = new VerticalRayColumn();
    for (const tree of [levels(-1, 3), levels(0.5, 7)]) {
      for (const height of [10, 2, 4, 1, 9, -4, 7, 0]) {
        const o = new Vec3(0.1, height, 0.375),
          full = rayHit(),
          cached = rayHit();
        expect(tree.raycastVertical(o, 5, cached, column)).toBe(tree.raycast(o, down, 5, full));
        expect(cached).toEqual(full);
      }
    }
  });
  it('retains the original floating-point lap wrap at race progress and its seam', () => {
    for (const length of [1, 0.625, 1759.31571, 10491.12131]) {
      for (let i = -60; i <= 2000; i++) {
        const s = (i / 1500) * length;
        expect(lapStation(s, length)).toBe(mod(s, length));
        expect(lapStation(s + Number.EPSILON * length, length)).toBe(
          mod(s + Number.EPSILON * length, length),
        );
      }
    }
  });
  it('uses the exact ribbon bracket for full and braking-profile samples across wrapped laps', () => {
    const t = new Track('rain', false, undefined, circuitDefinition('poggio-alto'));
    const full = trackPoint(),
      profile = trackPoint();
    const count = t.points.length - 1;
    let inspected = 0;
    for (let i = 0; i < count; i += 3) {
      for (const station of [
        t.points[i].s,
        t.points[i].s - 1e-9,
        t.points[i].s + 1e-9,
        ((i - count) * t.length) / count,
        ((i + count) * t.length) / count,
      ]) {
        const s = mod(station, t.length);
        let lo = 0,
          hi = count;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (t.points[mid].s <= s) lo = mid;
          else hi = mid;
        }
        const a = t.points[lo],
          b = t.points[hi],
          fraction = (s - a.s) / (b.s - a.s || 1);
        t.at(station, full);
        t.at(station, profile, true);
        const values = [
          lerp(a.x, b.x, fraction),
          lerp(a.gradient, b.gradient, fraction),
          lerp(a.curvature, b.curvature, fraction),
        ];
        expect([full.x, profile.gradient, profile.curvature]).toEqual(values);
        expect([full.gradient, full.curvature]).toEqual([profile.gradient, profile.curvature]);
        inspected++;
      }
    }
    expect(inspected).toBeGreaterThan(1000);
  });
  it('has continuous kerb shoulders and a real rib profile', () => {
    expect(kerbHeight(0, 0)).toBe(0);
    expect(kerbHeight(0, 1.1)).toBe(0);
    expect(kerbHeight(0.1625, 0.55)).toBeGreaterThan(kerbHeight(0.4875, 0.55));
  });
});
