import { describe, expect, it, vi } from 'vitest';
import { Track, surfaceSample } from '../src/simulation/track.ts';
import { MATERIAL } from '../src/simulation/surface-material.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { motocrossSoilPickup } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rigBike, rigTrack } from '../src/simulation/offroad/jump-rig.ts';

const mud = { surface: MATERIAL.MUD, soilMoisture: 1 };
const dry = { surface: MATERIAL.DIRT, soilMoisture: 0 };
const wheel = { load: 900, slip: 0.4 };

describe('mud carried by the ridden bike and rider', () => {
  it('requires a loaded tyre moving or scrubbing loose soil', () => {
    expect(motocrossSoilPickup(mud, { load: 0, slip: 8 }, 900, 23)).toBe(0);
    expect(motocrossSoilPickup(mud, { load: 900, slip: 0 }, 900, 0)).toBe(0);
    expect(
      motocrossSoilPickup({ surface: MATERIAL.ASPHALT, soilMoisture: 1 }, wheel, 900, 23),
    ).toBe(0);
    const rate = motocrossSoilPickup(mud, wheel, 900, 23);
    expect(motocrossSoilPickup(mud, { ...wheel, load: 450 }, 900, 23)).toBe(rate * 0.5);
    expect(motocrossSoilPickup(dry, wheel, 900, 23)).toBeCloseTo(rate * 0.15, 12);
    expect(motocrossSoilPickup({ ...dry, soilMoisture: 0.6 }, wheel, 900, 23)).toBeCloseTo(
      rate * 0.66,
      12,
    );
    expect(motocrossSoilPickup(mud, { ...wheel, slip: -0.4 }, 900, 23)).toBe(rate);
    expect(motocrossSoilPickup(mud, { load: 50000, slip: 600 }, 900, 0)).toBeLessThan(0.03);
  });

  it('carries the sampled cell moisture on each patch and clears it when leaving the soil', () => {
    const track = rigTrack('valley-ridge-mx'),
      bike = rigBike(MX_450, track, 34, 12);
    bike.step(1 / 240, track);
    const terrain = (Track.offroadOf(track) as TrackTerrainSurface).terrain;
    for (const patch of bike.contacts)
      expect(patch.soilMoisture).toBe(
        terrain.moistureAt(terrain.cellIndex(patch.lateral, patch.s)),
      );
    const sample = Object.assign(surfaceSample(), { soilMoisture: 0.9 });
    const road = new Track('clear', false);
    road.sample(0, 0, sample);
    expect(sample.soilMoisture).toBeUndefined();
  });

  it('records a front-only wet patch as a smaller coat than rear-only or two-tyre mud', () => {
    const track = rigTrack('valley-ridge-mx'),
      sample = track.sample.bind(track);
    function run(frontMud: boolean, rearMud: boolean) {
      const bike = rigBike(MX_450, track, 34, 12),
        d = bike.dynamics;
      const surface = vi.spyOn(track, 'sample').mockImplementation((x, z, out, hint) => {
        sample(x, z, out, hint);
        const front = (x - d.x) * Math.sin(d.heading) + (z - d.z) * Math.cos(d.heading) > 0;
        out.surface = (front ? frontMud : rearMud) ? MATERIAL.MUD : MATERIAL.ASPHALT;
        return out;
      });
      try {
        for (let i = 0; i < 24; i++) bike.step(1 / 240, track);
        expect(bike.riding && !bike.airborne).toBe(true);
        return bike.mud;
      } finally {
        surface.mockRestore();
      }
    }
    const front = run(true, false),
      rear = run(false, true);
    expect(run(false, false)).toBe(0);
    expect(front).toBeGreaterThan(0);
    expect(rear).toBeGreaterThan(front);
    expect(run(true, true)).toBeGreaterThan(rear);
  });
});
