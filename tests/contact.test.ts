import { describe, it, expect } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { TriangleBVH, rayHit } from '../src/simulation/bvh.ts';
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
  it('has continuous kerb shoulders and a real rib profile', () => {
    expect(kerbHeight(0, 0)).toBe(0);
    expect(kerbHeight(0, 1.1)).toBe(0);
    expect(kerbHeight(0.1625, 0.55)).toBeGreaterThan(kerbHeight(0.4875, 0.55));
  });
});
