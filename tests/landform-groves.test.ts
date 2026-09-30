import { describe, it, expect } from 'vitest';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { grovePlan, vegetationPlan } from '../src/rendering/landscape.ts';
import { terrainHeight, ridgedNoise, valueNoise } from '../src/rendering/terrain-profile.ts';
import { inStandFootprint } from '../src/rendering/grandstand.ts';
import { serviceSitePlan, inServiceFootprint } from '../src/rendering/venue-service-plan.ts';
import { districtPlan, inDistrictFootprint } from '../src/rendering/venue-districts.ts';
import { landmarkSitePlan, inLandmarkFootprint } from '../src/rendering/venue-landmark.ts';

describe('distant landforms', () => {
  it('keeps noise bounded and deterministic', () => {
    for (let i = 0; i < 400; i++) {
      const x = (i * 37.1) % 91.3,
        z = (i * 11.7) % 53.9;
      const v = valueNoise(x, z),
        r = ridgedNoise(x, z);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      expect(valueNoise(x, z)).toBe(v);
    }
  });
  it('raises a ridged range at the horizon without touching the venue datum', () => {
    for (let x = -660; x <= 660; x += 30)
      for (let z = -660; z <= 660; z += 30)
        if (Math.hypot(x, z) <= 680) expect(terrainHeight(x, z)).toBe(-4);
    let peak = -Infinity,
      trough = Infinity;
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      const h = terrainHeight(Math.cos(a) * 2500, Math.sin(a) * 2500);
      peak = Math.max(peak, h);
      trough = Math.min(trough, h);
    }
    // A readable range with relief, not a uniform wall or a flat plane.
    expect(peak).toBeGreaterThan(150);
    expect(peak - trough).toBeGreaterThan(80);
    // Continuous: no cliffs between neighbouring 34 m terrain vertices.
    for (let x = 700; x < 2700; x += 34) {
      const dh = Math.abs(terrainHeight(x + 34, 400) - terrainHeight(x, 400));
      expect(dh).toBeLessThan(45);
    }
  });
});

describe('grove and treeline planting layer', () => {
  const track = new Track('clear');
  const plan = grovePlan(track);
  it('is deterministic, bounded and separate from the near-track plan', () => {
    expect(grovePlan(track)).toEqual(plan);
    expect(plan.groves.length).toBeGreaterThan(250);
    expect(plan.groves.length).toBeLessThanOrEqual(900);
    expect(plan.treeline.length).toBeGreaterThan(200);
    // The existing near-track budget is untouched.
    expect(vegetationPlan(track).length).toBeLessThanOrEqual(650);
  });
  it('clumps trees, stays clear of the racing and service corridors and every footprint', () => {
    const services = serviceSitePlan(track);
    const districts = districtPlan(track, services);
    const landmark = landmarkSitePlan(track, services, districts);
    const p = trackPoint();
    for (const tree of [...plan.groves, ...plan.treeline]) {
      const l = track.nearest(tree.x, tree.z, p);
      expect(Math.abs(l)).toBeGreaterThanOrEqual(track.boundary(p.s, l < 0 ? -1 : 1) + 60);
      expect(inStandFootprint(track, tree.x, tree.z, 8)).toBe(false);
      expect(inServiceFootprint(services, tree.x, tree.z, 8)).toBe(false);
      expect(inDistrictFootprint(districts, tree.x, tree.z, 8)).toBe(false);
      expect(inLandmarkFootprint(landmark, tree.x, tree.z, 8)).toBe(false);
      expect(tree.y).toBe(terrainHeight(tree.x, tree.z));
      expect(tree.height).toBeGreaterThan(6);
    }
    // Clumping: most grove trees have a neighbour within 9 m (a uniform
    // scatter of this density would rarely do so).
    let neighboured = 0;
    for (const a of plan.groves)
      if (plan.groves.some((b) => b !== a && Math.hypot(a.x - b.x, a.z - b.z) < 9)) neighboured++;
    expect(neighboured / plan.groves.length).toBeGreaterThan(0.8);
    // A mixture of tall narrow conifers and broad crowns.
    const narrow = plan.groves.filter((t) => t.width / t.height < 0.5).length;
    expect(narrow).toBeGreaterThan(20);
    expect(narrow).toBeLessThan(plan.groves.length * 0.6);
  });
});
