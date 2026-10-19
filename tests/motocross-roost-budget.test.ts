import { expect, it } from 'vitest';
import { Roost, ROOST_GROUND_SAMPLES } from '../src/rendering/offroad/roost.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { HEADER } from '../src/simulation/protocol.ts';
import { trackPoint } from '../src/simulation/track.ts';

it('keeps a clod falling until its ground contact can be confirmed within the query budget', () => {
  const track = rigTrack('valley-ridge-mx');
  const roost = new Roost(track);
  try {
    // Isolate the 128-probe boundary without depending on rider emission rates:
    // 129 wet clods descend over cached ground at 0.18 m, then the displayed
    // surface drops to 0 m. Only seeding uses internals; assertions read the
    // rendered positions and public sampler, not the collision implementation.
    const pool = roost as unknown as {
      spawn(
        x: number,
        y: number,
        z: number,
        vx: number,
        vy: number,
        vz: number,
        wet: number,
        dust: boolean,
      ): void;
      groundAge: Float32Array;
    };
    const p = track.at(100, trackPoint());
    for (let i = 0; i <= ROOST_GROUND_SAMPLES; i++) {
      pool.spawn(p.x, 0.225, p.z, 0, -4, 0, 0.8, false);
      pool.groundAge[i] = 0.08;
    }
    let heightReads = 0;
    roost.groundHeight = () => {
      heightReads++;
      return 0;
    };
    const frame = new Float32Array(HEADER); // No riders or additional births.
    const positions = roost.points.geometry.getAttribute('position');
    const tick = () => {
      heightReads = 0;
      roost.update(frame, 1 / 60);
      expect(heightReads).toBeLessThanOrEqual(ROOST_GROUND_SAMPLES * 5);
      return positions.getY(ROOST_GROUND_SAMPLES);
    };

    const firstHeight = tick();
    expect(firstHeight).toBeLessThan(0.18);
    expect(tick()).toBeLessThan(firstHeight);
    for (let i = 0; i < 6; i++) expect(tick()).toBeGreaterThanOrEqual(0);
    const contactHeight = tick();
    expect(contactHeight).toBeLessThan(0.04);
    expect(tick()).toBe(contactHeight);
    expect(roost.active).toBe(ROOST_GROUND_SAMPLES + 1);
  } finally {
    roost.dispose();
  }
});
