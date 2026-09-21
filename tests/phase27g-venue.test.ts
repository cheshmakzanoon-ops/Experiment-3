import { expect, it } from 'vitest';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { districtPlan, inDistrictFootprint } from '../src/rendering/venue-districts.ts';
import { vegetationPlan } from '../src/rendering/landscape.ts';
import { terrainHeight } from '../src/rendering/terrain-profile.ts';

it('authors four genuinely different districts on safe, separate outboard footprints', () => {
  const t = new Track(),
    sites = districtPlan(t),
    p = trackPoint();
  expect(sites).toHaveLength(4);
  expect(new Set(sites.map((s) => s.kind)).size).toBe(4);
  expect(districtPlan(t)).toEqual(sites);
  for (const s of sites) {
    expect(s.clearance).toBeGreaterThanOrEqual(25);
    for (let x = -s.width / 2; x <= s.width / 2; x += 2)
      for (let z = -s.length / 2; z <= s.length / 2; z += 2) {
        const wx = s.x + Math.cos(s.yaw) * x + Math.sin(s.yaw) * z;
        const wz = s.z - Math.sin(s.yaw) * x + Math.cos(s.yaw) * z;
        const lateral = t.nearest(wx, wz, p);
        expect(Math.abs(lateral)).toBeGreaterThan(p.width + 42);
        expect(s.y - terrainHeight(wx, wz)).toBeGreaterThanOrEqual(0.1199);
        expect(
          inDistrictFootprint(
            sites.filter((b) => b !== s),
            wx,
            wz,
            5,
          ),
        ).toBe(false);
      }
  }
  const trees = vegetationPlan(t);
  expect(trees.length).toBeLessThanOrEqual(650);
  expect(trees.length).toBeGreaterThan(550);
  for (const tree of trees) expect(inDistrictFootprint(sites, tree.x, tree.z, 8)).toBe(false);
});
it('keeps all reachable ground unchanged while authoring the remote horizon', () => {
  for (let x = -600; x < 600; x += 20)
    for (let z = -600; z < 600; z += 20)
      if (Math.hypot(x, z) <= 680) expect(terrainHeight(x, z)).toBe(-4);
  expect(terrainHeight(1200, 300)).toBeGreaterThan(0);
});
