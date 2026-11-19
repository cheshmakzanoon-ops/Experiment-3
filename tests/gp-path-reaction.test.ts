import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import { leanFromCurvature } from '../src/simulation/bike-ai.ts';
import { GP_R1 } from '../src/simulation/bike-definitions.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';

describe('GP path curvature under changing normal support', () => {
  it.each([0.1, 0.4, 1, 1.5])('requests the balanced contact lean at %s static load', (support) => {
    const bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', GP_R1),
      d = bike.dynamics,
      reaction = G * support,
      targetLean = 0.35;
    bike.speed = d.speed = 30;
    d.contactLoads = {
      front: (d.mass * reaction * d.p.cgToRear) / d.p.wheelbase,
      rear: (d.mass * reaction * d.p.cgToFront) / d.p.wheelbase,
    };
    d.frontLoad = d.contactLoads.front;
    d.rearLoad = d.contactLoads.rear;
    const curvature = (reaction * Math.tan(targetLean)) / d.speed ** 2,
      intent = leanFromCurvature(bike, curvature, 0);
    // Fy/N fixes the combined contact lean. A full-weight assumption asks
    // for only one tenth of that lean at a10% supported crest.
    expect(intent * d.leanLimit).toBeCloseTo(targetLean, 12);
  });
});
